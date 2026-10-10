/** Disposable handle for a extension registration. */
export interface Disposable {
  dispose(): void;
}

/** Handler behind one extension command id. */
export type ExtensionCommandHandler = (...args: unknown[]) => unknown | Promise<unknown>;

/** Optional enablement predicate for one extension command. */
export type ExtensionCommandPredicate = (...args: unknown[]) => boolean;

interface ExtensionCommandEntry {
  handler: ExtensionCommandHandler;
  canExecute?: ExtensionCommandPredicate;
}

/**
 * Extension command bus (the `commands` side of the VSCode model).
 * The host bridges these into its own registry so palette, menus, and
 * keybindings share one execution path with built-in commands.
 */
export class ExtensionCommandRegistry {
  private readonly entries = new Map<string, ExtensionCommandEntry>();

  registerCommand(id: string, handler: ExtensionCommandHandler, options?: { canExecute?: ExtensionCommandPredicate }): Disposable {
    if (id === "") throw new Error("command id must not be empty");
    if (this.entries.has(id)) throw new Error(`command already registered: ${id}`);
    this.entries.set(id, { handler, canExecute: options?.canExecute });
    return { dispose: () => void this.entries.delete(id) };
  }

  canExecute(id: string, ...args: unknown[]): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    return entry.canExecute?.(...args) ?? true;
  }

  async executeCommand(id: string, ...args: unknown[]): Promise<unknown> {
    const entry = this.entries.get(id);
    if (!entry) throw new Error(`unknown command: ${id}`);
    if (entry.canExecute && !entry.canExecute(...args)) {
      throw new Error(`command disabled: ${id}`);
    }
    return entry.handler(...args);
  }

  getCommands(): string[] {
    return [...this.entries.keys()];
  }
}
