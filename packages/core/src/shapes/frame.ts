import { FrameElement } from '../scene/types';
import { Viewport } from '../render/viewport';
import { Bounds } from './geometry';

/**
 * Render a frame element.
 * Draws a rounded rectangle border with a label.
 * When clipContent is true, children are clipped to the frame bounds (handled by render-loop).
 */
export function renderFrame(
  ctx: CanvasRenderingContext2D,
  el: FrameElement,
  _viewport: Viewport,
): void {
  const { x, y, width, height, strokeColor, strokeWidth, opacity } = el;

  ctx.save();
  ctx.globalAlpha = opacity / 100;

  // Draw frame background (light fill)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.fillRect(x, y, width, height);

  // Draw frame border
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = strokeWidth;
  ctx.setLineDash([]);
  ctx.strokeRect(x, y, width, height);

  // Draw frame label
  if (el.name) {
    ctx.fillStyle = strokeColor;
    ctx.font = '12px sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText(el.name, x + 4, y + 4);
  }

  ctx.restore();
}

/**
 * Hit-test a point against a frame element (simple bounds check).
 */
export function hitTestFrame(px: number, py: number, el: FrameElement): boolean {
  return px >= el.x && px <= el.x + el.width && py >= el.y && py <= el.y + el.height;
}

/**
 * Get the bounds of a frame element.
 */
export function getFrameBounds(el: FrameElement): Bounds {
  return {
    minX: el.x,
    minY: el.y,
    maxX: el.x + el.width,
    maxY: el.y + el.height,
  };
}
