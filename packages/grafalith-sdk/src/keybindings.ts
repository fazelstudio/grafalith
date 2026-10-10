import type { Disposable } from "./commands.js";

/** One keybinding: a command plus its chord and optional `when` clause. */
export interface Keybinding {
  readonly command: string;
  readonly key: string;
  readonly when?: string;
}

/**
 * Keybinding registry (`grafalith.keybindings.*`). The host owns dispatch;
 * extensions only declare entries through this surface.
 */
export class KeybindingRegistry {
  private readonly entries: Keybinding[] = [];

  /** Register one keybinding; returns a disposable for cleanup. */
  register(binding: Keybinding): Disposable {
    if (binding.command === "") throw new Error("keybinding command must not be empty");
    if (binding.key === "") throw new Error(`keybinding for "${binding.command}" needs a key`);
    this.entries.push(binding);
    return { dispose: () => void this.entries.splice(this.entries.indexOf(binding), 1) };
  }

  /** Every registered keybinding in registration order. */
  getAll(): readonly Keybinding[] {
    return [...this.entries];
  }
}
