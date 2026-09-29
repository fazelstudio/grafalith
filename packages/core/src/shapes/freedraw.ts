import { FreedrawElement, Point } from '../scene/types';
import { Viewport } from '../render/viewport';
import { Bounds, getRotatedBounds, distSqToSegment } from './geometry';

/**
 * Render a freedraw element as a smooth curve using quadratic interpolation.
 * Points are connected with smooth curves instead of jagged straight lines.
 */
export function renderFreedraw(
  ctx: CanvasRenderingContext2D,
  el: FreedrawElement,
  _viewport: Viewport,
): void {
  if (el.points.length < 2) return;

  ctx.save();

  // Apply rotation around center of bounding box
  if (el.rotation !== 0) {
    const bounds = getFreedrawBounds(el);
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

  // Points are relative to element origin (el.x, el.y)
  ctx.beginPath();
  ctx.moveTo(el.x + el.points[0][0], el.y + el.points[0][1]);

  if (el.points.length === 2) {
    ctx.lineTo(el.x + el.points[1][0], el.y + el.points[1][1]);
  } else {
    // Use quadratic curve through midpoints for smooth rendering
    for (let i = 1; i < el.points.length - 1; i++) {
      const curr = el.points[i];
      const next = el.points[i + 1];
      const midX = (curr[0] + next[0]) / 2;
      const midY = (curr[1] + next[1]) / 2;
      ctx.quadraticCurveTo(
        el.x + curr[0],
        el.y + curr[1],
        el.x + midX,
        el.y + midY,
      );
    }
    // Draw to the last point
    const last = el.points[el.points.length - 1];
    ctx.lineTo(el.x + last[0], el.y + last[1]);
  }

  ctx.stroke();
  ctx.restore();
}

/**
 * Hit-test a point against a freedraw element.
 * Uses distance-to-segment with threshold = strokeWidth/2 + 4px tolerance.
 */
export function hitTestFreedraw(
  px: number,
  py: number,
  el: FreedrawElement,
): boolean {
  if (el.points.length < 2) return false;

  const threshold = el.strokeWidth / 2 + 4;
  const thresholdSq = threshold * threshold;

  // Transform hit point into local element space
  let testX = px;
  let testY = py;

  if (el.rotation !== 0) {
    const bounds = getFreedrawBounds(el);
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    const cos = Math.cos(-el.rotation);
    const sin = Math.sin(-el.rotation);
    const dx = px - cx;
    const dy = py - cy;
    testX = dx * cos - dy * sin + cx;
    testY = dx * sin + dy * cos + cy;
  }

  // Check distance to each raw segment. NOTE: render smooths with
  // quadratic midpoints, so the visible curve can deviate a few px from
  // these chords on sharp turns (known RENDER-vs-HIT quirk, documented
  // rather than "fixed" here to preserve pinned vertex-hit behavior).
  for (let i = 0; i < el.points.length - 1; i++) {
    const a: Point = [el.x + el.points[i][0], el.y + el.points[i][1]];
    const b: Point = [el.x + el.points[i + 1][0], el.y + el.points[i + 1][1]];
    const dSq = distSqToSegment([testX, testY], a, b);
    if (dSq <= thresholdSq) return true;
  }

  return false;
}

/**
 * Get axis-aligned bounding box of a freedraw element.
 * Correctly handles rotation.
 */
export function getFreedrawBounds(el: FreedrawElement): Bounds {
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
