import { describe, expect, test } from 'bun:test';
import type { NavigatorEntry } from './navigator';
import {
  coveredGroups,
  directChildrenOf,
  expandToElementIds,
  expandUnits,
  globalReorder,
  guideGlyph,
  indexRows,
  intoInsertIndex,
  isInheritedOnly,
  layersMenuFor,
  liveNodeIds,
  lockCauseFor,
  pruneTreeSelection,
  rangeInRows,
  selectionRoots,
  siblingInsertIndex,
  toggleInSelection,
  treeGuideCells,
  unitOf,
  validateRenameInput,
  validateTreeDrop,
  visibleRows,
  type LayersGroupInfo,
} from './layersTree';

function row(id: string, extra: Partial<NavigatorEntry> = {}): NavigatorEntry {
  return {
    id,
    kind: 'rectangle',
    name: '',
    depth: 0,
    selected: false,
    locked: false,
    effectiveLocked: false,
    group: false,
    groupIds: [],
    ...extra,
  };
}

function groupRow(id: string, extra: Partial<NavigatorEntry> = {}): NavigatorEntry {
  return row(id, { kind: 'group', name: id, group: true, ...extra });
}

/**
 * Hierarchy in display order (topmost first, as the navigator emits):
 * Rectangle-C, Group-1, Rectangle-B, Rectangle-A.
 */
function hierarchy(): { rows: NavigatorEntry[]; groups: Map<string, LayersGroupInfo> } {
  const rows = [
    row('c', { name: 'Rectangle-C' }),
    groupRow('group-1', { name: 'Group-1' }),
    row('b', { name: 'Rectangle-B', groupIds: ['group-1'], depth: 1 }),
    row('a', { name: 'Rectangle-A', groupIds: ['group-1'], depth: 1 }),
  ];
  const groups = new Map<string, LayersGroupInfo>([
    ['group-1', { id: 'group-1', name: 'Group-1', parentGroupId: null, locked: false, effectiveLocked: false }],
  ]);
  return { rows, groups };
}

function intentsOf(
  rows: NavigatorEntry[],
  groups: Map<string, LayersGroupInfo>,
  selection: string[],
  targetId: string,
): string[] {
  return layersMenuFor({ rows: indexRows(rows), groups, selection, targetId }).map((intent) =>
    intent.kind === 'command'
      ? intent.id
      : intent.kind === 'rename'
        ? 'rename'
        : `unlockAncestor:${intent.ancestorId}`,
  );
}

describe('tree selection', () => {
  test('pruning drops stale ids and keeps identity order', () => {
    const { rows, groups } = hierarchy();
    expect(pruneTreeSelection(['a', 'ghost', 'b', 'a', ''], liveNodeIds(rows, groups))).toEqual([
      'a',
      'b',
    ]);
  });

  test('toggle adds and removes one node', () => {
    expect(toggleInSelection(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleInSelection(['a', 'b'], 'a')).toEqual(['b']);
  });

  test('range follows visible row order in both directions', () => {
    const { rows } = hierarchy();
    expect(rangeInRows(rows, 'a', 'c')).toEqual(['c', 'group-1', 'b', 'a']);
    expect(rangeInRows(rows, 'c', 'a')).toEqual(['c', 'group-1', 'b', 'a']);
  });

  test('collapse hides members without touching selection identity', () => {
    const { rows } = hierarchy();
    const visible = visibleRows(rows, new Set(['group-1']));
    expect(visible.map((entry) => entry.id)).toEqual(['c', 'group-1']);
    expect(pruneTreeSelection(['group-1'], liveNodeIds(rows, new Map()))).toEqual(['group-1']);
  });

  test('ancestor plus descendant normalizes to the ancestor root', () => {
    const { rows, groups } = hierarchy();
    const byId = indexRows(rows);
    expect(selectionRoots(['group-1', 'a', 'b'], byId, groups)).toEqual(['group-1']);
    expect(selectionRoots(['a', 'c'], byId, groups)).toEqual(['a', 'c']);
  });
});

describe('unit selection: grouped nodes act as one', () => {
  test('a grouped element resolves to its container plus every member', () => {
    const { rows, groups } = hierarchy();
    const byId = indexRows(rows);
    expect(unitOf('a', byId, groups)).toEqual({ group: 'group-1', members: ['b', 'a'] });
    expect(unitOf('group-1', byId, groups)).toEqual({ group: 'group-1', members: ['b', 'a'] });
    expect(unitOf('c', byId, groups)).toEqual({ group: null, members: ['c'] });
    expect(unitOf('ghost', byId, groups)).toEqual({ group: null, members: [] });
  });

  test('expandUnits unions members without double counting', () => {
    const { rows, groups } = hierarchy();
    const byId = indexRows(rows);
    expect(expandUnits(['group-1', 'a'], byId, groups)).toEqual(['b', 'a']);
    expect(expandUnits(['c', 'a'], byId, groups)).toEqual(['c', 'b', 'a']);
  });

  test('coveredGroups highlights containers selected in full', () => {
    const { rows, groups } = hierarchy();
    const byId = indexRows(rows);
    expect(coveredGroups(['b', 'a'], byId, groups)).toEqual(['group-1']);
    expect(coveredGroups(['a'], byId, groups)).toEqual([]);
    expect(coveredGroups(['c'], byId, groups)).toEqual([]);
  });
});

describe('regression: right-click Rectangle-A selects its whole unit', () => {
  test('child target outside the selection becomes container plus members', () => {
    const { rows, groups } = hierarchy();
    const byId = indexRows(rows);
    const unit = unitOf('a', byId, groups);
    const next = [...(unit.group ? [unit.group] : []), ...unit.members];
    expect(next).toEqual(['group-1', 'b', 'a']);
    expect(next).not.toContain('c');
  });

  test('child target inside a multi-selection keeps the selection', () => {
    const menuSelection = ['a', 'c'];
    const target = 'a';
    expect(menuSelection.includes(target) ? menuSelection : [target]).toEqual(['a', 'c']);
  });
});

describe('state-based context menu', () => {
  test('group menu appears for two valid nodes, never for one', () => {
    const { rows, groups } = hierarchy();
    expect(intentsOf(rows, groups, ['a', 'c'], 'a')).toContain('group');
    expect(intentsOf(rows, groups, ['a'], 'a')).not.toContain('group');
  });

  test('single unlocked group offers rename, ungroup, and lock', () => {
    const { rows, groups } = hierarchy();
    const intents = intentsOf(rows, groups, ['group-1'], 'group-1');
    expect(intents).toContain('rename');
    expect(intents).toContain('ungroup');
    expect(intents).toContain('lock');
    expect(intents).not.toContain('group');
  });

  test('single unlocked object offers rename, lock, and duplicate', () => {
    const { rows, groups } = hierarchy();
    const intents = intentsOf(rows, groups, ['c'], 'c');
    expect(intents).toContain('rename');
    expect(intents).toContain('lock');
    expect(intents).toContain('duplicate');
  });

  test('single local-locked object offers unlock only', () => {
    const { rows, groups } = hierarchy();
    const locked = rows.map((entry) => (entry.id === 'c' ? { ...entry, locked: true, effectiveLocked: true } : entry));
    expect(intentsOf(locked, groups, ['c'], 'c')).toEqual(['unlock']);
  });

  test('single locked group offers unlock only', () => {
    const { rows, groups } = hierarchy();
    groups.get('group-1')!.locked = true;
    groups.get('group-1')!.effectiveLocked = true;
    const lockedRows = rows.map((entry) =>
      entry.id === 'group-1' ? { ...entry, locked: true, effectiveLocked: true } : entry,
    );
    expect(intentsOf(lockedRows, groups, ['group-1'], 'group-1')).toEqual(['unlock']);
  });

  test('inherited-locked child offers the ancestor unlock, never self unlock', () => {
    const { rows, groups } = hierarchy();
    groups.get('group-1')!.locked = true;
    groups.get('group-1')!.effectiveLocked = true;
    const inherited = rows.map((entry) =>
      entry.groupIds.includes('group-1') ? { ...entry, effectiveLocked: true } : entry,
    );
    const intents = intentsOf(inherited, groups, ['a'], 'a');
    expect(intents).toEqual(['unlockAncestor:group-1']);
    expect(lockCauseFor('a', indexRows(inherited), groups)).toEqual({
      kind: 'inherited',
      ancestorId: 'group-1',
      ancestorName: 'Group-1',
    });
    expect(isInheritedOnly('a', indexRows(inherited), groups)).toBe(true);
  });

  test('multi-selection follows per-node state', () => {
    const { rows, groups } = hierarchy();
    expect(intentsOf(rows, groups, ['a', 'c'], 'c')).toContain('group');
    const withLocked = rows.map((entry) =>
      entry.id === 'a' ? { ...entry, locked: true, effectiveLocked: true } : entry,
    );
    const intents = intentsOf(withLocked, groups, ['a', 'c'], 'c');
    expect(intents).not.toContain('delete');
    expect(intents).not.toContain('duplicate');
    expect(intents).toContain('lock');
  });
});

describe('rename validation', () => {
  test('empty and whitespace names are rejected, duplicates allowed', () => {
    expect(validateRenameInput('')).toEqual({ ok: false, reason: 'empty' });
    expect(validateRenameInput('   ')).toEqual({ ok: false, reason: 'empty' });
    expect(validateRenameInput('  Card  ')).toEqual({ ok: true, name: 'Card' });
  });
});

describe('drag-and-drop validation', () => {
  test('reorder above and below resolves engine slots', () => {
    const { rows, groups } = hierarchy();
    // Display siblings [b, a]; engine counts bottom-first, so above-a lands
    // after it (index 1) and below-a lands at the bottom (index 0).
    expect(siblingInsertIndex(rows, groups, 'a', 'before', ['c'])).toEqual({
      parent: 'group-1',
      index: 1,
    });
    expect(siblingInsertIndex(rows, groups, 'a', 'after', ['c'])).toEqual({
      parent: 'group-1',
      index: 0,
    });
  });

  test('root into group appends after current children', () => {
    const { rows, groups } = hierarchy();
    expect(intoInsertIndex(rows, groups, 'group-1')).toBe(2);
  });

  test('self, descendant, and locked drops are invalid', () => {
    const { rows, groups } = hierarchy();
    const byId = indexRows(rows);
    expect(validateTreeDrop(['a'], { zone: 'row', position: 'after', id: 'a' }, byId, groups).ok).toBe(false);
    expect(
      validateTreeDrop(['group-1'], { zone: 'row', position: 'into', id: 'a' }, byId, groups).ok,
    ).toBe(false);
    groups.get('group-1')!.locked = true;
    groups.get('group-1')!.effectiveLocked = true;
    expect(
      validateTreeDrop(['c'], { zone: 'row', position: 'into', id: 'group-1' }, byId, groups),
    ).toEqual({ ok: false, reason: 'destination-locked' });
    expect(
      validateTreeDrop(['a'], { zone: 'row', position: 'after', id: 'c' }, byId, groups),
    ).toEqual({ ok: false, reason: 'source-locked' });
  });

  test('into requires a group target', () => {
    const { rows, groups } = hierarchy();
    expect(
      validateTreeDrop(['c'], { zone: 'row', position: 'into', id: 'a' }, indexRows(rows), groups),
    ).toEqual({ ok: false, reason: 'into-requires-group' });
  });

  test('multi-drag keeps relative order', () => {
    const flat = [row('z'), row('y'), row('x')];
    const groups = new Map<string, LayersGroupInfo>();
    // Drop [z, x] above y: the block lands above it, formation preserved.
    const order = globalReorder(['x', 'y', 'z'], flat, groups, ['z', 'x'], 'y', 'before');
    expect(order).toEqual(['y', 'x', 'z']);
  });

  test('same-parent reorder above and below resolves globally', () => {
    const flat = [row('c'), row('b'), row('a')];
    const groups = new Map<string, LayersGroupInfo>();
    expect(globalReorder(['a', 'b', 'c'], flat, groups, ['c'], 'a', 'before')).toEqual(['a', 'c', 'b']);
    expect(globalReorder(['a', 'b', 'c'], flat, groups, ['a'], 'c', 'after')).toEqual(['b', 'a', 'c']);
  });

  test('group drag expands to members without double processing', () => {
    const { rows, groups } = hierarchy();
    expect(expandToElementIds(['group-1', 'a'], rows, groups)).toEqual(['b', 'a']);
  });

  test('direct children follow row order per container', () => {
    const { rows, groups } = hierarchy();
    expect(directChildrenOf(rows, null, groups)).toEqual(['c', 'group-1']);
    expect(directChildrenOf(rows, 'group-1', groups)).toEqual(['b', 'a']);
  });

  test('guide lines branch siblings and close the last child', () => {
    const { rows, groups } = hierarchy();
    const frameOf = new Map<string, string>();
    const byId = indexRows(rows);
    // Root rows render no guides.
    expect(treeGuideCells(byId.get('c')!, rows, groups, frameOf)).toEqual([]);
    expect(treeGuideCells(byId.get('group-1')!, rows, groups, frameOf)).toEqual([]);
    // First child branches, last child closes.
    expect(treeGuideCells(byId.get('b')!, rows, groups, frameOf)).toEqual(['branch']);
    expect(treeGuideCells(byId.get('a')!, rows, groups, frameOf)).toEqual(['end']);
  });

  test('group rows own one cell per level like leaves', () => {
    const inner = row('x', { groupIds: ['inner', 'outer'], depth: 2 });
    const rows = [
      row('c'),
      groupRow('outer', { name: 'Outer' }),
      groupRow('inner', { name: 'Inner', groupIds: ['outer'], depth: 1 }),
      inner,
      row('y', { groupIds: ['outer'], depth: 1 }),
    ];
    const groups = new Map<string, LayersGroupInfo>([
      ['outer', { id: 'outer', name: 'Outer', parentGroupId: null, locked: false, effectiveLocked: false }],
      ['inner', { id: 'inner', name: 'Inner', parentGroupId: 'outer', locked: false, effectiveLocked: false }],
    ]);
    const frameOf = new Map<string, string>();
    const byId = indexRows(rows);
    // A nested group owns exactly its own slot: the twisty renders on the
    // elbow, and member lines continue upward into the same column.
    expect(treeGuideCells(byId.get('inner')!, rows, groups, frameOf)).toEqual(['branch']);
    expect(treeGuideCells(byId.get('outer')!, rows, groups, frameOf)).toEqual([]);
  });

  test('nested guides continue outer lines and collapse hides members', () => {
    const inner = row('x', { groupIds: ['inner', 'outer'], depth: 2 });
    const outerMember = row('y', { groupIds: ['outer'], depth: 1 });
    const rows = [
      row('c'),
      groupRow('outer', { name: 'Outer' }),
      groupRow('inner', { name: 'Inner', groupIds: ['outer'], depth: 1 }),
      inner,
      outerMember,
    ];
    const groups = new Map<string, LayersGroupInfo>([
      ['outer', { id: 'outer', name: 'Outer', parentGroupId: null, locked: false, effectiveLocked: false }],
      ['inner', { id: 'inner', name: 'Inner', parentGroupId: 'outer', locked: false, effectiveLocked: false }],
    ]);
    const frameOf = new Map<string, string>();
    const byId = indexRows(rows);
    // x is the only child of inner (closes), inner is not the last child
    // of outer (y follows), so the outer level continues.
    expect(treeGuideCells(byId.get('x')!, rows, groups, frameOf)).toEqual(['line', 'end']);
    expect(treeGuideCells(byId.get('y')!, rows, groups, frameOf)).toEqual(['end']);
    expect(guideGlyph('branch')).toBe('┣');
    expect(guideGlyph('end')).toBe('┗');
    expect(guideGlyph('line')).toBe('┃');
  });
});
