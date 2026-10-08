import {
  executeExtensionCommand,
  hasExtensionCommand,
  extensionCommandIds,
  extensionStatusText,
  registerExtensionCommand,
  removeExtensionView,
  setExtensionStatusText,
  setExtensionStatusVisible,
  updateExtensionViewCommand,
  registerExtensionViews,
  type ExtensionViewContribution,
} from './extensionContributions';
import { extensionDialogQueue } from './extensionDialogs';

/** Disposal handle a extension pushes to its subscriptions. */
export interface ExtensionDisposable {
  dispose(): void;
}

/** Command handler a extension registers (mirrors the SDK command bus). */
export type ExtensionCommandHandler = (...args: unknown[]) => unknown | Promise<unknown>;

/** Command bus handed to one extension (SDK `ExtensionCommandRegistry` shape). */
export interface ExtensionCommandBus {
  registerCommand(
    id: string,
    handler: ExtensionCommandHandler,
    options?: { canExecute?: (...args: unknown[]) => boolean },
  ): ExtensionDisposable;
  canExecute(id: string, ...args: unknown[]): boolean;
  executeCommand(id: string, ...args: unknown[]): Promise<unknown>;
  getCommands(): string[];
}

/** Notification surface handed to one extension (SDK `WindowApi` shape). */
export interface ExtensionWindow {
  showNotification(
    message: string,
    options?: {
      level?: 'info' | 'success' | 'error';
      actions?: readonly { label: string; command: string; args?: readonly unknown[] }[];
    },
  ): void;
  showQuickPick(
    items: readonly { id: string; label: string; description?: string }[],
    placeholder?: string,
  ): Promise<{ id: string; label: string; description?: string } | undefined>;
  showInputBox(prompt: string, initialValue?: string): Promise<string | undefined>;
  showDialog(title: string, body: string): Promise<{ confirmed: boolean } | undefined>;
  createStatusBarItem(id: string): {
    text: string;
    tooltip?: string;
    command?: string;
    show(): void;
    hide(): void;
    dispose(): void;
  };
}

/** Minimal typed event (SDK `ExtensionEvent` shape). */
export class ExtensionEvent<T> {
  private readonly listeners = new Set<(payload: T) => void>();

  on(listener: (payload: T) => void): ExtensionDisposable {
    this.listeners.add(listener);
    return { dispose: () => void this.listeners.delete(listener) };
  }

  fire(payload: T): void {
    for (const listener of [...this.listeners]) listener(payload);
  }
}

/** Workspace surface handed to one extension (SDK `WorkspaceApi` shape). */
export interface ExtensionWorkspace {
  readonly config: {
    get<T>(key: string, fallback: T): T;
    set(key: string, value: string | boolean | number): void;
    onDidChange(listener: (key: string) => void): ExtensionDisposable;
  };
  readonly events: {
    readonly onDidChangeSelection: ExtensionEvent<readonly string[]>;
    readonly onDidChangeDocument: ExtensionEvent<{ projectId: string }>;
  };
  readonly memento: {
    get<T>(key: string, fallback: T): T;
    update(key: string, value: unknown): Promise<void>;
  };
}

/** Full activation context handed to one extension (SDK `ExtensionContext` shape). */
export interface ExtensionContext {
  readonly commands: ExtensionCommandBus;
  readonly window: ExtensionWindow;
  readonly workspace: ExtensionWorkspace;
  readonly subscriptions: ExtensionDisposable[];
}

interface ContextDeps {
  packageId: string;
  notify: (message: string, options?: { level?: 'info' | 'success' | 'error'; action?: { label: string; commandId: string } }) => void;
  executeHostCommand: (id: string, ...args: unknown[]) => Promise<{ ok: boolean; value?: unknown; reason?: string }>;
}

const gatedCommands = new Map<string, (...args: unknown[]) => boolean>();

/**
 * Build one extension's activation context. Shapes mirror the SDK so code
 * authored against `opennary-sdk` runs here without adaptation; the desktop
 * provides the host side (toasts, dialogs, status store, local storage).
 */
export function createExtensionContext({ packageId, notify, executeHostCommand }: ContextDeps): ExtensionContext {
  const subscriptions: ExtensionDisposable[] = [];
  const track = <T extends ExtensionDisposable>(disposable: T): T => {
    subscriptions.push(disposable);
    return disposable;
  };

  const configKey = (key: string) => `extension:${packageId}:${key}`;
  const configListeners = new Set<(key: string) => void>();
  const selectionEvent = new ExtensionEvent<readonly string[]>();
  const documentEvent = new ExtensionEvent<{ projectId: string }>();
  const mementoValues = new Map<string, unknown>();
  const configMemory = new Map<string, string | boolean | number>();

  const commands: ExtensionCommandBus = {
    registerCommand: (id, handler, options) => {
      registerExtensionCommand(id, handler);
      if (options?.canExecute) gatedCommands.set(id, options.canExecute);
      return track({ dispose: () => void gatedCommands.delete(id) });
    },
    canExecute: (id, ...args) => gatedCommands.get(id)?.(...args) ?? hasExtensionCommand(id),
    executeCommand: async (id, ...args) => {
      // Local handlers run inline; anything else delegates to the host
      // (lazy `onCommand` activation included).
      if (hasExtensionCommand(id)) {
        const outcome = await executeExtensionCommand(id, ...args);
        if (!outcome.ok) throw new Error(outcome.reason ?? `command failed: ${id}`);
        return outcome.value;
      }
      const outcome = await executeHostCommand(id, ...args);
      if (!outcome.ok) throw new Error(outcome.reason ?? `command failed: ${id}`);
      return outcome.value;
    },
    getCommands: () => extensionCommandIds(),
  };

  const window: ExtensionWindow = {
    showNotification: (message, options) => {
      const [first] = options?.actions ?? [];
      notify(message, {
        level: options?.level ?? 'info',
        action: first ? { label: first.label, commandId: first.command } : undefined,
      });
    },
    showQuickPick: (items, placeholder) =>
      extensionDialogQueue.ask<{ id: string; label: string; description?: string }>({
        kind: 'quickPick',
        items,
        placeholder,
      }),
    showInputBox: (prompt, initialValue) =>
      extensionDialogQueue.ask<string>({ kind: 'input', prompt, initialValue }),
    showDialog: (title, body) =>
      extensionDialogQueue.ask<{ confirmed: boolean }>({ kind: 'confirm', title, body }),
    createStatusBarItem: (id) => {
      const contribution: ExtensionViewContribution = { surface: 'status', id, title: id };
      registerExtensionViews([contribution]);
      setExtensionStatusText(id, id);
      let command: string | undefined;
      return {
        get text() {
          return extensionStatusText(id, id);
        },
        set text(next: string) {
          setExtensionStatusText(id, next);
        },
        tooltip: undefined as string | undefined,
        get command() {
          return command;
        },
        set command(next: string | undefined) {
          command = next;
          updateExtensionViewCommand('status', id, next);
        },
        show: () => setExtensionStatusVisible(id, true),
        hide: () => setExtensionStatusVisible(id, false),
        dispose: () => {
          removeExtensionView('status', id);
        },
      };
    },
  };

  const workspace: ExtensionWorkspace = {
    config: {
      get: (key, fallback) => {
        if (configMemory.has(key)) return configMemory.get(key) as never;
        try {
          const raw = globalThis.localStorage?.getItem(configKey(key));
          return (raw === null || raw === undefined ? fallback : JSON.parse(raw)) as never;
        } catch {
          return fallback;
        }
      },
      set: (key, value) => {
        configMemory.set(key, value);
        try {
          globalThis.localStorage?.setItem(configKey(key), JSON.stringify(value));
        } catch {
          // Storage full or blocked: the in-memory value above still applies.
        }
        for (const listener of [...configListeners]) listener(key);
      },
      onDidChange: (listener) => {
        configListeners.add(listener);
        return { dispose: () => void configListeners.delete(listener) };
      },
    },
    events: { onDidChangeSelection: selectionEvent, onDidChangeDocument: documentEvent },
    memento: {
      get: (key, fallback) => (mementoValues.has(key) ? mementoValues.get(key) : fallback) as never,
      update: async (key, value) => void mementoValues.set(key, value),
    },
  };

  return { commands, window, workspace, subscriptions };
}
