// Disposable collection: push every registration for one-call teardown.
//
// Each `grafalith.*` registration returns a `Disposable`; extensions push
// them to `context.subscriptions` (or a local collection) so deactivation
// disposes everything even when `deactivate()` itself is missing.
import type { Disposable } from "./commands.js";

/**
 * Owns a group of disposables and tears them all down together.
 * One bad `dispose()` never blocks the rest.
 */
export class DisposableCollection implements Disposable {
  private readonly items: Disposable[] = [];

  /** Track one disposable; returns it for inline use. */
  add<T extends Disposable>(disposable: T): T {
    this.items.push(disposable);
    return disposable;
  }

  /** Dispose every tracked item and empty the collection. */
  disposeAll(): void {
    for (const item of this.items.splice(0)) {
      try {
        item.dispose();
      } catch {
        // One bad disposable never blocks the rest of teardown.
      }
    }
  }

  /** `Disposable` shape: alias for `disposeAll()`. */
  dispose(): void {
    this.disposeAll();
  }

  /** Tracked count (tests and diagnostics). */
  get size(): number {
    return this.items.length;
  }
}

/**
 * Combine disposables into one handle.
 *
 * @param disposables - Handles torn down together.
 * @returns Single disposable disposing every input.
 */
export function combineDisposables(...disposables: readonly Disposable[]): Disposable {
  return {
    dispose: () => {
      for (const disposable of disposables) {
        try {
          disposable.dispose();
        } catch {
          // One bad disposable never blocks the rest of teardown.
        }
      }
    },
  };
}
