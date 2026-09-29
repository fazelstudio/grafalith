import { Element, ArrowElement, Binding, Point } from '../scene/types';
import { Scene } from '../scene/scene';
import { Bounds } from '../shapes/geometry';
import { getElementBounds } from '../shapes/index';

/** Minimum distance (in scene units) from an arrow endpoint to an element for binding to trigger. */
const BINDING_THRESHOLD = 20;

/**
 * Find the nearest element to a point, excluding a given element ID.
 * Returns the element and the distance to its nearest edge.
 */
export function findNearestElement(
  scene: Scene,
  point: Point,
  excludeId: string,
): { element: Element; distance: number } | null {
  let nearest: { element: Element; distance: number } | null = null;

  for (const el of scene.getAllElements()) {
    if (el.id === excludeId || el.isDeleted) continue;
    // Don't bind to other arrows
    if (el.type === 'arrow') continue;

    const bounds = getElementBounds(el);
    const dist = distanceToBounds(point, bounds);

    if (dist <= BINDING_THRESHOLD && (!nearest || dist < nearest.distance)) {
      nearest = { element: el, distance: dist };
    }
  }

  return nearest;
}

/**
 * Calculate the distance from a point to the nearest edge of a bounding box.
 * Returns 0 if the point is inside the bounds.
 */
export function distanceToBounds(point: Point, bounds: Bounds): number {
  const [px, py] = point;

  // Inside the bounds
  if (px >= bounds.minX && px <= bounds.maxX && py >= bounds.minY && py <= bounds.maxY) {
    return 0;
  }

  // Distance to each edge
  const dx = Math.max(bounds.minX - px, 0, px - bounds.maxX);
  const dy = Math.max(bounds.minY - py, 0, py - bounds.maxY);
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Calculate the focus value for a binding.
 * Focus is a value in [0, 1] representing the relative position along the
 * element's bounding box perimeter (clockwise from top-left).
 */
export function calculateFocus(point: Point, bounds: Bounds): number {
  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxY - bounds.minY;
  const perimeter = 2 * (w + h);

  if (perimeter === 0) return 0;

  // Find closest point on perimeter and its distance along the perimeter
  const [px, py] = point;

  // Top edge: (minX, minY) → (maxX, minY)
  const topClosestX = Math.max(bounds.minX, Math.min(px, bounds.maxX));
  const topDistSq = (px - topClosestX) ** 2 + (py - bounds.minY) ** 2;

  // Right edge: (maxX, minY) → (maxX, maxY)
  const rightClosestY = Math.max(bounds.minY, Math.min(py, bounds.maxY));
  const rightDistSq = (px - bounds.maxX) ** 2 + (py - rightClosestY) ** 2;

  // Bottom edge: (maxX, maxY) → (minX, maxY)
  const bottomClosestX = Math.max(bounds.minX, Math.min(px, bounds.maxX));
  const bottomDistSq = (px - bottomClosestX) ** 2 + (py - bounds.maxY) ** 2;

  // Left edge: (minX, maxY) → (minX, minY)
  const leftClosestY = Math.max(bounds.minY, Math.min(py, bounds.maxY));
  const leftDistSq = (px - bounds.minX) ** 2 + (py - leftClosestY) ** 2;

  // Find which edge the point is closest to
  const minDistSq = Math.min(topDistSq, rightDistSq, bottomDistSq, leftDistSq);

  if (minDistSq === topDistSq) {
    // Closest to top edge
    const t = (topClosestX - bounds.minX) / w;
    return t * (w / perimeter);
  } else if (minDistSq === rightDistSq) {
    // Closest to right edge
    const t = (rightClosestY - bounds.minY) / h;
    return (w + t * h) / perimeter;
  } else if (minDistSq === bottomDistSq) {
    // Closest to bottom edge
    const t = (bounds.maxX - bottomClosestX) / w;
    return (w + h + t * w) / perimeter;
  } else {
    // Closest to left edge
    const t = (bounds.maxY - leftClosestY) / h;
    return (2 * w + h + t * h) / perimeter;
  }
}

/**
 * Calculate the attachment point on an element's bounding box from a focus value.
 * The focus value determines where along the perimeter the arrow attaches.
 */
export function calculateAttachmentPoint(focus: number, bounds: Bounds): Point {
  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxY - bounds.minY;
  const perimeter = 2 * (w + h);

  if (perimeter === 0) return [bounds.minX, bounds.minY];

  const dist = ((focus % 1) + 1) % 1 * perimeter;

  if (dist <= w) {
    // Top edge: left to right
    return [bounds.minX + dist, bounds.minY];
  } else if (dist <= w + h) {
    // Right edge: top to bottom
    return [bounds.maxX, bounds.minY + (dist - w)];
  } else if (dist <= 2 * w + h) {
    // Bottom edge: right to left
    return [bounds.maxX - (dist - w - h), bounds.maxY];
  } else {
    // Left edge: bottom to top
    return [bounds.minX, bounds.maxY - (dist - 2 * w - h)];
  }
}

/**
 * Calculate the gap between a point and the element's bounding box edge.
 * This is the distance from the arrow endpoint to the element perimeter.
 */
export function calculateGap(point: Point, bounds: Bounds): number {
  return distanceToBounds(point, bounds);
}

/**
 * Try to bind an arrow endpoint to the nearest element.
 * Returns the Binding if an element is found within threshold, null otherwise.
 */
export function tryBindEndpoint(
  scene: Scene,
  point: Point,
  arrowId: string,
): Binding | null {
  const nearest = findNearestElement(scene, point, arrowId);
  if (!nearest) return null;

  const bounds = getElementBounds(nearest.element);
  const focus = calculateFocus(point, bounds);
  const gap = calculateGap(point, bounds);

  return {
    elementId: nearest.element.id,
    focus,
    gap,
  };
}

/**
 * Update bound arrow endpoints after a bound element has moved/resized.
 * This is the hook called from Scene.upsertElement to keep arrows attached.
 *
 * IMPORTANT: When a bound element is deleted, binding is cleared (arrow becomes floating).
 * This prevents crashes from referencing deleted elements.
 */
export function updateBoundArrows(scene: Scene, movedElementId: string): void {
  const movedElement = scene.getElement(movedElementId);
  if (!movedElement || movedElement.isDeleted) {
    // Element was deleted — clear all bindings that reference it
    clearBindingsForElement(scene, movedElementId);
    return;
  }

  const bounds = getElementBounds(movedElement);

  // Find all arrows that bind to this element
  for (const el of scene.getAllElements()) {
    if (el.type !== 'arrow' || el.isDeleted) continue;

    const arrow = el as ArrowElement;
    let needsUpdate = false;
    let newPoints = [...arrow.points];

    // Check start binding
    if (arrow.startBinding && arrow.startBinding.elementId === movedElementId) {
      const attachPt = calculateAttachmentPoint(arrow.startBinding.focus, bounds);
      const offset = arrow.startBinding.gap;
      // Move endpoint outward from element center
      const cx = (bounds.minX + bounds.maxX) / 2;
      const cy = (bounds.minY + bounds.maxY) / 2;
      const dx = attachPt[0] - cx;
      const dy = attachPt[1] - cy;
      const len = Math.sqrt(dx * dx + dy * dy);
      let endpointX: number;
      let endpointY: number;
      if (len > 0) {
        endpointX = attachPt[0] + (dx / len) * offset;
        endpointY = attachPt[1] + (dy / len) * offset;
      } else {
        endpointX = attachPt[0];
        endpointY = attachPt[1];
      }
      newPoints = [[endpointX - arrow.x, endpointY - arrow.y], ...newPoints.slice(1)];
      needsUpdate = true;
    }

    // Check end binding
    if (arrow.endBinding && arrow.endBinding.elementId === movedElementId) {
      const attachPt = calculateAttachmentPoint(arrow.endBinding.focus, bounds);
      const offset = arrow.endBinding.gap;
      const cx = (bounds.minX + bounds.maxX) / 2;
      const cy = (bounds.minY + bounds.maxY) / 2;
      const dx = attachPt[0] - cx;
      const dy = attachPt[1] - cy;
      const len = Math.sqrt(dx * dx + dy * dy);
      let endpointX: number;
      let endpointY: number;
      if (len > 0) {
        endpointX = attachPt[0] + (dx / len) * offset;
        endpointY = attachPt[1] + (dy / len) * offset;
      } else {
        endpointX = attachPt[0];
        endpointY = attachPt[1];
      }
      newPoints = [...newPoints.slice(0, -1), [endpointX - arrow.x, endpointY - arrow.y]];
      needsUpdate = true;
    }

    if (needsUpdate) {
      scene.upsertElement({
        ...arrow,
        points: newPoints,
        version: arrow.version + 1,
        versionNonce: Math.floor(Math.random() * 2_000_000_000),
      });
    }
  }
}

/**
 * Clear all bindings that reference a deleted element.
 * Arrows become floating (no binding) when their target is deleted.
 */
function clearBindingsForElement(scene: Scene, deletedElementId: string): void {
  for (const el of scene.getAllElements()) {
    if (el.type !== 'arrow' || el.isDeleted) continue;

    const arrow = el as ArrowElement;
    const needsClear =
      (arrow.startBinding && arrow.startBinding.elementId === deletedElementId) ||
      (arrow.endBinding && arrow.endBinding.elementId === deletedElementId);

    if (needsClear) {
      scene.upsertElement({
        ...arrow,
        startBinding: arrow.startBinding?.elementId === deletedElementId ? null : arrow.startBinding,
        endBinding: arrow.endBinding?.elementId === deletedElementId ? null : arrow.endBinding,
        version: arrow.version + 1,
        versionNonce: Math.floor(Math.random() * 2_000_000_000),
      });
    }
  }
}
