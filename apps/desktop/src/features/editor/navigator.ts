import type { RenderModelDto } from '../../hooks/useEngine';
import type { ContentBounds } from './viewport';

/** One row in the layers panel, derived from the render model. */
export interface NavigatorEntry {
  /** Engine node id (element id or group id). */
  id: string;
  /** Element kind (`rectangle`, `frame`, `text`, …) or `'group'`. */
  kind: string;
  /** Human-readable name; empty when the node carries no name. */
  name: string;
  /** Nesting depth (frame children render indented). */
  depth: number;
  /** Whether the row is in the current tree selection. */
  selected: boolean;
  /** Local lock flag stored on the node itself. */
  locked: boolean;
  /** Observed lock through the node or an ancestor container. */
  effectiveLocked: boolean;
  /** True for group container rows. */
  group: boolean;
  /** Membership path, innermost group first (empty for root nodes). */
  groupIds: string[];
}

/**
 * Layers rows for the render model, topmost first to match paint order.
 * Selection is a mirror of the engine session used only for highlighting.
 */
export function buildNavigatorEntries(
  model: RenderModelDto,
  selection: readonly string[],
): NavigatorEntry[] {
  const selected = new Set(selection);
  const entries: NavigatorEntry[] = [];
  const groups = new Map<string, NavigatorEntry>();
  const groupMetadata = new Map((model.groups ?? []).map((group) => [group.id, group]));
  const add = (entry: RenderModelDto['base'][number], depth = 0): void => {
    const path = (Array.isArray(entry.groupIds) ? entry.groupIds : []).slice().reverse();
    path.forEach((groupId, index) => {
      if (!groups.has(groupId)) {
        const meta = groupMetadata.get(groupId);
        groups.set(groupId, {
          id: groupId,
          kind: 'group',
          name: meta?.name ?? `Group-${groups.size + 1}`,
          depth: index,
          selected: selected.has(groupId),
          locked: meta?.locked ?? false,
          effectiveLocked: meta?.effectiveLocked ?? false,
          group: true,
          groupIds: path.slice(0, index),
        });
        entries.push(groups.get(groupId)!);
      }
    });
    entries.push({
      id: entry.id,
      kind: entry.kind,
      name: entry.label !== '' ? entry.label : entryName(entry.kind, entry.detail),
      depth: depth + path.length,
      selected: selected.has(entry.id),
      locked: entry.locked,
      effectiveLocked: entry.effectiveLocked,
      group: false,
      groupIds: entry.groupIds,
    });
  };
  const base = [...model.base].reverse();
  for (const entry of base) {
    add(entry);
  }
  const passes = [...model.frames].reverse();
  for (const pass of passes) {
    add(pass.frame);
    const children = [...pass.children].reverse();
    for (const child of children) {
      add(child, 1);
    }
  }
  for (const group of model.groups ?? []) {
    if (groups.has(group.id)) continue;
    let depth = 0;
    let parent = group.parentGroupId;
    const seen = new Set<string>();
    while (parent && !seen.has(parent)) {
      seen.add(parent);
      depth += 1;
      parent = groupMetadata.get(parent)?.parentGroupId ?? null;
    }
    const row: NavigatorEntry = {
      id: group.id,
      kind: 'group',
      name: group.name,
      depth,
      selected: selected.has(group.id),
      locked: group.locked,
      effectiveLocked: group.effectiveLocked,
      group: true,
      groupIds: [],
    };
    groups.set(group.id, row);
    entries.push(row);
  }
  return entries;
}

/** Scene-space bounds over every committed entry, or null when empty. */
export function contentBounds(model: RenderModelDto): ContentBounds | null {
  let bounds: ContentBounds | null = null;
  const visit = (minX: number, minY: number, maxX: number, maxY: number): void => {
    if (!(maxX > minX && maxY > minY)) return;
    if (!bounds) {
      bounds = { minX, minY, maxX, maxY };
      return;
    }
    bounds.minX = Math.min(bounds.minX, minX);
    bounds.minY = Math.min(bounds.minY, minY);
    bounds.maxX = Math.max(bounds.maxX, maxX);
    bounds.maxY = Math.max(bounds.maxY, maxY);
  };
  for (const entry of model.base) {
    visit(entry.bounds.minX, entry.bounds.minY, entry.bounds.maxX, entry.bounds.maxY);
  }
  for (const pass of model.frames) {
    visit(pass.frame.bounds.minX, pass.frame.bounds.minY, pass.frame.bounds.maxX, pass.frame.bounds.maxY);
    for (const child of pass.children) {
      visit(child.bounds.minX, child.bounds.minY, child.bounds.maxX, child.bounds.maxY);
    }
  }
  return bounds;
}

/** Scene-space bounds over the selected entries, or null when none match. */
export function selectionBounds(
  model: RenderModelDto,
  selection: readonly string[],
): ContentBounds | null {
  if (selection.length === 0) return null;
  const wanted = new Set(selection);
  let bounds: ContentBounds | null = null;
  const visit = (id: string, minX: number, minY: number, maxX: number, maxY: number): void => {
    if (!wanted.has(id) || !(maxX > minX && maxY > minY)) return;
    if (!bounds) {
      bounds = { minX, minY, maxX, maxY };
      return;
    }
    bounds.minX = Math.min(bounds.minX, minX);
    bounds.minY = Math.min(bounds.minY, minY);
    bounds.maxX = Math.max(bounds.maxX, maxX);
    bounds.maxY = Math.max(bounds.maxY, maxY);
  };
  for (const entry of model.base) {
    visit(entry.id, entry.bounds.minX, entry.bounds.minY, entry.bounds.maxX, entry.bounds.maxY);
  }
  for (const pass of model.frames) {
    visit(pass.frame.id, pass.frame.bounds.minX, pass.frame.bounds.minY, pass.frame.bounds.maxX, pass.frame.bounds.maxY);
    for (const child of pass.children) {
      visit(child.id, child.bounds.minX, child.bounds.minY, child.bounds.maxX, child.bounds.maxY);
    }
  }
  return bounds;
}

function entryName(kind: string, detail: { type: string } & Record<string, unknown>): string {
  if (detail.type === 'frame' && typeof detail['name'] === 'string') {
    return detail['name'] as string;
  }
  if (detail.type === 'text' && typeof detail['text'] === 'string') {
    const firstLine = (detail['text'] as string).split('\n')[0].slice(0, 24);
    if (firstLine !== '') return firstLine;
  }
  if (detail.type === 'image' && typeof detail['assetId'] === 'string') {
    const assetId = detail['assetId'] as string;
    if (assetId !== '') return assetId;
  }
  if (detail.type === 'custom' && typeof detail['typeName'] === 'string') {
    return detail['typeName'] as string;
  }
  void kind;
  return '';
}
