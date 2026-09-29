import { Point } from '../scene/types';

/** Axis-aligned bounding box in scene coordinates. */
export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Compute the axis-aligned bounding box of a rotated rectangle.
 * @param x - Top-left X of unrotated rect
 * @param y - Top-left Y of unrotated rect
 * @param width - Width of unrotated rect
 * @param height - Height of unrotated rect
 * @param rotation - Rotation in radians around center
 */
export function getRotatedBounds(
  x: number,
  y: number,
  width: number,
  height: number,
  rotation: number,
): Bounds {
  if (rotation === 0) {
    return { minX: x, minY: y, maxX: x + width, maxY: y + height };
  }

  const cx = x + width / 2;
  const cy = y + height / 2;
  const hw = width / 2;
  const hh = height / 2;

  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);

  // Four corners of the unrotated rectangle
  const corners: Point[] = [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ];

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const [px, py] of corners) {
    const rx = px * cos - py * sin + cx;
    const ry = px * sin + py * cos + cy;
    if (rx < minX) minX = rx;
    if (ry < minY) minY = ry;
    if (rx > maxX) maxX = rx;
    if (ry > maxY) maxY = ry;
  }

  return { minX, minY, maxX, maxY };
}

/**
 * Squared distance from point P to line segment AB.
 * @param p - Test point
 * @param a - Segment start
 * @param b - Segment end
 */
export function distSqToSegment(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    // Degenerate segment (a === b)
    const ex = p[0] - a[0];
    const ey = p[1] - a[1];
    return ex * ex + ey * ey;
  }

  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const projX = a[0] + t * dx;
  const projY = a[1] + t * dy;
  const ex = p[0] - projX;
  const ey = p[1] - projY;
  return ex * ex + ey * ey;
}

/**
 * Distance from point P to line segment AB.
 */
export function distToSegment(p: Point, a: Point, b: Point): number {
  return Math.sqrt(distSqToSegment(p, a, b));
}

/**
 * Check if a point is inside an axis-aligned bounding box.
 */
export function pointInBounds(px: number, py: number, b: Bounds): boolean {
  return px >= b.minX && px <= b.maxX && py >= b.minY && py <= b.maxY;
}
