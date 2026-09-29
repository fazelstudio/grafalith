import type { CanvasMode } from './canvas-mode';
import type { Viewport } from './viewport';
import type { FazelidrawTheme } from '../theme/types';

/**
 * Render the canvas boundary for bounded mode.
 * Draws a visual distinction between the valid canvas area and the area outside.
 * This renders BEHIND all elements (lowest layer).
 *
 * @param ctx - Canvas 2D rendering context
 * @param canvasMode - Current canvas mode configuration
 * @param viewport - Current viewport state
 * @param theme - Resolved theme for colors
 * @param canvasWidth - Canvas width in CSS pixels
 * @param canvasHeight - Canvas height in CSS pixels
 */
export function renderCanvasBoundary(
  ctx: CanvasRenderingContext2D,
  canvasMode: CanvasMode,
  viewport: Viewport,
  theme: FazelidrawTheme,
  canvasWidth: number,
  canvasHeight: number,
): void {
  if (canvasMode.type === 'infinite') return;

  const { width, height } = canvasMode;

  // NOTE: caller invokes this inside a scene-transformed context
  // (translate(scroll*zoom) + scale(zoom) on top of a dpr transform).
  // Screen-space strips must therefore be drawn with an identity/dpr
  // transform, then the context restored — otherwise strips are off by
  // 1/zoom and offset by scroll. The bounded border is drawn in screen
  // space too (constant 1px), matching the strip coordinate space.
  ctx.save();
  const dpr = typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Use the canvas background for the bounded area, overlay for outside
  const overlayColor = theme.colors.canvasOutOfBoundsOverlay ?? 'rgba(0, 0, 0, 0.08)';

  // Compute the bounded area in screen coordinates
  const topLeft = [0 * viewport.zoom + viewport.scrollX * viewport.zoom, 0 * viewport.zoom + viewport.scrollY * viewport.zoom];
  const bottomRight = [width * viewport.zoom + viewport.scrollX * viewport.zoom, height * viewport.zoom + viewport.scrollY * viewport.zoom];

  // Fill everything outside the bounded area with the overlay
  ctx.fillStyle = overlayColor;

  // Top strip (above bounded area)
  if (topLeft[1] > 0) {
    ctx.fillRect(0, 0, canvasWidth, topLeft[1]);
  }

  // Bottom strip (below bounded area)
  if (bottomRight[1] < canvasHeight) {
    ctx.fillRect(0, bottomRight[1], canvasWidth, canvasHeight - bottomRight[1]);
  }

  // Left strip (left of bounded area, between top and bottom)
  if (topLeft[0] > 0) {
    ctx.fillRect(0, topLeft[1], topLeft[0], bottomRight[1] - topLeft[1]);
  }

  // Right strip (right of bounded area, between top and bottom)
  if (bottomRight[0] < canvasWidth) {
    ctx.fillRect(bottomRight[0], topLeft[1], canvasWidth - bottomRight[0], bottomRight[1] - topLeft[1]);
  }

  // Draw a subtle border around the bounded area (screen space, constant 1px)
  ctx.strokeStyle = theme.colors.canvasBoundsBorder ?? 'rgba(0, 0, 0, 0.2)';
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.strokeRect(topLeft[0], topLeft[1], bottomRight[0] - topLeft[0], bottomRight[1] - topLeft[1]);

  ctx.restore();
}
