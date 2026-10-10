// Typed event bus for built-in lifecycle events (`grafalith.*`).
//
// The extension host fires these; extensions subscribe through their
// workspace/events surface or the `grafalith.events` facade. Names below
// are the contract — adding a name is additive, renaming is breaking.

/** Built-in lifecycle events extensions subscribe to. */
export type GrafalithEventName =
  | 'grafalith.app.ready'
  | 'grafalith.app.beforeQuit'
  | 'grafalith.home.ready'
  | 'grafalith.project.willOpen'
  | 'grafalith.project.didOpen'
  | 'grafalith.project.willClose'
  | 'grafalith.project.didClose'
  | 'grafalith.editor.didMount'
  | 'grafalith.editor.willUnmount'
  | 'grafalith.editor.tool.didChange'
  | 'grafalith.canvas.selection.didChange'
  | 'grafalith.layer.didAdd'
  | 'grafalith.layer.didRemove'
  | 'grafalith.layer.didChange'
  | 'grafalith.settings.didChange'
  | 'grafalith.extension.didActivate'
  | 'grafalith.extension.didDeactivate'
  | 'grafalith.extension.didFail';

/** Payload per event (unknown keys carry string payloads, e.g. settings). */
export type GrafalithEventPayload = Record<string, unknown>;

/**
 * Window-shared typed bus. Exact names deliver; `prefix:` listeners
 * (settings keys, extension ids) match by prefix so one subscriber
 * covers a family (`grafalith.settings.didChange:theme`).
 */
export class AppEventBus {
  private readonly listeners = new Map<string, Set<(payload: GrafalithEventPayload) => void>>();

  /** Subscribe; returns a disposable for cleanup. */
  on(event: string, listener: (payload: GrafalithEventPayload) => void): { dispose(): void } {
    let group = this.listeners.get(event);
    if (!group) {
      group = new Set();
      this.listeners.set(event, group);
    }
    group.add(listener);
    return { dispose: () => void group.delete(listener) };
  }

  /** Emit one event to exact-name plus `prefix:` family subscribers. */
  emit(event: string, payload: GrafalithEventPayload = {}): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) listener(payload);
    const family = event.split(':')[0];
    if (family !== event) {
      for (const listener of [...(this.listeners.get(`${family}:`) ?? [])]) listener(payload);
    }
  }

  /** Subscriber count (tests and diagnostics). */
  count(event: string): number {
    return this.listeners.get(event)?.size ?? 0;
  }
}

let sharedBus: AppEventBus | null = null;

/** Window-shared event bus (one registry per window). */
export function getAppEvents(): AppEventBus {
  if (!sharedBus) sharedBus = new AppEventBus();
  return sharedBus;
}

/** Drop the shared bus (tests and full teardown). */
export function resetAppEvents(): void {
  sharedBus = null;
}
