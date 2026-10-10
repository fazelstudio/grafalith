/**
 * Pure hover-cursor math for selection handles.
 *
 * Handle order follows the engine overlay (corners, then edges, in the same
 * order the host paints them); rotation is intentionally uncompensated, so
 * mapping is exact for unrotated boxes. Text keeps its content-driven
 * height, so only its corners take a resize cursor.
 */

import type { RenderModelDto, ViewportDto } from '../hooks/useEngine';
import { sceneToScreen, type XY } from './coords';

/** Cursor per handle index (TopLeft, TopCenter, TopRight, MiddleLeft, …). */
const HANDLE_CURSORS = [
  'var(--cursor-nwse-resize)',
  'var(--cursor-ns-resize)',
  'var(--cursor-nesw-resize)',
  'var(--cursor-ew-resize)',
  'var(--cursor-ew-resize)',
  'var(--cursor-nesw-resize)',
  'var(--cursor-ns-resize)',
  'var(--cursor-nwse-resize)',
] as const;

/** Screen-space hit radius around a handle. */
export const HANDLE_HIT_PX = 8;

/** Refresh-style cursor for the rotate handle and rotate drags. */
export const ROTATE_CURSOR = 'var(--cursor-rotate)';

/** Cursor per resize-handle name (engine kebab-case, e.g. `"top-left"`). */
export function cursorForResizeHandle(handle: string): string | null {
  switch (handle) {
    case 'top-left':
    case 'bottom-right':
      return HANDLE_CURSORS[0];
    case 'top':
    case 'bottom':
      return HANDLE_CURSORS[1];
    case 'top-right':
    case 'bottom-left':
      return HANDLE_CURSORS[2];
    case 'left':
    case 'right':
      return HANDLE_CURSORS[3];
    default:
      return null;
  }
}

/**
 * Resize cursor when hovering a selection handle, else null. Pass
 * `textSingle` for a lone text selection so edge handles (which resize
 * nothing on text) keep the default cursor instead of promising a drag.
 */
export function selectionHandleCursor(
  model: RenderModelDto,
  viewport: ViewportDto,
  pointPx: XY,
  textSingle: boolean,
): string | null {
  const overlay = model.selection;
  if (!overlay) return null;
  const count = Math.min(overlay.handles.length, HANDLE_CURSORS.length);
  for (let i = 0; i < count; i += 1) {
    if (textSingle && i !== 0 && i !== 2 && i !== 5 && i !== 7) continue;
    const [sx, sy] = sceneToScreen([overlay.handles[i][0], overlay.handles[i][1]], viewport);
    if (Math.abs(pointPx[0] - sx) <= HANDLE_HIT_PX && Math.abs(pointPx[1] - sy) <= HANDLE_HIT_PX) {
      return HANDLE_CURSORS[i];
    }
  }
  const [rx, ry] = sceneToScreen([overlay.rotateHandle[0], overlay.rotateHandle[1]], viewport);
  if (Math.abs(pointPx[0] - rx) <= HANDLE_HIT_PX && Math.abs(pointPx[1] - ry) <= HANDLE_HIT_PX) {
    return ROTATE_CURSOR;
  }
  return null;
}
