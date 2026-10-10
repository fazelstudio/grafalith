import type { Disposable } from "./commands.js";

/** Namespaced configuration access (`extensionId.key`). */
export interface ConfigStore {
  get<T>(key: string, fallback: T): T;
  set(key: string, value: string | boolean | number): void;
  onDidChange(listener: (key: string) => void): Disposable;
}

/** Minimal typed event for selection, document, and viewport changes. */
export class ExtensionEvent<T> {
  private readonly listeners = new Set<(payload: T) => void>();

  on(listener: (payload: T) => void): Disposable {
    this.listeners.add(listener);
    return { dispose: () => void this.listeners.delete(listener) };
  }

  fire(payload: T): void {
    for (const listener of [...this.listeners]) listener(payload);
  }

  get count(): number {
    return this.listeners.size;
  }
}

/** Workspace-scoped events a extension subscribes to. */
export interface WorkspaceEvents {
  readonly onDidChangeSelection: ExtensionEvent<readonly string[]>;
  readonly onDidChangeDocument: ExtensionEvent<{ readonly projectId: string }>;
  readonly onDidChangeViewport: ExtensionEvent<{ readonly zoom: number }>;
  readonly onDidOpenProject: ExtensionEvent<{ readonly projectId: string }>;
  readonly onDidCloseProject: ExtensionEvent<{ readonly projectId: string }>;
  readonly onDidChangeActiveEditor: ExtensionEvent<{ readonly editorType: string }>;
}

/** Key-value storage scoped to one extension (`publisher.id` namespace). */
export class ExtensionMemento {
  private readonly values = new Map<string, unknown>();

  get<T>(key: string, fallback: T): T {
    return (this.values.has(key) ? this.values.get(key) : fallback) as T;
  }

  async update(key: string, value: unknown): Promise<void> {
    this.values.set(key, value);
  }

  /** Remove one key. */
  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }

  /** Remove every key in this extension's scope. */
  async clear(): Promise<void> {
    this.values.clear();
  }
}

/** Workspace surface handed to extensions on activation. */
export interface WorkspaceApi {
  readonly config: ConfigStore;
  readonly events: WorkspaceEvents;
  readonly memento: ExtensionMemento;
}

/** In-memory workspace for tests and headless hosts. */
export function createMemoryWorkspace(): WorkspaceApi {
  const values = new Map<string, string | boolean | number>();
  const listeners = new Set<(key: string) => void>();
  return {
    config: {
      get: (key, fallback) => (values.has(key) ? (values.get(key) as never) : fallback),
      set: (key, value) => {
        values.set(key, value);
        for (const listener of [...listeners]) listener(key);
      },
      onDidChange: (listener) => {
        listeners.add(listener);
        return { dispose: () => void listeners.delete(listener) };
      },
    },
    events: {
      onDidChangeSelection: new ExtensionEvent<readonly string[]>(),
      onDidChangeDocument: new ExtensionEvent<{ readonly projectId: string }>(),
      onDidChangeViewport: new ExtensionEvent<{ readonly zoom: number }>(),
      onDidOpenProject: new ExtensionEvent<{ readonly projectId: string }>(),
      onDidCloseProject: new ExtensionEvent<{ readonly projectId: string }>(),
      onDidChangeActiveEditor: new ExtensionEvent<{ readonly editorType: string }>(),
    },
    memento: new ExtensionMemento(),
  };
}
