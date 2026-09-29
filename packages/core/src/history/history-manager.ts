import { Element } from '../scene/types';
import { Scene } from '../scene/scene';

/**
 * A single history entry representing a batch of element mutations.
 * `before` = null means the element did not exist before (was created by this action).
 * `after` = null means the element was deleted by this action.
 */
export interface HistoryEntry {
  elementUpdates: Map<string, { before: Element | null; after: Element | null }>;
  /** Z-order snapshot for entries that include a reorder. Null = no order change. */
  orderBefore?: string[] | null;
  orderAfter?: string[] | null;
}

type MutationListener = (entry: HistoryEntry) => void;

const DEFAULT_MAX_STACK_SIZE = 100;

/**
 * Manages undo/redo history using command pattern.
 *
 * Design choice (documented per phase spec §A scope item 2):
 * HistoryManager attaches to Scene via `Scene.onMutation()` observer.
 * Every `upsertElement` / `deleteElement` on Scene emits a mutation event
 * carrying full-element before/after snapshots. HistoryManager records these
 * into entries — no need to modify any prior-phase call sites.
 *
 * Batching: between `startBatch()` and `endBatch()`, all mutations collapse
 * into one HistoryEntry (one undo step). This ensures one drag = one undo.
 */
export class HistoryManager {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private maxStackSize: number;
  private scene: Scene;

  /** Accumulator for the current batch. Null when not batching. */
  private currentBatch: Map<string, { before: Element | null; after: Element | null }> | null = null;
  private currentBatchOrderBefore: string[] | null = null;
  private currentBatchOrderAfter: string[] | null = null;

  /** Bound mutation listener — stored so we can unregister. */
  private boundListener: MutationListener;

  constructor(scene: Scene, maxStackSize: number = DEFAULT_MAX_STACK_SIZE) {
    this.scene = scene;
    this.maxStackSize = maxStackSize;
    this.boundListener = (entry) => this.onMutation(entry);
    this.scene.onMutation(this.boundListener);
  }

  /** Detach from Scene — call when history is no longer needed. */
  destroy(): void {
    this.scene.offMutation(this.boundListener);
  }

  // ─── Batching API ──────────────────────────────────────────────

  /**
   * Start recording a batch. All mutations between startBatch/endBatch
   * collapse into one HistoryEntry (one undo step).
   */
  startBatch(): void {
    if (this.currentBatch !== null) return;
    this.currentBatch = new Map();
    this.currentBatchOrderBefore = null;
    this.currentBatchOrderAfter = null;
  }

  /**
   * End the current batch and commit it as one HistoryEntry.
   * If the batch is empty, nothing is pushed.
   * Committing a batch clears the redo stack (new action invalidates redo).
   */
  endBatch(): void {
    if (this.currentBatch === null) return;
    const hasElements = this.currentBatch.size > 0;
    const hasOrder = this.currentBatchOrderBefore !== null && this.currentBatchOrderAfter !== null;
    if (hasElements || hasOrder) {
      this.clearRedo();
      this.pushEntry({
        elementUpdates: this.currentBatch,
        orderBefore: this.currentBatchOrderBefore,
        orderAfter: this.currentBatchOrderAfter,
      });
    }
    this.currentBatch = null;
    this.currentBatchOrderBefore = null;
    this.currentBatchOrderAfter = null;
  }

  // ─── Undo / Redo ──────────────────────────────────────────────

  /** Undo the last action. Returns true if an entry was undone. */
  undo(): boolean {
    if (this.currentBatch !== null) {
      this.endBatch();
    }
    const entry = this.undoStack.pop();
    if (!entry) return false;

    this.applyEntry(entry, 'before');
    this.redoStack.push(entry);
    this.trimStack(this.redoStack);
    return true;
  }

  /** Redo the last undone action. Returns true if an entry was redone. */
  redo(): boolean {
    if (this.currentBatch !== null) return false;
    const entry = this.redoStack.pop();
    if (!entry) return false;

    this.applyEntry(entry, 'after');
    this.undoStack.push(entry);
    this.trimStack(this.undoStack);
    return true;
  }

  /** Clear redo stack — called when user performs a new action after undo. */
  clearRedo(): void {
    this.redoStack = [];
  }

  /** Check if undo is available. */
  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  /** Check if redo is available. */
  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Get the current undo stack size (for debugging/testing). */
  getUndoStackSize(): number {
    return this.undoStack.length;
  }

  /** Get the current redo stack size (for debugging/testing). */
  getRedoStackSize(): number {
    return this.redoStack.length;
  }

  // ─── Manual recording (for clipboard operations, etc.) ────────

  /**
   * Manually push a pre-built entry onto the undo stack and clear redo.
   * Used by clipboard ops that build their own entry.
   */
  recordEntry(entry: HistoryEntry): void {
    this.clearRedo();
    this.pushEntry(entry);
  }

  // ─── Internal ─────────────────────────────────────────────────

  /**
   * Called by the Scene mutation observer for every upsert/delete.
   * Accumulates into current batch or pushes immediately.
   */
  private onMutation(entry: HistoryEntry): void {
    // Type allows MutationDelta (with optional order fields) to flow here.
    const orderBefore = (entry as { orderBefore?: string[] | null }).orderBefore ?? null;
    const orderAfter = (entry as { orderAfter?: string[] | null }).orderAfter ?? null;
    if (this.currentBatch !== null) {
      for (const [id, delta] of entry.elementUpdates) {
        const existing = this.currentBatch.get(id);
        if (existing) {
          // Keep first `before`, update `after` to latest
          this.currentBatch.set(id, { before: existing.before, after: delta.after });
        } else {
          this.currentBatch.set(id, delta);
        }
      }
      if (orderBefore !== null && orderAfter !== null) {
        if (this.currentBatchOrderBefore === null) {
          this.currentBatchOrderBefore = orderBefore;
        }
        this.currentBatchOrderAfter = orderAfter;
      }
    } else {
      this.clearRedo();
      this.pushEntry(entry);
    }
  }

  private pushEntry(entry: HistoryEntry): void {
    this.undoStack.push(entry);
    this.trimStack(this.undoStack);
  }

  private trimStack(stack: HistoryEntry[]): void {
    while (stack.length > this.maxStackSize) {
      stack.shift();
    }
  }

  /**
   * Apply either the `before` or `after` side of every delta in an entry to the Scene.
   * Temporarily detaches the mutation listener to avoid recording the undo/redo itself.
   *
   * Convention:
   *   - `snapshot = null` means the element did not exist at that point.
   *   - Applying `before`: if before is null → element was created by the action → delete it.
   *     If before is non-null → element existed before → upsert it back.
   *   - Applying `after`: if after is null → element was deleted by the action → delete it.
   *     If after is non-null → element should exist → upsert it.
   */
  private applyEntry(entry: HistoryEntry, side: 'before' | 'after'): void {
    this.scene.offMutation(this.boundListener);
    try {
      for (const [id, delta] of entry.elementUpdates) {
        const snapshot = delta[side];

        if (snapshot === null) {
          // This side represents "element did not exist"
          // If we're applying 'before' and before is null → element was newly created → delete it
          // If we're applying 'after' and after is null → element was deleted → delete it
          this.scene.hardDelete(id);
        } else {
          // Upsert the full element snapshot.
          // Use silent restore path: upsertElement re-bumps version, so restore
          // the exact snapshot version afterwards via direct store write is not
          // needed for correctness of pixels; but to preserve redo identity and
          // order stability we keep elementOrder slot handling below.
          this.scene.upsertElement(snapshot);
          // Restore exact version/nonce from snapshot (upsert bumped it by +1).
          const stored = this.scene.getElement(id);
          if (stored && (stored.version !== snapshot.version || stored.versionNonce !== snapshot.versionNonce)) {
            // Direct fix-up without emitting a second mutation: mutate the stored
            // object in place is safe here because listener is detached and no
            // snapshot aliases it (snapshots were shallow-copied at record time).
            (stored as { version: number }).version = snapshot.version;
            (stored as { versionNonce: number }).versionNonce = snapshot.versionNonce;
          }
        }
      }

      // Restore z-order exactly (undo create/delete/reorder must not append at end).
      const orderSnapshot = side === 'before' ? entry.orderBefore : entry.orderAfter;
      if (orderSnapshot) {
        // Direct order restore without emitting (listener detached).
        const current = this.scene.getElementOrder();
        void current;
        // Use internal restore: set order silently by bypassing emit.
        // setElementOrder emits, but listener is detached so no history pollution;
        // sceneNonce bump is desired for render invalidation.
        this.scene.setElementOrder(orderSnapshot);
      } else if (side === 'before') {
        // Legacy entries without order snapshots: undoing a create (before=null)
        // used hardDelete which already removed the id from order — correct.
        // Redo (after) of a create re-upserts at end; preserve original position
        // by moving the id back to its index in the current order if known.
        // No-op for entries without order info.
      }
    } finally {
      this.scene.onMutation(this.boundListener);
    }
  }
}
