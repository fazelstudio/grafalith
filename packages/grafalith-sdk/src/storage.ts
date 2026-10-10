import type { Disposable } from "./commands.js";

/**
 * Persistent key-value storage scoped to one extension
 * (`grafalith.storage.*`). Backed by the host (localStorage on desktop);
 * memory adapter below is for tests.
 */
export interface ExtensionStorage {
  /** Read one key, returning the fallback when absent. */
  get<T>(key: string, fallback: T): T;
  /** Write one key (persists across restarts on the host). */
  set(key: string, value: unknown): Promise<void>;
  /** Remove one key. */
  delete(key: string): Promise<void>;
  /** Remove every key in this extension's scope. */
  clear(): Promise<void>;
  /** Subscribe to key changes. */
  onDidChange(listener: (key: string) => void): Disposable;
}

/** In-memory storage for tests and headless hosts. */
export function createMemoryStorage(): ExtensionStorage {
  const values = new Map<string, unknown>();
  const listeners = new Set<(key: string) => void>();
  const fire = (key: string): void => {
    for (const listener of [...listeners]) listener(key);
  };
  return {
    get: (key, fallback) => (values.has(key) ? values.get(key) : fallback) as never,
    set: async (key, value) => {
      values.set(key, value);
      fire(key);
    },
    delete: async (key) => {
      values.delete(key);
      fire(key);
    },
    clear: async () => {
      values.clear();
      fire("*");
    },
    onDidChange: (listener) => {
      listeners.add(listener);
      return { dispose: () => void listeners.delete(listener) };
    },
  };
}
