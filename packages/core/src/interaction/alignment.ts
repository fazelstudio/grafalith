import { Scene } from '../scene';
import { getElementBounds } from '../shapes';
import type { Bounds } from '../shapes/geometry';

/**
 * Compute the combined bounding box of multiple elements.
 * Returns null if no valid elements found.
 */
function computeCombinedBounds(scene: Scene, ids: string[]): Bounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let count = 0;

  for (const id of ids) {
    const el = scene.getElement(id);
    if (!el || el.isDeleted) continue;
    const b = getElementBounds(el);
    if (b.minX < minX) minX = b.minX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.maxY > maxY) maxY = b.maxY;
    count++;
  }

  return count > 0 ? { minX, minY, maxX, maxY } : null;
}

/**
 * Align elements to the left edge of the combined bounding box.
 * All elements shift so their left edge matches the leftmost element's left edge.
 */
export function alignLeft(scene: Scene, ids: string[]): void {
  const bounds = computeCombinedBounds(scene, ids);
  if (!bounds) return;

  for (const id of ids) {
    const el = scene.getElement(id);
    if (!el || el.isDeleted) continue;
    const b = getElementBounds(el);
    const dx = bounds.minX - b.minX;
    scene.upsertElement({ ...el, x: el.x + dx });
  }
}

/**
 * Align elements to the right edge of the combined bounding box.
 */
export function alignRight(scene: Scene, ids: string[]): void {
  const bounds = computeCombinedBounds(scene, ids);
  if (!bounds) return;

  for (const id of ids) {
    const el = scene.getElement(id);
    if (!el || el.isDeleted) continue;
    const b = getElementBounds(el);
    const dx = bounds.maxX - b.maxX;
    scene.upsertElement({ ...el, x: el.x + dx });
  }
}

/**
 * Align elements to the top edge of the combined bounding box.
 */
export function alignTop(scene: Scene, ids: string[]): void {
  const bounds = computeCombinedBounds(scene, ids);
  if (!bounds) return;

  for (const id of ids) {
    const el = scene.getElement(id);
    if (!el || el.isDeleted) continue;
    const b = getElementBounds(el);
    const dy = bounds.minY - b.minY;
    scene.upsertElement({ ...el, y: el.y + dy });
  }
}

/**
 * Align elements to the bottom edge of the combined bounding box.
 */
export function alignBottom(scene: Scene, ids: string[]): void {
  const bounds = computeCombinedBounds(scene, ids);
  if (!bounds) return;

  for (const id of ids) {
    const el = scene.getElement(id);
    if (!el || el.isDeleted) continue;
    const b = getElementBounds(el);
    const dy = bounds.maxY - b.maxY;
    scene.upsertElement({ ...el, y: el.y + dy });
  }
}

/**
 * Align elements to the horizontal center of the combined bounding box.
 */
export function alignCenterH(scene: Scene, ids: string[]): void {
  const bounds = computeCombinedBounds(scene, ids);
  if (!bounds) return;
  const centerX = (bounds.minX + bounds.maxX) / 2;

  for (const id of ids) {
    const el = scene.getElement(id);
    if (!el || el.isDeleted) continue;
    const b = getElementBounds(el);
    const elCenterX = (b.minX + b.maxX) / 2;
    const dx = centerX - elCenterX;
    scene.upsertElement({ ...el, x: el.x + dx });
  }
}

/**
 * Align elements to the vertical center of the combined bounding box.
 */
export function alignCenterV(scene: Scene, ids: string[]): void {
  const bounds = computeCombinedBounds(scene, ids);
  if (!bounds) return;
  const centerY = (bounds.minY + bounds.maxY) / 2;

  for (const id of ids) {
    const el = scene.getElement(id);
    if (!el || el.isDeleted) continue;
    const b = getElementBounds(el);
    const elCenterY = (b.minY + b.maxY) / 2;
    const dy = centerY - elCenterY;
    scene.upsertElement({ ...el, y: el.y + dy });
  }
}

/**
 * Distribute elements evenly along the horizontal axis.
 * Requires at least 3 elements. Outer elements stay fixed; inner elements shift.
 */
export function distributeHorizontal(scene: Scene, ids: string[]): void {
  if (ids.length < 3) return;

  const entries: { id: string; bounds: Bounds }[] = [];
  for (const id of ids) {
    const el = scene.getElement(id);
    if (!el || el.isDeleted) continue;
    entries.push({ id, bounds: getElementBounds(el) });
  }
  if (entries.length < 3) return;

  // Sort by left edge
  entries.sort((a, b) => a.bounds.minX - b.bounds.minX);

  const first = entries[0];
  const last = entries[entries.length - 1];
  const totalSpan = last.bounds.minX - first.bounds.minX;
  // Equal gaps with first AND last fixed: span covers (n-1) gaps plus the
  // widths of all elements EXCEPT the last (its left edge is the endpoint).
  const totalWidthExceptLast = entries
    .slice(0, -1)
    .reduce((sum, e) => sum + (e.bounds.maxX - e.bounds.minX), 0);
  const gap = (totalSpan - totalWidthExceptLast) / (entries.length - 1);

  let currentX = first.bounds.minX;
  for (let i = 0; i < entries.length; i++) {
    const el = scene.getElement(entries[i].id);
    if (!el) continue;
    const b = entries[i].bounds;
    const elWidth = b.maxX - b.minX;
    const dx = currentX - b.minX;
    scene.upsertElement({ ...el, x: el.x + dx });
    currentX += elWidth + gap;
  }
}

/**
 * Distribute elements evenly along the vertical axis.
 * Requires at least 3 elements. Outer elements stay fixed; inner elements shift.
 */
export function distributeVertical(scene: Scene, ids: string[]): void {
  if (ids.length < 3) return;

  const entries: { id: string; bounds: Bounds }[] = [];
  for (const id of ids) {
    const el = scene.getElement(id);
    if (!el || el.isDeleted) continue;
    entries.push({ id, bounds: getElementBounds(el) });
  }
  if (entries.length < 3) return;

  // Sort by top edge
  entries.sort((a, b) => a.bounds.minY - b.bounds.minY);

  const first = entries[0];
  const last = entries[entries.length - 1];
  const totalSpan = last.bounds.minY - first.bounds.minY;
  const totalHeightExceptLast = entries
    .slice(0, -1)
    .reduce((sum, e) => sum + (e.bounds.maxY - e.bounds.minY), 0);
  const gap = (totalSpan - totalHeightExceptLast) / (entries.length - 1);

  let currentY = first.bounds.minY;
  for (let i = 0; i < entries.length; i++) {
    const el = scene.getElement(entries[i].id);
    if (!el) continue;
    const b = entries[i].bounds;
    const elHeight = b.maxY - b.minY;
    const dy = currentY - b.minY;
    scene.upsertElement({ ...el, y: el.y + dy });
    currentY += elHeight + gap;
  }
}

export { computeCombinedBounds };
