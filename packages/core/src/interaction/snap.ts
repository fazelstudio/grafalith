import type { Bounds } from '../shapes/geometry';
import type { Element } from '../scene';
import { getElementBounds } from '../shapes';

/** Configuration for snapping behavior. */
export interface SnapConfig {
  /** Size of the grid cells for snap-to-grid. */
  gridSize: number;
  /** Whether snap-to-grid is enabled. */
  snapToGrid: boolean;
  /** Whether to show the grid visual on canvas. */
  showGrid: boolean;
  /** Whether snap-to-object is enabled. */
  snapToObjects: boolean;
  /**
   * Threshold in screen pixels for snap-to-object detection.
   * Divided by viewport zoom at call time so feel is zoom-independent
   * (Phase 13-C: "threshold px pada zoom level saat ini").
   */
  snapThreshold: number;
}

/** Default snap configuration. */
export const defaultSnapConfig: SnapConfig = {
  gridSize: 20,
  snapToGrid: false,
  showGrid: false,
  snapToObjects: true,
  snapThreshold: 5,
};

/** A snap guideline for rendering on the interactive canvas. */
export interface SnapGuide {
  type: 'vertical' | 'horizontal';
  /** Position of the guide line (x for vertical, y for horizontal) in scene coords. */
  position: number;
  /** Start of the guide line segment. */
  startX: number;
  startY: number;
  /** End of the guide line segment. */
  endX: number;
  endY: number;
}

/** Result of a snap operation. */
export interface SnapResult {
  /** Snapped x position. */
  x: number;
  /** Snapped y position. */
  y: number;
  /** Active snap guides for rendering. */
  guides: SnapGuide[];
}

/**
 * Snap a value to the nearest grid multiple.
 * @param value - The value to snap
 * @param gridSize - The grid spacing
 * @returns The snapped value
 */
export function snapToGridValue(value: number, gridSize: number): number {
  return Math.round(value / gridSize) * gridSize;
}

/**
 * Snap a position to the grid if snap-to-grid is enabled.
 */
export function snapPositionToGrid(
  x: number,
  y: number,
  config: SnapConfig,
): { x: number; y: number } {
  if (!config.snapToGrid || config.gridSize <= 0) return { x, y };
  return {
    x: snapToGridValue(x, config.gridSize),
    y: snapToGridValue(y, config.gridSize),
  };
}

/**
 * Get edge positions for a bounding box: [left, centerX, right] for x, [top, centerY, bottom] for y.
 */
function getEdgePositions(bounds: Bounds): { xEdges: number[]; yEdges: number[] } {
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  return {
    xEdges: [bounds.minX, cx, bounds.maxX],
    yEdges: [bounds.minY, cy, bounds.maxY],
  };
}

/**
 * Find snap candidates for a moving element among other elements.
 * Uses pre-filtered candidates (from SpatialGrid) to avoid linear scan.
 *
 * Snapping works by checking if any edge of the moving bounds is close to any edge
 * of a candidate bounds. When a snap is found, the moving element is offset so the
 * edges align exactly.
 *
 * @param movingBounds - Bounds of the element being moved
 * @param candidateElements - Other elements to check snapping against (from spatial grid query)
 * @param threshold - Maximum distance to trigger a snap
 * @param excludeIds - Element IDs to exclude from snapping (the moving element itself)
 * @returns Snap result with snapped position and active guides
 */
export function findSnapToObject(
  movingBounds: Bounds,
  candidateElements: Element[],
  threshold: number,
  excludeIds: Set<string>,
  zoom: number = 1,
): SnapResult {
  // Zoom-independent feel: threshold is authored in screen px.
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const effectiveThreshold = threshold / safeZoom;
  const movingCX = (movingBounds.minX + movingBounds.maxX) / 2;
  const movingCY = (movingBounds.minY + movingBounds.maxY) / 2;

  let bestDx = Infinity;
  let bestDy = Infinity;
  let snapOffsetX = 0;
  let snapOffsetY = 0;
  let guideX: SnapGuide | null = null;
  let guideY: SnapGuide | null = null;

  const { xEdges: mXEdges, yEdges: mYEdges } = getEdgePositions(movingBounds);

  for (const candidate of candidateElements) {
    if (excludeIds.has(candidate.id)) continue;
    const candidateBounds = getElementBounds(candidate);
    const { xEdges: cXEdges, yEdges: cYEdges } = getEdgePositions(candidateBounds);

    // Check x-axis snaps (vertical alignment of edges)
    for (const mx of mXEdges) {
      for (const cx of cXEdges) {
        const dist = Math.abs(mx - cx);
        if (dist < effectiveThreshold && dist < bestDx) {
          bestDx = dist;
          // Offset so that moving edge mx aligns with candidate edge cx
          snapOffsetX = cx - mx;
          guideX = {
            type: 'vertical',
            position: cx,
            startX: cx,
            startY: Math.min(movingBounds.minY, candidateBounds.minY) - 20,
            endX: cx,
            endY: Math.max(movingBounds.maxY, candidateBounds.maxY) + 20,
          };
        }
      }
    }

    // Check y-axis snaps (horizontal alignment of edges)
    for (const my of mYEdges) {
      for (const cy of cYEdges) {
        const dist = Math.abs(my - cy);
        if (dist < effectiveThreshold && dist < bestDy) {
          bestDy = dist;
          snapOffsetY = cy - my;
          guideY = {
            type: 'horizontal',
            position: cy,
            startX: Math.min(movingBounds.minX, candidateBounds.minX) - 20,
            startY: cy,
            endX: Math.max(movingBounds.maxX, candidateBounds.maxX) + 20,
            endY: cy,
          };
        }
      }
    }
  }

  const guides: SnapGuide[] = [];
  let resultX = movingCX;
  let resultY = movingCY;

  if (guideX && bestDx < effectiveThreshold) {
    resultX = movingCX + snapOffsetX;
    guides.push(guideX);
  }
  if (guideY && bestDy < effectiveThreshold) {
    resultY = movingCY + snapOffsetY;
    guides.push(guideY);
  }

  return { x: resultX, y: resultY, guides };
}

/**
 * Apply combined snap (grid + object) to a position.
 * Object snapping takes priority over grid snapping when both are active.
 *
 * @param x - Current x position (center of moving element)
 * @param y - Current y position (center of moving element)
 * @param movingBounds - Bounds of the element being moved
 * @param config - Snap configuration
 * @param candidateElements - Other elements to snap against
 * @param excludeIds - IDs to exclude from snapping
 * @returns Snap result with final position and guides
 */
export function applySnap(
  x: number,
  y: number,
  movingBounds: Bounds,
  config: SnapConfig,
  candidateElements: Element[],
  excludeIds: Set<string>,
  zoom: number = 1,
): SnapResult {
  let resultX = x;
  let resultY = y;
  let guides: SnapGuide[] = [];

  if (config.snapToGrid && config.gridSize > 0) {
    const gridSnapped = snapPositionToGrid(x, y, config);
    resultX = gridSnapped.x;
    resultY = gridSnapped.y;
  }

  if (config.snapToObjects && candidateElements.length > 0) {
    const objectSnap = findSnapToObject(movingBounds, candidateElements, config.snapThreshold, excludeIds, zoom);
    if (objectSnap.guides.length > 0) {
      resultX = objectSnap.x;
      resultY = objectSnap.y;
      guides = objectSnap.guides;
    }
  }

  return { x: resultX, y: resultY, guides };
}
