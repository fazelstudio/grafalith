/**
 * Lightweight pub-sub event emitter.
 *
 * Generic map from event type to callback payload. No external dependencies.
 * Each `on()` call returns an unsubscribe function for easy cleanup.
 *
 * Listeners are stored as `(payload: never) => void`: any concrete callback
 * is assignable to it (contravariance), and `emit` casts the payload back at
 * the single dispatch point — no `any` needed anywhere.
 */
export class EventEmitter<Events extends Record<string, unknown>> {
  private listeners = new Map<keyof Events, Set<(payload: never) => void>>();

  /**
   * Subscribe to an event.
   * @returns Unsubscribe function — call to remove the listener.
   */
  on<K extends keyof Events>(event: K, callback: (payload: Events[K]) => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    const stored = callback as (payload: never) => void;
    this.listeners.get(event)!.add(stored);
    return () => {
      this.listeners.get(event)?.delete(stored);
    };
  }

  /**
   * Emit an event with payload to all registered listeners.
   * Isolated: one throwing listener does not starve the rest (reported via
   * console.error). Iterates a snapshot so unsubscribe-during-emit is safe.
   */
  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const listeners = this.listeners.get(event);
    if (!listeners || listeners.size === 0) return;
    const snapshot = Array.from(listeners);
    for (const cb of snapshot) {
      try {
        cb(payload as never);
      } catch (err) {
         
        console.error(`[fazelidraw] event listener for "${String(event)}" threw:`, err);
      }
    }
  }

  /** Remove all listeners for a given event, or all events if omitted. */
  removeAllListeners(event?: keyof Events): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }
}
