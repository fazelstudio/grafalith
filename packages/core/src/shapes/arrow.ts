import { ArrowElement, Point } from '../scene/types';
import { Viewport } from '../render/viewport';
import { Bounds, getRotatedBounds, distSqToSegment } from './geometry';

const ARROWHEAD_LENGTH = 12;
const ARROWHEAD_WIDTH = 8;

/**
 * Render an arrow element to a canvas context.
 * Draws a polyline with optional arrowheads at start/end.
 */
export function renderArrow(
  ctx: CanvasRenderingContext2D,
  el: ArrowElement,
  _viewport: Viewport,
): void {
  if (el.points.length < 2) return;

  ctx.save();

  // Apply rotation around center of bounding box
  if (el.rotation !== 0) {
    const bounds = getArrowBounds(el);
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    ctx.translate(cx, cy);
    ctx.rotate(el.rotation);
    ctx.translate(-cx, -cy);
  }

  ctx.globalAlpha = el.opacity / 100;
  ctx.strokeStyle = el.strokeColor;
  ctx.fillStyle = el.strokeColor;
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

  // Draw the polyline (points are relative to el.x, el.y)
  ctx.beginPath();
  ctx.moveTo(el.x + el.points[0][0], el.y + el.points[0][1]);
  for (let i = 1; i < el.points.length; i++) {
    ctx.lineTo(el.x + el.points[i][0], el.y + el.points[i][1]);
  }
  ctx.stroke();

  // Reset dash for arrowhead fill
  ctx.setLineDash([]);

  // Draw arrowheads
  const firstPt: Point = [el.x + el.points[0][0], el.y + el.points[0][1]];
  const lastPt: Point = [el.x + el.points[el.points.length - 1][0], el.y + el.points[el.points.length - 1][1]];
  const secondLastPt: Point = [el.x + el.points[el.points.length - 2][0], el.y + el.points[el.points.length - 2][1]];
  const secondPt: Point = [el.x + el.points[1][0], el.y + el.points[1][1]];

  if (el.endArrowhead) {
    drawArrowhead(ctx, secondLastPt, lastPt, el.strokeWidth);
  }
  if (el.startArrowhead) {
    drawArrowhead(ctx, secondPt, firstPt, el.strokeWidth);
  }

  ctx.restore();
}

/**
 * Draw a filled triangle arrowhead at the tip.
 * @param from - The point before the tip (defines direction)
 * @param tip - The tip point of the arrowhead
 */
function drawArrowhead(
  ctx: CanvasRenderingContext2D,
  from: Point,
  tip: Point,
  strokeWidth: number,
): void {
  const scale = Math.max(1, strokeWidth / 2);
  const len = ARROWHEAD_LENGTH * scale;
  const width = ARROWHEAD_WIDTH * scale;

  const dx = tip[0] - from[0];
  const dy = tip[1] - from[1];
  const angle = Math.atan2(dy, dx);

  const baseX = tip[0] - Math.cos(angle) * len;
  const baseY = tip[1] - Math.sin(angle) * len;

  const leftX = baseX + Math.cos(angle + Math.PI / 2) * (width / 2);
  const leftY = baseY + Math.sin(angle + Math.PI / 2) * (width / 2);
  const rightX = baseX + Math.cos(angle - Math.PI / 2) * (width / 2);
  const rightY = baseY + Math.sin(angle - Math.PI / 2) * (width / 2);

  ctx.beginPath();
  ctx.moveTo(tip[0], tip[1]);
  ctx.lineTo(leftX, leftY);
  ctx.lineTo(rightX, rightY);
  ctx.closePath();
  ctx.fill();
}

/**
 * Hit-test a point against an arrow element.
 * Uses distance-to-segment with threshold = strokeWidth/2 + 4px tolerance.
 */
export function hitTestArrow(
  px: number,
  py: number,
  el: ArrowElement,
): boolean {
  if (el.points.length < 2) return false;

  const threshold = el.strokeWidth / 2 + 4;
  const thresholdSq = threshold * threshold;

  let testX = px;
  let testY = py;

  if (el.rotation !== 0) {
    const bounds = getArrowBounds(el);
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    const cos = Math.cos(-el.rotation);
    const sin = Math.sin(-el.rotation);
    const dx = px - cx;
    const dy = py - cy;
    testX = dx * cos - dy * sin + cx;
    testY = dx * sin + dy * cos + cy;
  }

  for (let i = 0; i < el.points.length - 1; i++) {
    const a: Point = [el.x + el.points[i][0], el.y + el.points[i][1]];
    const b: Point = [el.x + el.points[i + 1][0], el.y + el.points[i + 1][1]];
    const dSq = distSqToSegment([testX, testY], a, b);
    if (dSq <= thresholdSq) return true;
  }

  // Arrowhead triangles are visible — clicks on the head must hit.
  if (el.endArrowhead && el.points.length >= 2) {
    const tip: Point = [el.x + el.points[el.points.length - 1][0], el.y + el.points[el.points.length - 1][1]];
    const from: Point = [el.x + el.points[el.points.length - 2][0], el.y + el.points[el.points.length - 2][1]];
    if (pointInArrowhead(testX, testY, from, tip, el.strokeWidth)) return true;
  }
  if (el.startArrowhead && el.points.length >= 2) {
    const tip: Point = [el.x + el.points[0][0], el.y + el.points[0][1]];
    const from: Point = [el.x + el.points[1][0], el.y + el.points[1][1]];
    if (pointInArrowhead(testX, testY, from, tip, el.strokeWidth)) return true;
  }

  return false;
}

/** Point-in-triangle test against a rendered arrowhead (mirrors drawArrowhead). */
function pointInArrowhead(px: number, py: number, from: Point, tip: Point, strokeWidth: number): boolean {
  const scale = Math.max(1, strokeWidth / 2);
  const len = ARROWHEAD_LENGTH * scale;
  const width = ARROWHEAD_WIDTH * scale;
  const dx = tip[0] - from[0];
  const dy = tip[1] - from[1];
  const angle = Math.atan2(dy, dx);
  const baseX = tip[0] - Math.cos(angle) * len;
  const baseY = tip[1] - Math.sin(angle) * len;
  const leftX = baseX + Math.cos(angle + Math.PI / 2) * (width / 2);
  const leftY = baseY + Math.sin(angle + Math.PI / 2) * (width / 2);
  const rightX = baseX + Math.cos(angle - Math.PI / 2) * (width / 2);
  const rightY = baseY + Math.sin(angle - Math.PI / 2) * (width / 2);
  // Barycentric sign test
  const d1 = sign(px, py, tip[0], tip[1], leftX, leftY);
  const d2 = sign(px, py, leftX, leftY, rightX, rightY);
  const d3 = sign(px, py, rightX, rightY, tip[0], tip[1]);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

function sign(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  return (px - bx) * (ay - by) - (ax - bx) * (py - by);
}

/**
 * Get axis-aligned bounding box of an arrow element.
 */
export function getArrowBounds(el: ArrowElement): Bounds {
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
