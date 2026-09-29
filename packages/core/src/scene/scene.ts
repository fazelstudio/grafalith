import { Element } from './types';
import { SpatialGrid } from '../spatial/spatial-grid';
import { getElementBounds } from '../shapes';

/** Callback invoked after an element is upserted. Used by arrow-binding to update bound arrows. */
export type OnAfterUpsert = (element: Element) => void;

/**
 * Callback invoked on every mutation (upsert/delete) carrying full-element snapshots.
 * HistoryManager subscribes to this to record undo/redo entries automatically.
 */
export interface MutationDelta {
  elementUpdates: Map<string, { before: Element | null; after: Element | null }>;
  /** Z-order change in the same mutation, if any. */
  orderBefore?: string[] | null;
  orderAfter?: string[] | null;
}
export type OnMutation = (delta: MutationDelta) => void;

export class Scene {
  private elements: Map<string, Element> = new Map();
  private elementOrder: string[] = [];
  private sceneNonce: number = 0;
  private afterUpsertCallbacks: OnAfterUpsert[] = [];
  private mutationCallbacks: OnMutation[] = [];
  private spatialGrid: SpatialGrid = new SpatialGrid();

  // ─── Mutation observer (used by HistoryManager) ───────────────

  /** Register a mutation listener. Called on every upsertElement / deleteElement. */
  onMutation(callback: OnMutation): void {
    this.mutationCallbacks.push(callback);
  }

  /** Remove a previously registered mutation listener. */
  offMutation(callback: OnMutation): void {
    const idx = this.mutationCallbacks.indexOf(callback);
    if (idx !== -1) this.mutationCallbacks.splice(idx, 1);
  }

  private emitMutation(delta: MutationDelta): void {
    for (const cb of this.mutationCallbacks) {
      cb(delta);
    }
  }

  // ─── After-upsert observer (used by arrow-binding) ───────────

  /** Register a callback to be called after every upsertElement. */
  onAfterUpsert(callback: OnAfterUpsert): void {
    this.afterUpsertCallbacks.push(callback);
  }

  /** Remove a previously registered callback. */
  offAfterUpsert(callback: OnAfterUpsert): void {
    const idx = this.afterUpsertCallbacks.indexOf(callback);
    if (idx !== -1) this.afterUpsertCallbacks.splice(idx, 1);
  }

  // ─── Spatial Grid ─────────────────────────────────────────────

  /** Get the spatial grid index for queries. */
  getSpatialGrid(): SpatialGrid {
    return this.spatialGrid;
  }

  private static cloneElement(el: Element): Element {
    // Deep clone nested mutable state (points, segments, overrides, stops, ...)
    // so history snapshots and stored state never alias caller-owned objects.
    // Elements are plain JSON-compatible data; structuredClone is safe.
    return structuredClone(el);
  }

  // ─── Element access ──────────────────────────────────────────

  /** Get element by id. */
  getElement(id: string): Element | undefined {
    return this.elements.get(id);
  }

  /** Get all visible (non-deleted) elements in z-order. */
  getAllElements(): Element[] {
    const result: Element[] = [];
    for (const id of this.elementOrder) {
      const el = this.elements.get(id);
      if (el && !el.isDeleted) {
        result.push(el);
      }
    }
    return result;
  }

  /** Get all elements including deleted ones, in z-order. */
  getAllElementsIncludingDeleted(): Element[] {
    const result: Element[] = [];
    for (const id of this.elementOrder) {
      const el = this.elements.get(id);
      if (el) {
        result.push(el);
      }
    }
    return result;
  }

  // ─── Mutations ───────────────────────────────────────────────

  /** Insert or update an element, bumping sceneNonce. Emits mutation with full snapshots.
   *
   * Version discipline (centralized — callers MUST NOT pre-bump):
   * new element keeps its provided version (default 0); existing element gets
   * version = previous version + 1 with a fresh versionNonce. This makes
   * version/versionNonce reliable for caches and future sync.
   */
  upsertElement(el: Element): void {
    const existing = this.elements.get(el.id);
    const before: Element | null = existing ? Scene.cloneElement(existing) : null;
    const orderBefore = [...this.elementOrder];

    // Authoritative version bump — overwrites any caller-supplied version.
    // Deep-clone input so stored state never aliases caller-owned objects.
    const input = Scene.cloneElement(el);
    const stored: Element = existing
      ? {
          ...input,
          version: existing.version + 1,
          versionNonce: Math.floor(Math.random() * 2_000_000_000),
        }
      : {
          ...input,
          version: input.version ?? 0,
          versionNonce:
            typeof input.versionNonce === 'number'
              ? input.versionNonce
              : Math.floor(Math.random() * 2_000_000_000),
        };

    if (!existing) {
      this.elementOrder.push(stored.id);
    }
    this.elements.set(stored.id, stored);
    this.sceneNonce++;

    // Keep spatial index consistent: deleted elements must NOT stay queryable.
    if (stored.isDeleted) {
      this.spatialGrid.remove(stored.id);
    } else {
      // Update spatial grid
      const bounds = getElementBounds(stored);
      this.spatialGrid.update(stored.id, bounds);
    }

    const after: Element = Scene.cloneElement(stored);
    const updates = new Map<string, { before: Element | null; after: Element | null }>();
    updates.set(stored.id, { before, after });
    // Include order delta only when z-order actually changed (creation).
    const orderChanged = !existing;
    this.emitMutation(
      orderChanged
        ? { elementUpdates: updates, orderBefore, orderAfter: [...this.elementOrder] }
        : { elementUpdates: updates },
    );

    for (const cb of this.afterUpsertCallbacks) {
      cb(Scene.cloneElement(stored));
    }
  }

  /** Soft-delete an element by setting isDeleted = true. Emits mutation with full snapshots. */
  deleteElement(id: string): void {
    const el = this.elements.get(id);
    if (el && !el.isDeleted) {
      const before: Element = Scene.cloneElement(el);
      const updated: Element = {
        ...el,
        isDeleted: true,
        version: el.version + 1,
        versionNonce: Math.floor(Math.random() * 2_000_000_000),
      };
      this.elements.set(id, updated);
      this.sceneNonce++;

      // Remove from spatial grid (deleted elements don't need to be queryable)
      this.spatialGrid.remove(id);

      const after: Element = Scene.cloneElement(updated);
      const updates = new Map<string, { before: Element | null; after: Element | null }>();
      updates.set(id, { before, after });
      this.emitMutation({ elementUpdates: updates });

      for (const cb of this.afterUpsertCallbacks) {
        cb(Scene.cloneElement(updated));
      }
    }
  }

  /**
   * Hard-delete: remove element from Map entirely (used by undo/redo to undo creation).
   * Does NOT emit mutation — called only by HistoryManager during applyEntry.
   */
  hardDelete(id: string): void {
    this.elements.delete(id);
    this.elementOrder = this.elementOrder.filter((eid) => eid !== id);
    this.spatialGrid.remove(id);
    this.sceneNonce++;
  }

  /** Get current scene nonce (for cache invalidation). */
  getSceneNonce(): number {
    return this.sceneNonce;
  }

  /** Get the number of visible (non-deleted) elements (O(n) scan, no allocation). */
  getElementCount(): number {
    let count = 0;
    for (const id of this.elementOrder) {
      const el = this.elements.get(id);
      if (el && !el.isDeleted) count++;
    }
    return count;
  }

  /** Get the element order array (z-order, shallow copy). */
  getElementOrder(): string[] {
    return [...this.elementOrder];
  }

  /** Set the element order array (replaces z-order). Emits an order mutation for history. */
  setElementOrder(order: string[]): void {
    const before = [...this.elementOrder];
    this.elementOrder = [...order];
    this.sceneNonce++;
    const updates = new Map<string, { before: Element | null; after: Element | null }>();
    this.emitMutation({ elementUpdates: updates, orderBefore: before, orderAfter: [...order] });
  }
}
