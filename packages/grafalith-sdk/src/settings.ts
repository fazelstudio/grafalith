import type { Disposable } from "./commands.js";

/** One settings section contributed by a extension. */
export interface SettingsSection {
  readonly id: string;
  readonly title: string;
}

/**
 * Settings surface (`grafalith.settings.*`): namespaced reads/writes plus
 * change events and section registration for the settings page/modal.
 */
export interface SettingsApi {
  /** Read `extensionId.key`, returning the fallback when absent. */
  get<T>(key: string, fallback: T): T;
  /** Write `extensionId.key` and fire change listeners. */
  set(key: string, value: string | boolean | number): Promise<void>;
  /** Subscribe to any settings change. */
  onDidChange(listener: (key: string) => void): Disposable;
  /** Register a settings section rendered in settings UI. */
  registerSection(section: SettingsSection): Disposable;
}

/** In-memory settings for tests and headless hosts. */
export function createMemorySettings(): SettingsApi {
  const values = new Map<string, string | boolean | number>();
  const sections: SettingsSection[] = [];
  const listeners = new Set<(key: string) => void>();
  return {
    get: (key, fallback) => (values.has(key) ? (values.get(key) as never) : fallback),
    set: async (key, value) => {
      values.set(key, value);
      for (const listener of [...listeners]) listener(key);
    },
    onDidChange: (listener) => {
      listeners.add(listener);
      return { dispose: () => void listeners.delete(listener) };
    },
    registerSection: (section) => {
      sections.push(section);
      return { dispose: () => void sections.splice(sections.indexOf(section), 1) };
    },
  };
}
