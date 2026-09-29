import { LineElement, Point } from '../scene/types';
import { Viewport } from '../render/viewport';
import { Bounds, getRotatedBounds, distSqToSegment } from './geometry';

/**
 * Render a line element as a polyline.
 */
export function renderLine(
  ctx: CanvasRenderingContext2D,
  el: LineElement,
  _viewport: Viewport,
): void {
  if (el.points.length < 2) return;

  ctx.save();

  // Apply rotation around center of bounding box
  if (el.rotation !== 0) {
    const bounds = getLineBounds(el);
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    ctx.translate(cx, cy);
    ctx.rotate(el.rotation);
    ctx.translate(-cx, -cy);
  }

  ctx.globalAlpha = el.opacity / 100;
  ctx.strokeStyle = el.strokeColor;
  ctx.lineWidth = el.strokeWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (el.strokeStyle === 'dashed') {
    ctx.setLineDash([el.strokeWidth * 3, el.strokeWidth * 2]);
  } else if (el.strokeStyle === 'dotted') {
    ctx.setLineDash([el.strokeWidth, el.strokeWidth]);
  } else {
    ctx.setLineDash([]);
  }

  // Points are relative to element origin (el.x, el.y)
  ctx.beginPath();
  ctx.moveTo(el.x + el.points[0][0], el.y + el.points[0][1]);
  for (let i = 1; i < el.points.length; i++) {
    ctx.lineTo(el.x + el.points[i][0], el.y + el.points[i][1]);
  }
  ctx.stroke();

  ctx.restore();
}

/**
 * Hit-test a point against a line element.
 * Uses distance-to-segment with threshold = strokeWidth/2 + 4px tolerance.
 */
export function hitTestLine(
  px: number,
  py: number,
  el: LineElement,
): boolean {
  if (el.points.length < 2) return false;

  const threshold = el.strokeWidth / 2 + 4;
  const thresholdSq = threshold * threshold;

  // Transform hit point into local element space
  let testX = px;
  let testY = py;

  if (el.rotation !== 0) {
    const bounds = getLineBounds(el);
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    const cos = Math.cos(-el.rotation);
    const sin = Math.sin(-el.rotation);
    const dx = px - cx;
    const dy = py - cy;
    testX = dx * cos - dy * sin + cx;
    testY = dx * sin + dy * cos + cy;
  }

  // Check distance to each segment
  for (let i = 0; i < el.points.length - 1; i++) {
    const a: Point = [el.x + el.points[i][0], el.y + el.points[i][1]];
    const b: Point = [el.x + el.points[i + 1][0], el.y + el.points[i + 1][1]];
    const dSq = distSqToSegment([testX, testY], a, b);
    if (dSq <= thresholdSq) return true;
  }

  return false;
}

/**
 * Get axis-aligned bounding box of a line element.
 * Correctly handles rotation of the element's points.
 */
export function getLineBounds(el: LineElement): Bounds {
  if (el.points.length === 0) {
    return { minX: el.x, minY: el.y, maxX: el.x, maxY: el.y };
  }

  let minPX = Infinity;
  let minPY = Infinity;
  let maxPX = -Infinity;
  let maxPY = -Infinity;

  for (const [px, py] of el.points) {
    if (px < minPX) minPX = px;
    if (py < minPY) minPY = py;
    if (px > maxPX) maxPX = px;
    if (py > maxPY) maxPY = py;
  }

  const localWidth = maxPX - minPX;
  const localHeight = maxPY - minPY;
  const localX = el.x + minPX;
  const localY = el.y + minPY;

  return getRotatedBounds(localX, localY, localWidth, localHeight, el.rotation);
}
