import { EllipseElement } from '../scene/types';
import { Viewport } from '../render/viewport';
import { Bounds, getRotatedBounds } from './geometry';
import { resolveFillStyle } from '../render/fill-style';

/**
 * Render an ellipse element to a canvas context.
 */
export function renderEllipse(
  ctx: CanvasRenderingContext2D,
  el: EllipseElement,
  _viewport: Viewport,
): void {
  ctx.save();

  // Apply rotation around center
  if (el.rotation !== 0) {
    const cx = el.x + el.width / 2;
    const cy = el.y + el.height / 2;
    ctx.translate(cx, cy);
    ctx.rotate(el.rotation);
    ctx.translate(-cx, -cy);
  }

  ctx.globalAlpha = el.opacity / 100;
  ctx.strokeStyle = el.strokeColor;
  ctx.lineWidth = el.strokeWidth;

  if (el.strokeStyle === 'dashed') {
    ctx.setLineDash([el.strokeWidth * 3, el.strokeWidth * 2]);
  } else if (el.strokeStyle === 'dotted') {
    ctx.setLineDash([el.strokeWidth, el.strokeWidth]);
  } else {
    ctx.setLineDash([]);
  }

  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  const rx = el.width / 2;
  const ry = el.height / 2;

  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);

  // Draw fill
  const bg = el.backgroundColor;
  const bounds: Bounds = { minX: el.x, minY: el.y, maxX: el.x + el.width, maxY: el.y + el.height };
  const fillValue = resolveFillStyle(ctx, bg, bounds);
  
  // Only draw fill if not transparent
  if (bg.type === 'solid' && bg.color === 'transparent') {
    // Skip fill
  } else {
    ctx.fillStyle = fillValue;
    ctx.fill();
  }

  // Draw stroke
  if (el.strokeColor !== 'transparent') {
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * Mathematically accurate hit-test for ellipse.
 * Uses the standard ellipse equation: ((x-cx)/rx)^2 + ((y-cy)/ry)^2 <= 1
 * This correctly handles points at the corners of the bounding box
 * that would be false positives with a simple bounds check.
 */
export function hitTestEllipse(
  px: number,
  py: number,
  el: EllipseElement,
): boolean {
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;

  let testX = px;
  let testY = py;

  // Account for rotation: rotate point into local ellipse space
  if (el.rotation !== 0) {
    const cos = Math.cos(-el.rotation);
    const sin = Math.sin(-el.rotation);
    const dx = px - cx;
    const dy = py - cy;
    testX = dx * cos - dy * sin + cx;
    testY = dx * sin + dy * cos + cy;
  }

  const rx = el.width / 2;
  const ry = el.height / 2;

  if (rx === 0 || ry === 0) return false;

  const nx = (testX - cx) / rx;
  const ny = (testY - cy) / ry;
  return nx * nx + ny * ny <= 1;
}

/**
 * Get axis-aligned bounding box of an ellipse element.
 * Correctly handles rotation.
 */
export function getEllipseBounds(el: EllipseElement): Bounds {
  return getRotatedBounds(el.x, el.y, el.width, el.height, el.rotation);
}
