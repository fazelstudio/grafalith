import { RectangleElement } from '../scene/types';
import { Viewport } from '../render/viewport';
import { Bounds, getRotatedBounds } from './geometry';
import { resolveFillStyle } from '../render/fill-style';

/**
 * Render a rectangle element to a canvas context.
 * Supports optional roundness (rounded corners).
 */
export function renderRectangle(
  ctx: CanvasRenderingContext2D,
  el: RectangleElement,
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

  // Set stroke dash pattern
  if (el.strokeStyle === 'dashed') {
    ctx.setLineDash([el.strokeWidth * 3, el.strokeWidth * 2]);
  } else if (el.strokeStyle === 'dotted') {
    ctx.setLineDash([el.strokeWidth, el.strokeWidth]);
  } else {
    ctx.setLineDash([]);
  }

  // Draw fill if backgroundColor is not transparent
  const bg = el.backgroundColor;
  const bounds: Bounds = { minX: el.x, minY: el.y, maxX: el.x + el.width, maxY: el.y + el.height };
  const fillValue = resolveFillStyle(ctx, bg, bounds);
  
  // Only draw fill if not transparent
  if (bg.type === 'solid' && bg.color === 'transparent') {
    // Skip fill
  } else {
    ctx.fillStyle = fillValue;
    if (el.roundness !== null && el.roundness > 0) {
      drawRoundedRect(ctx, el.x, el.y, el.width, el.height, el.roundness);
      ctx.fill();
    } else {
      ctx.fillRect(el.x, el.y, el.width, el.height);
    }
  }

  // Draw stroke
  if (el.strokeColor !== 'transparent') {
    if (el.roundness !== null && el.roundness > 0) {
      drawRoundedRect(ctx, el.x, el.y, el.width, el.height, el.roundness);
      ctx.stroke();
    } else {
      ctx.strokeRect(el.x, el.y, el.width, el.height);
    }
  }

  ctx.restore();
}

/**
 * Hit-test a point against a rectangle element.
 * Accounts for rotation.
 */
export function hitTestRectangle(
  px: number,
  py: number,
  el: RectangleElement,
): boolean {
  if (el.rotation === 0) {
    return (
      px >= el.x &&
      px <= el.x + el.width &&
      py >= el.y &&
      py <= el.y + el.height
    );
  }

  // Transform point into local (unrotated) space
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  const cos = Math.cos(-el.rotation);
  const sin = Math.sin(-el.rotation);
  const dx = px - cx;
  const dy = py - cy;
  const localX = dx * cos - dy * sin + cx;
  const localY = dx * sin + dy * cos + cy;

  return (
    localX >= el.x &&
    localX <= el.x + el.width &&
    localY >= el.y &&
    localY <= el.y + el.height
  );
}

/**
 * Get axis-aligned bounding box of a rectangle element.
 * Correctly handles rotation.
 */
export function getRectangleBounds(el: RectangleElement): Bounds {
  return getRotatedBounds(el.x, el.y, el.width, el.height, el.rotation);
}

/** Draw a rounded rectangle path. */
function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.arcTo(x + w, y, x + w, y + radius, radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius);
  ctx.lineTo(x + radius, y + h);
  ctx.arcTo(x, y + h, x, y + h - radius, radius);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.closePath();
}
