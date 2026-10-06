/**
 * Central selection normalization.
 *
 * Selection is editor interaction state mirroring the engine session, but
 * document mutations (delete, cut, import, undo pruning) can leave stale
 * ids behind. Every panel, command, and inspector reads through this
 * module instead of repairing selection independently.
 */

/** Deduplicate ids while preserving first-appearance order. */
export function dedupeIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (id === '' || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Filter a selection to live document ids. Unknown ids are dropped (they
 * may come from a stale frame, an undone delete, or a replaced document);
 * order follows the input selection so multi-select intent is preserved.
 *
 * @param selection - Engine-reported selection (possibly stale).
 * @param liveIds - Live document ids (render-model entries or status order).
 */
export function normalizeSelection(
  selection: readonly string[],
  liveIds: readonly string[] | ReadonlySet<string>,
): string[] {
  const live = liveIds instanceof Set ? liveIds : new Set(liveIds);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of selection) {
    if (id === '' || seen.has(id) || !live.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** True when two normalized selections contain the same ids in order. */
export function sameSelection(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((id, index) => id === b[index]);
}

/** Live ids from a status order vector (includes tombstone ids; callers filter via model when strict). */
export function liveIdsFromOrder(order: readonly string[]): Set<string> {
  return new Set(order);
}
