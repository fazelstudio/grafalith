import { PathElement, PathSegment, Point } from '../scene/types';
import { Viewport } from '../render/viewport';
import { Bounds, distSqToSegment, getRotatedBounds } from './geometry';
import { resolveFillStyle } from '../render/fill-style';

/** Number of samples per Bezier segment for flatten/hit-test. */
const FLATTEN_SAMPLES = 10;

/**
 * Render a path element to a canvas context.
 * Draws cubic Bezier curves between anchor points.
 */
export function renderPath(
  ctx: CanvasRenderingContext2D,
  el: PathElement,
  _viewport: Viewport,
): void {
  if (el.segments.length === 0) return;

  ctx.save();

  // Apply rotation around center
  if (el.rotation !== 0) {
    const bounds = getPathBounds(el);
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

  // Build the canvas path
  ctx.beginPath();
  const first = el.segments[0].point;
  ctx.moveTo(el.x + first[0], el.y + first[1]);

  for (let i = 1; i < el.segments.length; i++) {
    const prev = el.segments[i - 1];
    const curr = el.segments[i];
    drawSegment(ctx, el, prev, curr);
  }

  if (el.closed && el.segments.length > 1) {
    // Close: curve from last segment back to first
    const last = el.segments[el.segments.length - 1];
    const firstSeg = el.segments[0];
    drawSegment(ctx, el, last, firstSeg);
    ctx.closePath();
  }

  // Draw fill if closed and backgroundColor is not transparent
  if (el.closed) {
    const bg = el.backgroundColor;
    const bounds = getPathBounds(el);
    if (!(bg.type === 'solid' && bg.color === 'transparent')) {
      ctx.fillStyle = resolveFillStyle(ctx, bg, bounds);
      ctx.fill();
    }
  }

  // Draw stroke
  if (el.strokeColor !== 'transparent') {
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * Draw a single segment (cubic Bezier or straight line) between two PathSegments.
 */
function drawSegment(
  ctx: CanvasRenderingContext2D,
  el: PathElement,
  prev: PathSegment,
  curr: PathSegment,
): void {
  const px = el.x + prev.point[0];
  const py = el.y + prev.point[1];
  const cx = el.x + curr.point[0];
  const cy = el.y + curr.point[1];

  if (prev.handleOut || curr.handleIn) {
    // Cubic Bezier: control points are relative to anchor
    const cp1x = px + (prev.handleOut ? prev.handleOut[0] : 0);
    const cp1y = py + (prev.handleOut ? prev.handleOut[1] : 0);
    const cp2x = cx + (curr.handleIn ? curr.handleIn[0] : 0);
    const cp2y = cy + (curr.handleIn ? curr.handleIn[1] : 0);
    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, cx, cy);
  } else {
    ctx.lineTo(cx, cy);
  }
}

/**
 * Hit-test a point against a path element.
 * Closed paths with fill use point-in-polygon on flattened curve.
 * Open paths or no-fill use distance-to-polyline.
 */
export function hitTestPath(
  px: number,
  py: number,
  el: PathElement,
): boolean {
  if (el.segments.length < 2) return false;

  // Transform hit point into local element space
  let testX = px;
  let testY = py;

  if (el.rotation !== 0) {
    const bounds = getPathBounds(el);
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    const cos = Math.cos(-el.rotation);
    const sin = Math.sin(-el.rotation);
    const dx = px - cx;
    const dy = py - cy;
    testX = dx * cos - dy * sin + cx;
    testY = dx * sin + dy * cos + cy;
  }

  // Flatten Bezier curves to polyline
  const polyline = flattenPath(el);

  if (el.closed) {
    // Check if point is inside the filled polygon. Fill alone decides this —
    // a filled path with transparent stroke must still hit by interior
    // (consistent with rectangle/ellipse hit-testing).
    const hasFill = !(el.backgroundColor.type === 'solid' && el.backgroundColor.color === 'transparent');
    if (hasFill) {
      // Has fill — point-in-polygon check
      if (pointInPolygon(testX, testY, polyline)) return true;
    }
    // Also check distance to stroke
    return hitTestStroke(testX, testY, polyline, el.strokeWidth);
  }

  // Open path: only stroke hit-test
  return hitTestStroke(testX, testY, polyline, el.strokeWidth);
}

/**
 * Get axis-aligned bounding box of a path element.
 * Includes both anchor points and control points for accurate bounds.
 */
export function getPathBounds(el: PathElement): Bounds {
  if (el.segments.length === 0) {
    return { minX: el.x, minY: el.y, maxX: el.x, maxY: el.y };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const seg of el.segments) {
    const ax = el.x + seg.point[0];
    const ay = el.y + seg.point[1];
    if (ax < minX) minX = ax;
    if (ay < minY) minY = ay;
    if (ax > maxX) maxX = ax;
    if (ay > maxY) maxY = ay;

    // Include control points for accurate bounding box
    if (seg.handleIn) {
      const hix = ax + seg.handleIn[0];
      const hiy = ay + seg.handleIn[1];
      if (hix < minX) minX = hix;
      if (hiy < minY) minY = hiy;
      if (hix > maxX) maxX = hix;
      if (hiy > maxY) maxY = hiy;
    }
    if (seg.handleOut) {
      const hox = ax + seg.handleOut[0];
      const hoy = ay + seg.handleOut[1];
      if (hox < minX) minX = hox;
      if (hoy < minY) minY = hoy;
      if (hox > maxX) maxX = hox;
      if (hoy > maxY) maxY = hoy;
    }
  }

  if (minX === Infinity) {
    return { minX: el.x, minY: el.y, maxX: el.x, maxY: el.y };
  }

  const localWidth = maxX - minX;
  const localHeight = maxY - minY;
  return getRotatedBounds(minX, minY, localWidth, localHeight, el.rotation);
}

/**
 * Flatten a PathElement's Bezier curves into a polyline (array of points).
 * Used for hit-testing and boolean operations.
 */
export function flattenPath(el: PathElement): Point[] {
  const result: Point[] = [];
  if (el.segments.length === 0) return result;

  // Add first anchor
  const first = el.segments[0];
  result.push([el.x + first.point[0], el.y + first.point[1]]);

  // Flatten each segment between consecutive anchors
  for (let i = 0; i < el.segments.length - 1; i++) {
    flattenBezierSegment(el.segments[i], el.segments[i + 1], el, result);
  }

  // For closed paths, flatten the closing segment back to the first anchor
  if (el.closed && el.segments.length > 1) {
    flattenBezierSegment(el.segments[el.segments.length - 1], el.segments[0], el, result);
  }

  return result;
}

/**
 * Flatten a single Bezier segment between two PathSegments into polyline points.
 * Points are appended to the result array (excluding the start point which is already there).
 * Always appends the endpoint; for curves, also appends intermediate samples.
 */
function flattenBezierSegment(
  prev: PathSegment,
  curr: PathSegment,
  el: PathElement,
  result: Point[],
): void {
  const hasHandle = prev.handleOut || curr.handleIn;

  if (!hasHandle) {
    // Straight line — just add the endpoint
    result.push([el.x + curr.point[0], el.y + curr.point[1]]);
    return;
  }

  const px = prev.point[0];
  const py = prev.point[1];
  const cx = curr.point[0];
  const cy = curr.point[1];

  const cp1x = px + (prev.handleOut ? prev.handleOut[0] : 0);
  const cp1y = py + (prev.handleOut ? prev.handleOut[1] : 0);
  const cp2x = cx + (curr.handleIn ? curr.handleIn[0] : 0);
  const cp2y = cy + (curr.handleIn ? curr.handleIn[1] : 0);

  for (let t = 1; t <= FLATTEN_SAMPLES; t++) {
    const tt = t / FLATTEN_SAMPLES;
    const u = 1 - tt;
    const u2 = u * u;
    const u3 = u2 * u;
    const t2 = tt * tt;
    const t3 = t2 * tt;

    const x = u3 * px + 3 * u2 * tt * cp1x + 3 * u * t2 * cp2x + t3 * cx;
    const y = u3 * py + 3 * u2 * tt * cp1y + 3 * u * t2 * cp2y + t3 * cy;
    result.push([el.x + x, el.y + y]);
  }
}

/**
 * Check if a point is inside a polygon using ray-casting algorithm.
 */
function pointInPolygon(px: number, py: number, polygon: Point[]): boolean {
  if (polygon.length < 3) return false;

  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1];
    const xj = polygon[j][0], yj = polygon[j][1];

    const intersect = ((yi > py) !== (yj > py)) &&
      (px < (xj - xi) * (py - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }

  return inside;
}

/**
 * Hit-test point against a polyline (array of consecutive segments).
 */
function hitTestStroke(px: number, py: number, polyline: Point[], strokeWidth: number): boolean {
  if (polyline.length < 2) return false;

  const threshold = strokeWidth / 2 + 4;
  const thresholdSq = threshold * threshold;

  for (let i = 0; i < polyline.length - 1; i++) {
    const dSq = distSqToSegment([px, py], polyline[i], polyline[i + 1]);
    if (dSq <= thresholdSq) return true;
  }

  return false;
}
