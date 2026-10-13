import type { NavigatorEntry } from './navigator';

/**
 * Pure Layers-tree logic: selection, state-based menus, drop validation,
 * and rename validation. No React, no engine calls — the panel renders
 * from this and commits through single atomic engine ops. The engine
 * remains the final arbiter; every rejection surfaces as a typed batch
 * result the panel reports instead of applying partially.
 */

/** Group metadata mirrored from the render model. */
export interface LayersGroupInfo {
  id: string;
  name: string;
  parentGroupId: string | null;
  locked: boolean;
  effectiveLocked: boolean;
}

/** Menu intent computed from node kind, selection, and lock state. */
export type LayersIntent =
  /** Registry command executed with the menu selection. */
  | { kind: 'command'; id: string }
  /** Inline rename of the menu target. */
  | { kind: 'rename' }
  /** Unlock the named ancestor container instead of the target itself. */
  | { kind: 'unlockAncestor'; ancestorId: string; ancestorName: string };

/** Drop intent distinguished by pointer position inside the target row. */
export type DropPosition = 'before' | 'after' | 'into';

/** Concrete drop target resolved from pointer geometry. */
export type LayersDropTarget =
  | { zone: 'row'; position: DropPosition; id: string }
  | { zone: 'root'; index: number };

/** Rows indexed by node id for hierarchy walks. */
export function indexRows(rows: readonly NavigatorEntry[]): Map<string, NavigatorEntry> {
  return new Map(rows.map((row) => [row.id, row]));
}

/** Live node ids: every element row plus every known group container. */
export function liveNodeIds(
  rows: readonly NavigatorEntry[],
  groups: ReadonlyMap<string, LayersGroupInfo>,
): Set<string> {
  const live = new Set<string>();
  for (const row of rows) live.add(row.id);
  for (const id of groups.keys()) live.add(id);
  return live;
}

/**
 * Prune a tree selection to live nodes, deduplicated in order. Identity
 * follows stable node ids, never names or row indexes, so collapse/expand
 * and renames cannot corrupt it.
 */
export function pruneTreeSelection(ids: readonly string[], live: ReadonlySet<string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (id === '' || seen.has(id) || !live.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Toggle one node in a tree selection. */
export function toggleInSelection(current: readonly string[], id: string): string[] {
  return current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id];
}

/** Contiguous visible-row range between two rows, inclusive. */
export function rangeInRows(
  rows: readonly NavigatorEntry[],
  fromId: string,
  toId: string,
): string[] {
  const from = rows.findIndex((row) => row.id === fromId);
  const to = rows.findIndex((row) => row.id === toId);
  if (from < 0 || to < 0) return [];
  const [start, end] = from <= to ? [from, to] : [to, from];
  return rows.slice(start, end + 1).map((row) => row.id);
}

/** Rows visible under the collapsed set (group rows always render). */
export function visibleRows(
  rows: readonly NavigatorEntry[],
  collapsed: ReadonlySet<string>,
): NavigatorEntry[] {
  return rows.filter((row) => {
    if (row.group) return true;
    return !row.groupIds.some((groupId) => collapsed.has(groupId));
  });
}

/**
 * Ancestor chain of a node, nearest first. Elements walk their membership
 * path; groups walk the container parent chain.
 */
export function ancestorIdsOf(
  id: string,
  rows: ReadonlyMap<string, NavigatorEntry>,
  groups: ReadonlyMap<string, LayersGroupInfo>,
): string[] {
  const row = rows.get(id);
  if (row && !row.group) return [...row.groupIds];
  const chain: string[] = [];
  const seen = new Set<string>([id]);
  let parent = groups.get(id)?.parentGroupId ?? null;
  while (parent !== null && !seen.has(parent)) {
    seen.add(parent);
    chain.push(parent);
    parent = groups.get(parent)?.parentGroupId ?? null;
  }
  return chain;
}

/**
 * Reduce a selection to move roots: descendants of a selected ancestor
 * travel once with their ancestor instead of as separate moves.
 */
export function selectionRoots(
  ids: readonly string[],
  rows: ReadonlyMap<string, NavigatorEntry>,
  groups: ReadonlyMap<string, LayersGroupInfo>,
): string[] {
  const selected = new Set(ids);
  return ids.filter((id) => !ancestorIdsOf(id, rows, groups).some((ancestor) => selected.has(ancestor)));
}

/** Unique groupable roots: normalized roots minus locked-away nodes. */
export function groupableRootCount(
  ids: readonly string[],
  rows: ReadonlyMap<string, NavigatorEntry>,
  groups: ReadonlyMap<string, LayersGroupInfo>,
): number {
  return selectionRoots(ids, rows, groups).length;
}

/**
 * One selectable unit: a group container plus every member element, or a
 * lone element. Grouped nodes always travel as their whole outermost unit
 * because members of a container act as one.
 */
export interface UnitInfo {
  /** Outermost group container, or null for ungrouped nodes. */
  group: string | null;
  /** Member element ids in row order (single id for ungrouped nodes). */
  members: string[];
}

/** Resolve the selectable unit of one node id. */
export function unitOf(
  id: string,
  rows: ReadonlyMap<string, NavigatorEntry>,
  groups: ReadonlyMap<string, LayersGroupInfo>,
): UnitInfo {
  if (groups.has(id)) {
    const members: string[] = [];
    for (const row of rows.values()) {
      if (!row.group && row.groupIds.includes(id)) members.push(row.id);
    }
    return { group: id, members };
  }
  const row = rows.get(id);
  if (!row || row.group || row.groupIds.length === 0) {
    return { group: null, members: row && !row.group ? [id] : [] };
  }
  const outermost = row.groupIds[row.groupIds.length - 1];
  return { group: outermost, members: subtreeElementIds([...rows.values()], outermost) };
}

/**
 * Expand node ids to the union of their unit members for engine
 * mirroring: grouped nodes resolve to the whole outermost unit in
 * first-appearance order, ungrouped nodes pass through.
 */
export function expandUnits(
  ids: readonly string[],
  rows: ReadonlyMap<string, NavigatorEntry>,
  groups: ReadonlyMap<string, LayersGroupInfo>,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    for (const member of unitOf(id, rows, groups).members) {
      if (!seen.has(member)) {
        seen.add(member);
        out.push(member);
      }
    }
  }
  return out;
}

/**
 * Group containers fully covered by an element selection: every live
 * member selected (and at least one member exists). Tree rows for covered
 * groups highlight alongside their members as one active unit.
 */
export function coveredGroups(
  selection: readonly string[],
  rows: ReadonlyMap<string, NavigatorEntry>,
  groups: ReadonlyMap<string, LayersGroupInfo>,
): string[] {
  const selected = new Set(selection);
  const out: string[] = [];
  for (const id of groups.keys()) {
    const members = subtreeElementIds([...rows.values()], id);
    if (members.length > 0 && members.every((member) => selected.has(member))) {
      out.push(id);
    }
  }
  return out;
}

/** Direct parent group of a node, or null at the root. */
export function directParentOf(
  id: string,
  rows: ReadonlyMap<string, NavigatorEntry>,
  groups: ReadonlyMap<string, LayersGroupInfo>,
): string | null {
  const row = rows.get(id);
  if (row && !row.group) return row.groupIds[0] ?? null;
  return groups.get(id)?.parentGroupId ?? null;
}

/** Direct children of a container in row order (elements and subgroups). */
export function directChildrenOf(
  rows: readonly NavigatorEntry[],
  parentId: string | null,
  groups: ReadonlyMap<string, LayersGroupInfo>,
): string[] {
  if (parentId === null) {
    const out: string[] = [];
    for (const row of rows) {
      if (row.group) {
        if ((groups.get(row.id)?.parentGroupId ?? null) === null) out.push(row.id);
      } else if (row.groupIds.length === 0) {
        out.push(row.id);
      }
    }
    return out;
  }
  const out: string[] = [];
  for (const row of rows) {
    if (row.group) {
      if (groups.get(row.id)?.parentGroupId === parentId) out.push(row.id);
    } else if (row.groupIds[0] === parentId) {
      out.push(row.id);
    }
  }
  return out;
}

/** Why a node shows a lock indicator, if it does. */
export type LockCause =
  | { kind: 'local' }
  | { kind: 'inherited'; ancestorId: string; ancestorName: string }
  | null;

/**
 * Resolve the lock cause for one node: its own flag first, otherwise the
 * nearest locally locked ancestor by display name.
 */
export function lockCauseFor(
  id: string,
  rows: ReadonlyMap<string, NavigatorEntry>,
  groups: ReadonlyMap<string, LayersGroupInfo>,
): LockCause {
  const row = rows.get(id);
  const group = groups.get(id);
  if (row?.group ? group?.locked === true : row?.locked === true) return { kind: 'local' };
  for (const ancestor of ancestorIdsOf(id, rows, groups)) {
    const info = groups.get(ancestor);
    if (info?.locked === true) {
      return { kind: 'inherited', ancestorId: ancestor, ancestorName: info.name };
    }
  }
  return null;
}

/** True when the node is effectively locked and the flag is not its own. */
export function isInheritedOnly(
  id: string,
  rows: ReadonlyMap<string, NavigatorEntry>,
  groups: ReadonlyMap<string, LayersGroupInfo>,
): boolean {
  return lockCauseFor(id, rows, groups)?.kind === 'inherited';
}

export interface LayersMenuInput {
  rows: ReadonlyMap<string, NavigatorEntry>;
  groups: ReadonlyMap<string, LayersGroupInfo>;
  /** Pruned tree selection at menu-open time. */
  selection: readonly string[];
  /** Right-clicked node id. */
  targetId: string;
}

/**
 * Single state-based menu resolver for the Layers tree. The menu follows
 * node kind, selection size, and lock provenance — never icon state or
 * local React flags. Destructive and edit intents are withheld from
 * effectively locked targets; inherited-locked children offer the ancestor
 * unlock instead of a no-op self unlock.
 */
export function layersMenuFor(input: LayersMenuInput): LayersIntent[] {
  const { rows, groups, targetId } = input;
  const selection = input.selection.includes(targetId) ? [...input.selection] : [targetId];
  const live = (id: string): boolean => rows.has(id) || groups.has(id);
  const pruned = selection.filter(live);
  if (pruned.length === 0 || !live(targetId)) return [];

  const entryOf = (id: string): NavigatorEntry | undefined => rows.get(id);
  const causes = new Map(pruned.map((id) => [id, lockCauseFor(id, rows, groups)] as const));
  const anyEffective = pruned.some((id) => causes.get(id) !== null);
  const allEffectivelyLocked = pruned.every((id) => causes.get(id) !== null);

  if (pruned.length === 1) {
    const id = pruned[0];
    const cause = causes.get(id);
    const row = entryOf(id);
    if (cause?.kind === 'local') return [{ kind: 'command', id: 'unlock' }];
    if (cause?.kind === 'inherited') {
      return [{ kind: 'unlockAncestor', ancestorId: cause.ancestorId, ancestorName: cause.ancestorName }];
    }
    if (row?.group === true) {
      return [
        { kind: 'rename' },
        { kind: 'command', id: 'ungroup' },
        { kind: 'command', id: 'lock' },
        { kind: 'command', id: 'duplicate' },
        { kind: 'command', id: 'copy' },
        { kind: 'command', id: 'delete' },
      ];
    }
    return [
      { kind: 'rename' },
      { kind: 'command', id: 'lock' },
      { kind: 'command', id: 'duplicate' },
      { kind: 'command', id: 'copy' },
      { kind: 'command', id: 'delete' },
      { kind: 'command', id: 'bringToFront' },
      { kind: 'command', id: 'sendToBack' },
    ];
  }

  // Multi-selection: group needs at least two unique roots; destructive
  // intents stay hidden while any member is effectively locked.
  const intents: LayersIntent[] = [];
  if (!anyEffective && groupableRootCount(pruned, rows, groups) >= 2) {
    intents.push({ kind: 'command', id: 'group' });
  }
  if (allEffectivelyLocked) {
    intents.push({ kind: 'command', id: 'unlock' });
    return intents;
  }
  if (!anyEffective) {
    intents.push({ kind: 'command', id: 'duplicate' });
    intents.push({ kind: 'command', id: 'copy' });
    intents.push({ kind: 'command', id: 'delete' });
  }
  intents.push({ kind: 'command', id: 'lock' });
  return intents;
}

/** Element members of a group subtree in row order. */
export function subtreeElementIds(
  rows: readonly NavigatorEntry[],
  groupId: string,
): string[] {
  return rows.filter((row) => !row.group && row.groupIds.includes(groupId)).map((row) => row.id);
}

/**
 * Expand node ids to the element ids engine element-ops need: groups
 * unfold to their subtree members in row order, elements pass through.
 * Ancestor-covered descendants collapse so no node travels twice.
 */
export function expandToElementIds(
  ids: readonly string[],
  rows: readonly NavigatorEntry[],
  groups: ReadonlyMap<string, LayersGroupInfo>,
): string[] {
  const rowsById = indexRows(rows);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of selectionRoots(ids, rowsById, groups)) {
    if (groups.has(id)) {
      for (const member of subtreeElementIds(rows, id)) {
        if (!seen.has(member)) {
          seen.add(member);
          out.push(member);
        }
      }
    } else if (rowsById.has(id) && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/**
 * Global z-order after a same-parent BEFORE/AFTER drop. Moving roots that
 * are groups travel as their member blocks with relative order preserved.
 * The anchor derives from the visual target (rows render topmost-first,
 * the order runs back-to-front), so no index conversion can drift.
 */
export function globalReorder(
  elementOrder: readonly string[],
  rows: readonly NavigatorEntry[],
  groups: ReadonlyMap<string, LayersGroupInfo>,
  movingRoots: readonly string[],
  targetId: string,
  position: 'before' | 'after',
): string[] {
  const rowsById = indexRows(rows);
  const roots = selectionRoots(movingRoots, rowsById, groups);
  const movingElements: string[] = [];
  for (const id of roots) {
    if (groups.has(id)) movingElements.push(...subtreeElementIds(rows, id));
    else movingElements.push(id);
  }
  const moving = new Set(movingElements);
  const rank = new Map(elementOrder.map((id, index) => [id, index]));
  const block = [...movingElements].sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0));
  const rest = elementOrder.filter((id) => !moving.has(id));
  const anchor = reorderAnchor(rest, rows, groups, targetId, position);
  if (anchor === null) return [...rest, ...block];
  const at = rest.indexOf(anchor);
  return [...rest.slice(0, at), ...block, ...rest.slice(at)];
}

/** Global anchor for a visual drop: the element the block lands before. */
function reorderAnchor(
  rest: readonly string[],
  rows: readonly NavigatorEntry[],
  groups: ReadonlyMap<string, LayersGroupInfo>,
  targetId: string,
  position: 'before' | 'after',
): string | null {
  const row = rows.find((entry) => entry.id === targetId);
  if (row !== undefined && !row.group) {
    const at = rest.indexOf(targetId);
    if (at < 0) return null;
    // Above the row means after it in z-order; below means at it.
    return position === 'before' ? (rest[at + 1] ?? null) : targetId;
  }
  if (!groups.has(targetId)) return null;
  const members = rest.filter((id) => {
    const member = rows.find((entry) => entry.id === id);
    return member !== undefined && !member.group && member.groupIds.includes(targetId);
  });
  if (members.length === 0) return null;
  // Above the block means past its topmost member; below means at its base.
  return position === 'before' ? (rest[rest.indexOf(members[members.length - 1]) + 1] ?? null) : members[0];
}

/** One indentation cell of the tree guides. */
export type GuideCell = 'line' | 'blank' | 'branch' | 'end';

/**
 * Guide cells for one row, outermost level first. Root rows render none;
 * deeper rows render one cell per nesting level with a closing elbow
 * (`branch` unless the row is the last visible child, then `end`).
 * Continuation lines follow visible siblings only, so collapsing never
 * leaves a dangling guide.
 */
export function treeGuideCells(
  row: NavigatorEntry,
  visible: readonly NavigatorEntry[],
  groups: ReadonlyMap<string, LayersGroupInfo>,
  frameOf: ReadonlyMap<string, string>,
): GuideCell[] {
  if (row.depth <= 0) return [];
  const byId = indexRows(visible);
  const parentOfRow = (entry: NavigatorEntry): string | null =>
    entry.group
      ? (groups.get(entry.id)?.parentGroupId ?? null)
      : (entry.groupIds[0] ?? frameOf.get(entry.id) ?? null);
  const siblingsOf = (parent: string | null): NavigatorEntry[] =>
    visible.filter((entry) => parentOfRow(entry) === parent);
  const directParent = parentOfRow(row);
  const siblings = siblingsOf(directParent);
  const last = siblings.length > 0 && siblings[siblings.length - 1].id === row.id;
  // Ancestors above the direct parent, outermost first. The direct-parent
  // level itself renders as the closing elbow below, so every row owns
  // exactly one cell per nesting level below the root.
  const chain: string[] = row.group
    ? ancestorIdsOf(row.id, byId, groups).slice(1).reverse()
    : [...row.groupIds].slice(1).reverse();
  const selfIndex = visible.findIndex((entry) => entry.id === row.id);
  const below = selfIndex < 0 ? [] : visible.slice(selfIndex + 1);
  const insideAncestor = (id: string, ancestor: string): boolean => {
    const entry = byId.get(id);
    if (entry === undefined || id === ancestor) return false;
    return entry.group
      ? ancestorIdsOf(id, byId, groups).includes(ancestor)
      : entry.groupIds.includes(ancestor);
  };
  // A level continues while the ancestor subtree still has visible rows
  // below the current one, so collapsing never leaves a dangling guide.
  const cells: GuideCell[] = chain.map((ancestor) =>
    below.some((entry) => insideAncestor(entry.id, ancestor)) ? 'line' : 'blank',
  );
  cells.push(last ? 'end' : 'branch');
  return cells;
}

/** Glyph for one guide cell, mirroring file-tree conventions. */
export function guideGlyph(cell: GuideCell): string {
  switch (cell) {
    case 'line':
      return '┃';
    case 'branch':
      return '┣';
    case 'end':
      return '┗';
    case 'blank':
      return ' ';
  }
}

/** Rename validation shared by the inline editor and tests. */
export function validateRenameInput(raw: string): { ok: true; name: string } | { ok: false; reason: 'empty' } {
  const name = raw.trim();
  if (name === '') return { ok: false, reason: 'empty' };
  return { ok: true, name };
}

export interface DropValidation {
  ok: boolean;
  /** Stable machine-readable reason for toasts and tests. */
  reason?: string;
}

/**
 * Validate a tree drop before committing. Rejects self-drops, descendant
 * drops, cycles, and inherited-lock violations without touching the
 * document; the engine re-validates atomically on commit.
 */
export function validateTreeDrop(
  movingIds: readonly string[],
  target: LayersDropTarget,
  rows: ReadonlyMap<string, NavigatorEntry>,
  groups: ReadonlyMap<string, LayersGroupInfo>,
): DropValidation {
  const roots = selectionRoots(movingIds, rows, groups);
  if (roots.length === 0) return { ok: false, reason: 'empty-selection' };
  const moving = new Set(roots);

  if (target.zone === 'root') return { ok: true };

  const targetRow = rows.get(target.id) ?? null;
  const targetGroup = groups.get(target.id);
  if (!targetRow && !targetGroup) return { ok: false, reason: 'unknown-target' };
  if (moving.has(target.id)) return { ok: false, reason: 'drop-onto-self' };

  // A container must never land inside itself or its own descendant.
  for (const movingId of roots) {
    if (targetGroup !== undefined) {
      if (ancestorIdsOf(target.id, rows, groups).includes(movingId)) {
        return { ok: false, reason: 'drop-into-descendant' };
      }
    }
  }

  if (target.position === 'into') {
    if (targetGroup === undefined) return { ok: false, reason: 'into-requires-group' };
    if (targetGroup.effectiveLocked) return { ok: false, reason: 'destination-locked' };
    for (const movingId of roots) {
      if (isInheritedOnly(movingId, rows, groups)) {
        return { ok: false, reason: 'source-locked' };
      }
      const row = rows.get(movingId);
      if (row && !row.group && row.effectiveLocked && !row.locked) {
        return { ok: false, reason: 'source-locked' };
      }
      if (row?.group === true && groups.get(movingId)?.effectiveLocked === true) {
        return { ok: false, reason: 'source-locked' };
      }
    }
    return { ok: true };
  }

  // Before/after performs a sibling reorder at the target's parent.
  const parent = targetRow !== null && !targetRow.group
    ? (targetRow.groupIds[0] ?? null)
    : (targetGroup !== undefined ? (targetGroup.parentGroupId ?? null) : directParentOf(target.id, rows, groups));
  if (parent !== null && groups.get(parent)?.effectiveLocked === true) {
    return { ok: false, reason: 'destination-locked' };
  }
  for (const movingId of roots) {
    if (isInheritedOnly(movingId, rows, groups)) return { ok: false, reason: 'source-locked' };
  }
  return { ok: true };
}

/**
 * Parent-relative insertion index for an INTO drop: appending places the
 * node after the destination's current direct children.
 */
export function intoInsertIndex(
  rows: readonly NavigatorEntry[],
  groups: ReadonlyMap<string, LayersGroupInfo>,
  groupId: string,
): number {
  return directChildrenOf(rows, groupId, groups).length;
}

/**
 * Parent and parent-relative insertion index for a BEFORE/AFTER drop.
 *
 * Rows render topmost-first while the engine counts direct children
 * bottom-first along the z-order, so the display slot converts: dropping
 * above a row lands after it in engine order. Moving roots already inside
 * the sibling list are excluded first so indexes stay stable for
 * multi-drags.
 */
export function siblingInsertIndex(
  rows: readonly NavigatorEntry[],
  groups: ReadonlyMap<string, LayersGroupInfo>,
  targetId: string,
  position: 'before' | 'after',
  movingRoots: readonly string[],
): { parent: string | null; index: number } {
  const rowsById = indexRows(rows);
  const targetRow = rowsById.get(targetId);
  const parent = targetRow !== undefined && !targetRow.group
    ? (targetRow.groupIds[0] ?? null)
    : (groups.get(targetId)?.parentGroupId ?? directParentOf(targetId, rowsById, groups));
  const moving = new Set(movingRoots);
  const siblings = directChildrenOf(rows, parent, groups).filter((id) => !moving.has(id));
  const at = siblings.indexOf(targetId);
  if (at < 0) return { parent, index: siblings.length };
  const fromTop = position === 'before' ? at : at + 1;
  return { parent, index: siblings.length - fromTop };
}
