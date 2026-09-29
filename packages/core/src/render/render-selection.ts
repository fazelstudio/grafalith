import { Scene } from '../scene';
import { Viewport, sceneToScreen } from './viewport';
import type { Bounds } from '../shapes/geometry';
import { getElementBounds } from '../shapes';
import type { SelectionState } from '../interaction/selection';
import type { Point } from '../scene/types';
import type { FazelidrawTheme } from '../theme/types';
import type { CropHandle } from '../interaction/crop-handler';

/** Handle type identifier for resize handles. */
export type HandleType =
  | 'top-left' | 'top-center' | 'top-right'
  | 'middle-left' | 'middle-right'
  | 'bottom-left' | 'bottom-center' | 'bottom-right';

/** Resize handle position in scene coordinates. */
export interface ResizeHandle {
  type: HandleType;
  x: number;
  y: number;
}

/**
 * Render the complete selection overlay on the interactive canvas.
 * @param ctx - Interactive canvas 2D context
 * @param state - Current selection state
 * @param scene - Scene to look up elements
 * @param viewport - Current viewport
 * @param theme - Resolved theme (from resolveTheme, called once at init)
 * @param rotation - Optional rotation in radians for single-element selection
 */
export function renderSelectionOverlay(
  ctx: CanvasRenderingContext2D,
  state: SelectionState,
  scene: Scene,
  viewport: Viewport,
  theme: FazelidrawTheme,
  rotation: number = 0,
): void {
  const selectedIds = Array.from(state.selectedElementIds);

  if (selectedIds.length > 0) {
    const bounds = computeSelectionBounds(selectedIds, scene);
    if (bounds) {
      renderSelectionBox(ctx, bounds, viewport, theme, rotation);
      renderHandles(ctx, bounds, viewport, theme, rotation);
      renderRotateHandle(ctx, bounds, viewport, theme, rotation);
    }
  }

  if (state.rubberBand) {
    renderRubberBand(ctx, state.rubberBand, viewport, theme);
  }
}

/**
 * Compute the combined bounding box of selected elements.
 */
export function computeSelectionBounds(
  selectedIds: string[],
  scene: Scene,
): Bounds | null {
  if (selectedIds.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const id of selectedIds) {
    const el = scene.getElement(id);
    if (!el) continue;
    const b = getElementBounds(el);
    if (b.minX < minX) minX = b.minX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.maxY > maxY) maxY = b.maxY;
  }

  if (minX === Infinity) return null;
  return { minX, minY, maxX, maxY };
}

/**
 * Render the selection box outline around the bounding box.
 * @param rotation - Optional rotation in radians around the bounding box center
 */
export function renderSelectionBox(
  ctx: CanvasRenderingContext2D,
  bounds: Bounds,
  viewport: Viewport,
  theme: FazelidrawTheme,
  rotation: number = 0,
): void {
  const tl = sceneToScreen([bounds.minX, bounds.minY], viewport);
  const br = sceneToScreen([bounds.maxX, bounds.maxY], viewport);
  const w = br[0] - tl[0];
  const h = br[1] - tl[1];

  ctx.strokeStyle = theme.colors.selectionOutline;
  ctx.lineWidth = theme.sizes.selectionOutlineWidth;
  ctx.setLineDash([]);

  if (rotation !== 0) {
    const cx = (tl[0] + br[0]) / 2;
    const cy = (tl[1] + br[1]) / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rotation);
    ctx.translate(-cx, -cy);
    ctx.strokeRect(tl[0], tl[1], w, h);
    ctx.restore();
  } else {
    ctx.strokeRect(tl[0], tl[1], w, h);
  }
}

/**
 * Render 8 resize handles at corners and edge midpoints.
 * @param rotation - Optional rotation in radians around the bounding box center
 */
export function renderHandles(
  ctx: CanvasRenderingContext2D,
  bounds: Bounds,
  viewport: Viewport,
  theme: FazelidrawTheme,
  rotation: number = 0,
): void {
  const handles = getResizeHandles(bounds);
  const half = theme.sizes.handleSize / 2;

  ctx.fillStyle = theme.colors.handleFill;
  ctx.strokeStyle = theme.colors.handleStroke;
  ctx.lineWidth = theme.sizes.handleLineWidth;

  if (rotation !== 0) {
    const tl = sceneToScreen([bounds.minX, bounds.minY], viewport);
    const br = sceneToScreen([bounds.maxX, bounds.maxY], viewport);
    const cx = (tl[0] + br[0]) / 2;
    const cy = (tl[1] + br[1]) / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rotation);
    ctx.translate(-cx, -cy);
    for (const handle of handles) {
      const screen = sceneToScreen([handle.x, handle.y], viewport);
      ctx.fillRect(screen[0] - half, screen[1] - half, theme.sizes.handleSize, theme.sizes.handleSize);
      ctx.strokeRect(screen[0] - half, screen[1] - half, theme.sizes.handleSize, theme.sizes.handleSize);
    }
    ctx.restore();
  } else {
    for (const handle of handles) {
      const screen = sceneToScreen([handle.x, handle.y], viewport);
      ctx.fillRect(screen[0] - half, screen[1] - half, theme.sizes.handleSize, theme.sizes.handleSize);
      ctx.strokeRect(screen[0] - half, screen[1] - half, theme.sizes.handleSize, theme.sizes.handleSize);
    }
  }
}

/**
 * Render the rotate handle above the top-center of the bounding box.
 * @param rotation - Optional rotation in radians around the bounding box center
 */
export function renderRotateHandle(
  ctx: CanvasRenderingContext2D,
  bounds: Bounds,
  viewport: Viewport,
  theme: FazelidrawTheme,
  rotation: number = 0,
): void {
  const center = getCenter(bounds);
  const topCenter: Point = [center[0], bounds.minY];
  const rotatePos: Point = [
    topCenter[0],
    topCenter[1] - theme.sizes.rotateHandleOffset / viewport.zoom,
  ];

  if (rotation !== 0) {
    // Rotate the topCenter and rotatePos around the bounding box center
    const cx = center[0];
    const cy = center[1];
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);

    const rotateTopCenterX = (topCenter[0] - cx) * cos - (topCenter[1] - cy) * sin + cx;
    const rotateTopCenterY = (topCenter[0] - cx) * sin + (topCenter[1] - cy) * cos + cy;

    const rotateRotatePosX = (rotatePos[0] - cx) * cos - (rotatePos[1] - cy) * sin + cx;
    const rotateRotatePosY = (rotatePos[0] - cx) * sin + (rotatePos[1] - cy) * cos + cy;

    const topScreen = sceneToScreen([rotateTopCenterX, rotateTopCenterY], viewport);
    const screen = sceneToScreen([rotateRotatePosX, rotateRotatePosY], viewport);
    const radius = theme.sizes.rotateHandleRadius;

    ctx.beginPath();
    ctx.arc(screen[0], screen[1], radius, 0, Math.PI * 2);
    ctx.fillStyle = theme.colors.handleFill;
    ctx.fill();
    ctx.strokeStyle = theme.colors.handleStroke;
    ctx.lineWidth = theme.sizes.selectionOutlineWidth;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(topScreen[0], topScreen[1]);
    ctx.lineTo(screen[0], screen[1]);
    ctx.strokeStyle = theme.colors.selectionOutline;
    ctx.lineWidth = theme.sizes.rotateHandleLineWidth;
    ctx.setLineDash([]);
    ctx.stroke();
  } else {
    const screen = sceneToScreen(rotatePos, viewport);
    const radius = theme.sizes.rotateHandleRadius;

    ctx.beginPath();
    ctx.arc(screen[0], screen[1], radius, 0, Math.PI * 2);
    ctx.fillStyle = theme.colors.handleFill;
    ctx.fill();
    ctx.strokeStyle = theme.colors.handleStroke;
    ctx.lineWidth = theme.sizes.selectionOutlineWidth;
    ctx.stroke();

    const topScreen = sceneToScreen(topCenter, viewport);
    ctx.beginPath();
    ctx.moveTo(topScreen[0], topScreen[1]);
    ctx.lineTo(screen[0], screen[1]);
    ctx.strokeStyle = theme.colors.selectionOutline;
    ctx.lineWidth = theme.sizes.rotateHandleLineWidth;
    ctx.setLineDash([]);
    ctx.stroke();
  }
}

/**
 * Render the rubber-band selection rectangle.
 */
export function renderRubberBand(
  ctx: CanvasRenderingContext2D,
  rubberBand: { startX: number; startY: number; endX: number; endY: number },
  viewport: Viewport,
  theme: FazelidrawTheme,
): void {
  const tl = sceneToScreen(
    [Math.min(rubberBand.startX, rubberBand.endX), Math.min(rubberBand.startY, rubberBand.endY)],
    viewport,
  );
  const br = sceneToScreen(
    [Math.max(rubberBand.startX, rubberBand.endX), Math.max(rubberBand.startY, rubberBand.endY)],
    viewport,
  );
  const w = br[0] - tl[0];
  const h = br[1] - tl[1];

  ctx.fillStyle = theme.colors.rubberBandFill;
  ctx.fillRect(tl[0], tl[1], w, h);
  ctx.strokeStyle = theme.colors.rubberBandStroke;
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.strokeRect(tl[0], tl[1], w, h);
}

/**
 * Get the 8 resize handle positions in scene coordinates.
 */
export function getResizeHandles(bounds: Bounds): ResizeHandle[] {
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;

  return [
    { type: 'top-left', x: bounds.minX, y: bounds.minY },
    { type: 'top-center', x: cx, y: bounds.minY },
    { type: 'top-right', x: bounds.maxX, y: bounds.minY },
    { type: 'middle-left', x: bounds.minX, y: cy },
    { type: 'middle-right', x: bounds.maxX, y: cy },
    { type: 'bottom-left', x: bounds.minX, y: bounds.maxY },
    { type: 'bottom-center', x: cx, y: bounds.maxY },
    { type: 'bottom-right', x: bounds.maxX, y: bounds.maxY },
  ];
}

/**
 * Get the rotate handle position in scene coordinates.
 */
export function getRotateHandlePosition(bounds: Bounds, zoom: number, theme: FazelidrawTheme): Point {
  const cx = (bounds.minX + bounds.maxX) / 2;
  return [cx, bounds.minY - theme.sizes.rotateHandleOffset / zoom];
}

/**
 * Hit-test a scene point against resize handles.
 * @param rotation - Optional rotation in radians around the bounding box center
 * @returns The handle type if hit, or null.
 */
export function hitTestResizeHandle(
  px: number,
  py: number,
  bounds: Bounds,
  zoom: number,
  theme: FazelidrawTheme,
  rotation: number = 0,
): HandleType | null {
  const handles = getResizeHandles(bounds);
  const hitRadius = theme.sizes.handleSize / zoom + 2;

  if (rotation !== 0) {
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);

    for (const handle of handles) {
      // Rotate handle position around center
      const rx = (handle.x - cx) * cos - (handle.y - cy) * sin + cx;
      const ry = (handle.x - cx) * sin + (handle.y - cy) * cos + cy;
      const dx = px - rx;
      const dy = py - ry;
      if (Math.abs(dx) <= hitRadius && Math.abs(dy) <= hitRadius) {
        return handle.type;
      }
    }
  } else {
    for (const handle of handles) {
      const dx = px - handle.x;
      const dy = py - handle.y;
      if (Math.abs(dx) <= hitRadius && Math.abs(dy) <= hitRadius) {
        return handle.type;
      }
    }
  }
  return null;
}

/**
 * Hit-test a scene point against the rotate handle.
 * @param rotation - Optional rotation in radians around the bounding box center
 */
export function hitTestRotateHandle(
  px: number,
  py: number,
  bounds: Bounds,
  zoom: number,
  theme: FazelidrawTheme,
  rotation: number = 0,
): boolean {
  const pos = getRotateHandlePosition(bounds, zoom, theme);
  const hitRadius = theme.sizes.rotateHandleRadius / zoom + 2;

  if (rotation !== 0) {
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    // Rotate the position around center
    const rx = (pos[0] - cx) * cos - (pos[1] - cy) * sin + cx;
    const ry = (pos[0] - cx) * sin + (pos[1] - cy) * cos + cy;
    const dx = px - rx;
    const dy = py - ry;
    return dx * dx + dy * dy <= hitRadius * hitRadius;
  } else {
    const dx = px - pos[0];
    const dy = py - pos[1];
    return dx * dx + dy * dy <= hitRadius * hitRadius;
  }
}

/**
 * Hit-test a scene point against the selection bounding box outline.
 * @param rotation - Optional rotation in radians around the bounding box center
 */
export function hitTestBoundingBox(
  px: number,
  py: number,
  bounds: Bounds,
  theme: FazelidrawTheme,
  rotation: number = 0,
): boolean {
  const threshold = theme.sizes.boundingBoxHitThreshold;

  if (rotation !== 0) {
    // Transform point into un-rotated local space
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    const cos = Math.cos(-rotation);
    const sin = Math.sin(-rotation);
    const dx = px - cx;
    const dy = py - cy;
    const lx = dx * cos - dy * sin + cx;
    const ly = dx * sin + dy * cos + cy;

    const inX = lx >= bounds.minX - threshold && lx <= bounds.maxX + threshold;
    const inY = ly >= bounds.minY - threshold && ly <= bounds.maxY + threshold;
    if (!inX || !inY) return false;

    const onEdge =
      Math.abs(lx - bounds.minX) < threshold ||
      Math.abs(lx - bounds.maxX) < threshold ||
      Math.abs(ly - bounds.minY) < threshold ||
      Math.abs(ly - bounds.maxY) < threshold;
    return onEdge;
  } else {
    const inX = px >= bounds.minX - threshold && px <= bounds.maxX + threshold;
    const inY = py >= bounds.minY - threshold && py <= bounds.maxY + threshold;
    if (!inX || !inY) return false;

    const onEdge =
      Math.abs(px - bounds.minX) < threshold ||
      Math.abs(px - bounds.maxX) < threshold ||
      Math.abs(py - bounds.minY) < threshold ||
      Math.abs(py - bounds.maxY) < threshold;
    return onEdge;
  }
}

/** Get the center point of a bounding box. */
function getCenter(bounds: Bounds): Point {
  return [(bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2];
}

/**
 * Render the crop overlay for an ImageElement in crop mode.
 * Shows crop handles and a dimmed area outside the crop region.
 */
export function renderCropOverlay(
  ctx: CanvasRenderingContext2D,
  cropBounds: { x: number; y: number; width: number; height: number },
  elementBounds: Bounds,
  viewport: Viewport,
  theme: FazelidrawTheme,
): void {
  const elTL = sceneToScreen([elementBounds.minX, elementBounds.minY], viewport);
  const elBR = sceneToScreen([elementBounds.maxX, elementBounds.maxY], viewport);
  const elW = elBR[0] - elTL[0];

  const cropTL = sceneToScreen([cropBounds.x, cropBounds.y], viewport);
  const cropBR = sceneToScreen([cropBounds.x + cropBounds.width, cropBounds.y + cropBounds.height], viewport);
  const cropW = cropBR[0] - cropTL[0];
  const cropH = cropBR[1] - cropTL[1];

  // Dim area outside crop region
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  // Top
  ctx.fillRect(elTL[0], elTL[1], elW, cropTL[1] - elTL[1]);
  // Bottom
  ctx.fillRect(elTL[0], cropBR[1], elW, elBR[1] - cropBR[1]);
  // Left
  ctx.fillRect(elTL[0], cropTL[1], cropTL[0] - elTL[0], cropH);
  // Right
  ctx.fillRect(cropBR[0], cropTL[1], elBR[0] - cropBR[0], cropH);

  // Crop region outline
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2 / viewport.zoom;
  ctx.setLineDash([]);
  ctx.strokeRect(cropTL[0], cropTL[1], cropW, cropH);

  // Render crop handles
  const handles = getCropHandlePositions(cropBounds);
  const handleSize = theme.sizes.handleSize;

  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 1 / viewport.zoom;

  for (const handle of handles) {
    const screen = sceneToScreen([handle.x, handle.y], viewport);
    const half = handleSize / 2;
    ctx.fillRect(screen[0] - half, screen[1] - half, handleSize, handleSize);
    ctx.strokeRect(screen[0] - half, screen[1] - half, handleSize, handleSize);
  }
}

/** Get crop handle positions in scene coordinates. */
function getCropHandlePositions(
  cropBounds: { x: number; y: number; width: number; height: number },
): Array<{ type: CropHandle; x: number; y: number }> {
  const { x, y, width, height } = cropBounds;
  return [
    { type: 'crop-top-left', x, y },
    { type: 'crop-top-center', x: x + width / 2, y },
    { type: 'crop-top-right', x: x + width, y },
    { type: 'crop-middle-left', x, y: y + height / 2 },
    { type: 'crop-middle-right', x: x + width, y: y + height / 2 },
    { type: 'crop-bottom-left', x, y: y + height },
    { type: 'crop-bottom-center', x: x + width / 2, y: y + height },
    { type: 'crop-bottom-right', x: x + width, y: y + height },
  ];
}
