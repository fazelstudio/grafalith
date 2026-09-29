import { Scene } from '../scene/scene';
import { Element, ArrowElement } from '../scene/types';
import { HistoryManager } from '../history/history-manager';

const PASTE_OFFSET = 10;

/** Internal clipboard buffer for cross-operation paste. */
let clipboardBuffer: Element[] = [];
/** Consecutive paste count for cascading offsets (reset on new copy/cut). */
let consecutivePasteCount = 0;

/**
 * Copy elements into the internal buffer and (if possible) the system clipboard.
 * Returns the deep-cloned elements that were copied.
 */
export function copyElements(scene: Scene, elementIds: string[]): Element[] {
  const elements: Element[] = [];
  for (const id of elementIds) {
    const el = scene.getElement(id);
    if (el && !el.isDeleted) {
      elements.push(structuredClone(el));
    }
  }
  clipboardBuffer = elements;
  consecutivePasteCount = 0;

  // Attempt to write to system clipboard as JSON (best-effort)
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(JSON.stringify(elements)).catch(() => {});
    }
  } catch {
    // Clipboard API not available — internal buffer still works
  }

  return elements;
}

/**
 * Paste elements from the internal buffer (or system clipboard as fallback).
 * Generates new IDs for every element and offsets position.
 * Records a single history entry for the entire paste operation.
 */
export function pasteElements(
  scene: Scene,
  history: HistoryManager,
  targetPosition?: { x: number; y: number },
): Element[] {
  if (clipboardBuffer.length === 0) return [];

  const idMap = new Map<string, string>();
  const pastedElements: Element[] = [];

  // Build a set of all element IDs being pasted (for binding remap)
  const copiedIds = new Set(clipboardBuffer.map((el) => el.id));

  // Generate new IDs for elements and groups/frames.
  for (const original of clipboardBuffer) {
    const newId = crypto.randomUUID();
    idMap.set(original.id, newId);
  }
  // Fresh group IDs for every distinct group in the buffer (prevents merge
  // of pasted copy with the original group).
  const groupIdMap = new Map<string, string>();
  for (const original of clipboardBuffer) {
    const groupIds = (original as { groupIds?: string[] }).groupIds ?? [];
    for (const gid of groupIds) {
      if (!groupIdMap.has(gid)) groupIdMap.set(gid, `group-${crypto.randomUUID()}`);
    }
  }

  // Compute cascade offset: each consecutive paste moves further (Phase 19 E).
  consecutivePasteCount += 1;
  const cascadeOffset = PASTE_OFFSET * consecutivePasteCount;

  // For targetPosition multi-paste: preserve relative layout via bbox delta.
  let deltaX = 0;
  let deltaY = 0;
  if (targetPosition && clipboardBuffer.length > 0) {
    let minX = Infinity;
    let minY = Infinity;
    for (const original of clipboardBuffer) {
      if (original.x < minX) minX = original.x;
      if (original.y < minY) minY = original.y;
    }
    deltaX = targetPosition.x + PASTE_OFFSET - minX;
    deltaY = targetPosition.y + PASTE_OFFSET - minY;
  }

  // Create the pasted elements with new IDs
  for (const original of clipboardBuffer) {
    const newId = idMap.get(original.id)!;
    const cloned = structuredClone(original) as Element & {
      groupIds?: string[];
      frameId?: string | null;
      containerId?: string | null;
    };

    // Remap arrow bindings
    if (cloned.type === 'arrow') {
      const arrow = cloned as ArrowElement;

      if (arrow.startBinding) {
        if (copiedIds.has(arrow.startBinding.elementId)) {
          arrow.startBinding = {
            ...arrow.startBinding,
            elementId: idMap.get(arrow.startBinding.elementId)!,
          };
        } else {
          arrow.startBinding = null;
        }
      }

      if (arrow.endBinding) {
        if (copiedIds.has(arrow.endBinding.elementId)) {
          arrow.endBinding = {
            ...arrow.endBinding,
            elementId: idMap.get(arrow.endBinding.elementId)!,
          };
        } else {
          arrow.endBinding = null;
        }
      }
    }

    // Remap group membership to fresh groups.
    if (Array.isArray(cloned.groupIds)) {
      cloned.groupIds = cloned.groupIds.map((gid) => groupIdMap.get(gid) ?? gid);
    }
    // Remap frame/container parent: if referenced parent is in the buffer,
    // point at its new id; otherwise detach (null) to avoid joining the
    // original parent or leaking across documents.
    if (typeof cloned.frameId === 'string' && cloned.frameId !== null) {
      cloned.frameId = cloned.frameId && idMap.has(cloned.frameId as string)
        ? idMap.get(cloned.frameId as string)!
        : null;
    }
    if (typeof cloned.containerId === 'string' && cloned.containerId !== null) {
      const cid = cloned.containerId as unknown as string;
      cloned.containerId = (idMap.has(cid) ? idMap.get(cid)! : null) as unknown as null;
    }

    // Fresh identity: new version stream, nonce, and seed variation.
    // (Scene.upsertElement is authoritative for version/nonce, but set sane
    // values here too for callers that inspect the returned objects.)
    (cloned as { version?: number }).version = 0;
    (cloned as { versionNonce?: number }).versionNonce = Math.floor(Math.random() * 2_000_000_000);
    if ('seed' in cloned && typeof (cloned as { seed?: unknown }).seed === 'number') {
      (cloned as { seed: number }).seed = Math.floor(Math.random() * 2_000_000_000);
    }
    // Pasted content starts unlocked and visible; inheriting lock/hidden
    // from the source is surprising (unmovable pastes, invisible duplicates).
    if ('locked' in cloned) (cloned as { locked: boolean }).locked = false;

    // Apply offset
    if (targetPosition) {
      cloned.x = original.x + deltaX;
      cloned.y = original.y + deltaY;
    } else {
      cloned.x = original.x + cascadeOffset;
      cloned.y = original.y + cascadeOffset;
    }

    cloned.id = newId;
    pastedElements.push(cloned);
  }

  // Use batch to collapse all upserts into one undo step
  history.startBatch();
  try {
    for (const el of pastedElements) {
      scene.upsertElement(el);
    }
  } finally {
    history.endBatch();
  }

  return pastedElements;
}

/**
 * Duplicate selected elements in-place (no system clipboard involved).
 * Same as copy+paste but one atomic operation, always works even if
 * clipboard permission is denied.
 */
export function duplicateElements(
  scene: Scene,
  history: HistoryManager,
  elementIds: string[],
): Element[] {
  const elements: Element[] = [];
  for (const id of elementIds) {
    const el = scene.getElement(id);
    if (el && !el.isDeleted) {
      elements.push(structuredClone(el));
    }
  }

  const savedBuffer = clipboardBuffer;
  clipboardBuffer = elements;
  const savedPasteCount = consecutivePasteCount;
  consecutivePasteCount = 0;
  try {
    const pasted = pasteElements(scene, history);
    return pasted;
  } finally {
    clipboardBuffer = savedBuffer;
    consecutivePasteCount = savedPasteCount;
  }
}

/**
 * Cut elements: copy to buffer then soft-delete originals.
 * Records a single history entry for the combined operation.
 */
export function cutElements(
  scene: Scene,
  history: HistoryManager,
  elementIds: string[],
): Element[] {
  const copied = copyElements(scene, elementIds);
  if (copied.length === 0) return [];

  // Use batch so all deletes collapse into one undo step
  history.startBatch();
  try {
    for (const id of elementIds) {
      const el = scene.getElement(id);
      if (el && !el.isDeleted) {
        scene.deleteElement(id);
      }
    }
  } finally {
    history.endBatch();
  }

  return copied;
}

/** Get the current internal clipboard buffer (for testing/debugging). */
export function getClipboardBuffer(): readonly Element[] {
  return clipboardBuffer;
}

/** Clear the internal clipboard buffer. */
export function clearClipboardBuffer(): void {
  clipboardBuffer = [];
  consecutivePasteCount = 0;
}
