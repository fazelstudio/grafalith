import type { Disposable } from "./commands.js";

/** Notification severity (toast styling + screen-reader role). */
export type NotificationLevel = "info" | "success" | "warning" | "error";

/** One notification action running a command when picked. */
export interface NotificationAction {
  readonly label: string;
  readonly command: string;
  readonly args?: readonly unknown[];
}

/** Toast options: level, actions, lifetime, and attribution. */
export interface NotificationOptions {
  readonly level?: NotificationLevel;
  readonly actions?: readonly NotificationAction[];
  /** Lifetime in ms; 0 means persistent until dismissed. */
  readonly duration?: number;
  /** Extension attribution shown on the toast. */
  readonly source?: string;
}

/** Progress reporter handed to a cancellable task. */
export interface ProgressReporter {
  report(fraction: number, message?: string): void;
}

/** Cancellation token for a cancellable progress task. */
export interface CancellationToken {
  readonly cancelled: boolean;
  onCancel(listener: () => void): Disposable;
}

/** Item picked from a quick pick, or undefined on dismiss. */
export interface QuickPickItem {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
}

/** Options for a quick pick (placeholder + multi-select). */
export interface QuickPickOptions {
  readonly placeholder?: string;
  readonly canPickMany?: boolean;
}

/** Options for an input box (prompt, initial value, validation). */
export interface InputBoxOptions {
  readonly prompt?: string;
  readonly initialValue?: string;
  readonly validate?: (value: string) => string | undefined;
}

/** Dialog kind plus the payload collected from the user. */
export type DialogResult =
  | { readonly confirmed: boolean; readonly name?: string }
  | undefined;

/** Status bar item a extension owns (show/hide/dispose like VSCode). */
export interface ExtensionStatusBarItem extends Disposable {
  text: string;
  tooltip?: string;
  command?: string;
  show(): void;
  hide(): void;
}

/**
 * Host-bound window surface. The desktop implements this over its toast
 * provider, dialog primitive, palette, and status registry; tests and
 * headless hosts substitute a memory adapter.
 */
export interface WindowApi {
  showNotification(message: string, options?: NotificationOptions): void;
  showToast(message: string, options?: NotificationOptions): void;
  showProgress(title: string, task: (progress: ProgressReporter, token: CancellationToken) => Promise<void>, options?: { cancellable?: boolean }): Promise<void>;
  showStatusMessage(message: string, duration?: number): Disposable;
  showQuickPick(items: readonly QuickPickItem[], placeholder?: string): Promise<QuickPickItem | undefined>;
  showInputBox(prompt: string, initialValue?: string): Promise<string | undefined>;
  showDialog(title: string, body: string): Promise<DialogResult>;
  createStatusBarItem(id: string): ExtensionStatusBarItem;
}

/** In-memory window adapter for tests and headless hosts. */
export class MemoryWindowApi implements WindowApi {
  readonly notifications: { message: string; options?: NotificationOptions }[] = [];
  readonly statusItems = new Map<string, { text: string; visible: boolean }>();
  readonly statusMessages: string[] = [];
  quickPickResult: QuickPickItem | undefined;
  inputResult: string | undefined;
  dialogResult: DialogResult;

  showNotification(message: string, options?: NotificationOptions): void {
    this.notifications.push({ message, options });
  }

  showToast(message: string, options?: NotificationOptions): void {
    this.showNotification(message, options);
  }

  async showProgress(
    title: string,
    task: (progress: ProgressReporter, token: CancellationToken) => Promise<void>,
  ): Promise<void> {
    // Memory adapter runs the task inline and never cancels.
    const state = { cancelled: false };
    const listeners = new Set<() => void>();
    const token: CancellationToken = {
      get cancelled() {
        return state.cancelled;
      },
      onCancel: (listener) => {
        listeners.add(listener);
        return { dispose: () => void listeners.delete(listener) };
      },
    };
    await task({ report: () => undefined }, token);
    void title;
    void state;
    void listeners;
  }

  showStatusMessage(message: string): Disposable {
    this.statusMessages.push(message);
    return { dispose: () => undefined };
  }

  async showQuickPick(items: readonly QuickPickItem[]): Promise<QuickPickItem | undefined> {
    if (this.quickPickResult !== undefined) return this.quickPickResult;
    return items[0];
  }

  async showInputBox(_prompt: string, initialValue?: string): Promise<string | undefined> {
    return this.inputResult ?? initialValue;
  }

  async showDialog(): Promise<DialogResult> {
    return this.dialogResult;
  }

  createStatusBarItem(id: string): ExtensionStatusBarItem {
    const items = this.statusItems;
    const item: ExtensionStatusBarItem = {
      text: "",
      show: () => void items.set(id, { text: item.text, visible: true }),
      hide: () => void items.set(id, { text: item.text, visible: false }),
      dispose: () => void items.delete(id),
    };
    items.set(id, { text: "", visible: false });
    return item;
  }
}
