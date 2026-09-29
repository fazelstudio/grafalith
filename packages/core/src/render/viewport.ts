import { Point } from '../scene/types';

/**
 * Viewport represents the current camera state in scene coordinates.
 */
export interface Viewport {
  scrollX: number;
  scrollY: number;
  zoom: number;
}

/**
 * Convert a point from scene coordinates to screen coordinates.
 * @param point - Point in scene space
 * @param viewport - Current viewport state
 * @returns Point in screen space
 */
export function sceneToScreen(point: Point, viewport: Viewport): Point {
  return [
    (point[0] + viewport.scrollX) * viewport.zoom,
    (point[1] + viewport.scrollY) * viewport.zoom,
  ];
}

/**
 * Convert a point from screen coordinates to scene coordinates.
 * @param point - Point in screen space
 * @param viewport - Current viewport state
 * @returns Point in scene space
 */
export function screenToScene(point: Point, viewport: Viewport): Point {
  return [
    point[0] / viewport.zoom - viewport.scrollX,
    point[1] / viewport.zoom - viewport.scrollY,
  ];
}

/**
 * Get the visible bounds in scene coordinates.
 * @param viewport - Current viewport state
 * @param canvasWidth - Canvas width in screen pixels
 * @param canvasHeight - Canvas height in screen pixels
 * @returns Bounds in scene coordinates [x, y, width, height]
 */
export function getViewportBounds(
  viewport: Viewport,
  canvasWidth: number,
  canvasHeight: number,
): { x: number; y: number; width: number; height: number } {
  const topLeft = screenToScene([0, 0], viewport);
  const bottomRight = screenToScene([canvasWidth, canvasHeight], viewport);
  return {
    x: topLeft[0],
    y: topLeft[1],
    width: bottomRight[0] - topLeft[0],
    height: bottomRight[1] - topLeft[1],
  };
}

/**
 * Clamp zoom value to prevent extreme zoom levels.
 * @param zoom - Target zoom value
 * @returns Clamped zoom value
 */
export function clampZoom(zoom: number): number {
  const MIN_ZOOM = 0.1;
  const MAX_ZOOM = 10;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}
