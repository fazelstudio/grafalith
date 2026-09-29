import type { FillStyle } from '../scene/types';

/**
 * Canvas mode configuration.
 * - `infinite`: unlimited canvas, no visible boundaries (default).
 * - `bounded`: fixed width × height canvas with visual boundary.
 */
export type CanvasMode =
  | { type: 'infinite' }
  | { type: 'bounded'; width: number; height: number; background?: FillStyle };

/** Default canvas mode is infinite. */
export const DEFAULT_CANVAS_MODE: CanvasMode = { type: 'infinite' };

/**
 * Get the bounds of a bounded canvas, or null for infinite mode.
 * Bounds are always at origin (0,0) with the specified width/height.
 */
export function getCanvasBounds(mode: CanvasMode): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (mode.type === 'infinite') return null;
  return { minX: 0, minY: 0, maxX: mode.width, maxY: mode.height };
}
