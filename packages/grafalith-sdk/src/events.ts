import type { Disposable } from "./commands.js";

/**
 * Built-in lifecycle events extensions subscribe to
 * (`grafalith.events.on(...)`).
 */
export type GrafalithEventName =
  | "grafalith.app.ready"
  | "grafalith.app.beforeQuit"
  | "grafalith.home.ready"
  | "grafalith.project.willOpen"
  | "grafalith.project.didOpen"
  | "grafalith.project.willClose"
  | "grafalith.project.didClose"
  | "grafalith.editor.didMount"
  | "grafalith.editor.willUnmount"
  | "grafalith.editor.tool.didChange"
  | "grafalith.canvas.selection.didChange"
  | "grafalith.layer.didAdd"
  | "grafalith.layer.didRemove"
  | "grafalith.layer.didChange"
  | `grafalith.settings.didChange:${string}`
  | `grafalith.extension.didActivate:${string}`
  | `grafalith.extension.didDeactivate:${string}`
  | `grafalith.extension.didFail:${string}`;

/**
 * Typed event bus for built-in lifecycle events. Exact names above are
 * delivered; `grafalith.settings.didChange:<key>` and extension activation
 * names match by prefix so one listener covers a family.
 */
export class GrafalithEventBus {
  private readonly listeners = new Map<string, Set<(payload: unknown) => void>>();

  /** Subscribe; returns a disposable for cleanup. */
  on(event: string, listener: (payload: unknown) => void): Disposable {
    let group = this.listeners.get(event);
    if (!group) {
      group = new Set();
      this.listeners.set(event, group);
    }
    group.add(listener);
    return { dispose: () => this.off(event, listener) };
  }

  /** Remove one listener added via `on` (same function reference). */
  off(event: string, listener: (payload: unknown) => void): void {
    const group = this.listeners.get(event);
    if (!group) return;
    group.delete(listener);
    if (group.size === 0) this.listeners.delete(event);
  }

  /** Emit one event to exact-name subscribers. */
  emit(event: string, payload?: unknown): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) listener(payload);
  }

  /** Subscriber count for one event (tests and diagnostics). */
  count(event: string): number {
    return this.listeners.get(event)?.size ?? 0;
  }
}
