import type { RenderModelDto } from '../../hooks/useEngine';
import type { ContentBounds } from './viewport';

/** One row in the layers panel, derived from the render model. */
export interface NavigatorEntry {
  /** Engine element id. */
  id: string;
  /** Element kind (`rectangle`, `frame`, `text`, …). */
  kind: string;
  /** Human-readable name; empty when the element carries no name. */
  name: string;
  /** Nesting depth (frame children render indented). */
  depth: number;
  /** Whether the element is in the current engine selection. */
  selected: boolean;
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
  const base = [...model.base].reverse();
  for (const entry of base) {
    entries.push({
      id: entry.id,
      kind: entry.kind,
      name: entryName(entry.kind, entry.detail),
      depth: 0,
      selected: selected.has(entry.id),
    });
  }
  const passes = [...model.frames].reverse();
  for (const pass of passes) {
    entries.push({
      id: pass.frame.id,
      kind: pass.frame.kind,
      name: entryName(pass.frame.kind, pass.frame.detail),
      depth: 0,
      selected: selected.has(pass.frame.id),
    });
    const children = [...pass.children].reverse();
    for (const child of children) {
      entries.push({
        id: child.id,
        kind: child.kind,
        name: entryName(child.kind, child.detail),
        depth: 1,
        selected: selected.has(child.id),
      });
    }
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
