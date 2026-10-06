import type { ViewportState } from '../../render/coords';

/** Minimum and maximum zoom the engine accepts on viewport writes. */
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 10;

/** Scene-space content bounds used for fit calculations. */
export interface ContentBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Clamp a zoom factor to the range the engine accepts. */
export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/**
 * Viewport that fits `bounds` into a view of `viewWidth` by `viewHeight`
 * CSS px with `padding` px around the content. Returns null when there is
 * nothing to fit or the view has no size, so callers keep the viewport.
 */
export function fitViewport(
  bounds: ContentBounds | null,
  viewWidth: number,
  viewHeight: number,
  padding = 48,
): ViewportState | null {
  if (!bounds) return null;
  if (!(viewWidth > 0 && viewHeight > 0)) return null;
  const contentWidth = bounds.maxX - bounds.minX;
  const contentHeight = bounds.maxY - bounds.minY;
  if (!(contentWidth > 0 && contentHeight > 0)) return null;
  const roomWidth = viewWidth - padding * 2;
  const roomHeight = viewHeight - padding * 2;
  if (!(roomWidth > 0 && roomHeight > 0)) return null;
  const zoom = clampZoom(Math.min(roomWidth / contentWidth, roomHeight / contentHeight));
  const leftoverX = viewWidth - contentWidth * zoom;
  const leftoverY = viewHeight - contentHeight * zoom;
  return {
    scrollX: leftoverX / 2 / zoom - bounds.minX,
    scrollY: leftoverY / 2 / zoom - bounds.minY,
    zoom,
  };
}

/**
 * Cursor-anchored zoom step around (`anchorX`, `anchorY`) screen px. The
 * anchor stays fixed, matching the engine zoom behavior for wheel input.
 */
export function zoomViewport(
  viewport: ViewportState,
  factor: number,
  anchorX: number,
  anchorY: number,
): ViewportState {
  if (!(factor > 0 && Number.isFinite(factor))) return viewport;
  const zoom = clampZoom(viewport.zoom * factor);
  const anchorSceneX = anchorX / viewport.zoom - viewport.scrollX;
  const anchorSceneY = anchorY / viewport.zoom - viewport.scrollY;
  return {
    scrollX: anchorX / zoom - anchorSceneX,
    scrollY: anchorY / zoom - anchorSceneY,
    zoom,
  };
}
