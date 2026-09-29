import { Scene } from './scene';
import { getElementBounds } from '../shapes';
import type { Bounds } from '../shapes/geometry';
import type { Constraints } from './types';

/** Default constraint for elements assigned to a frame (pin left/top, Figma convention). */
const DEFAULT_CONSTRAINTS: Constraints = { horizontal: 'min', vertical: 'min' };

/**
 * Check if a child element's bounds are fully contained within a frame's bounds.
 */
function isContainedInFrame(childBounds: Bounds, frameBounds: Bounds): boolean {
  return (
    childBounds.minX >= frameBounds.minX &&
    childBounds.maxX <= frameBounds.maxX &&
    childBounds.minY >= frameBounds.minY &&
    childBounds.maxY <= frameBounds.maxY
  );
}

/**
 * Auto-assign elements to frames based on spatial containment.
 * Elements whose bounds are fully inside a frame's bounds become children of that frame.
 * Checks from top to bottom (z-order) — an element is assigned to the topmost frame that contains it.
 * @param scene - Scene to operate on
 * @param elementIds - Element IDs to check (if empty, checks all non-frame elements)
 */
export function autoAssignToFrames(scene: Scene, elementIds?: string[]): void {
  const frames = scene.getAllElements().filter((el) => el.type === 'frame' && !el.isDeleted);
  const elementsToCheck = elementIds
    ? elementIds.map((id) => scene.getElement(id)).filter((el) => el && !el.isDeleted && el.type !== 'frame')
    : scene.getAllElements().filter((el) => !el.isDeleted && el.type !== 'frame');

  for (const el of elementsToCheck) {
    if (!el) continue;
    const elBounds = getElementBounds(el);

    // Find the topmost frame that contains this element
    let assignedFrameId: string | null = null;
    for (const frame of frames) {
      const frameBounds = getElementBounds(frame);
      if (isContainedInFrame(elBounds, frameBounds)) {
        assignedFrameId = frame.id;
        // Continue checking — a higher frame might also contain it
      }
    }

    if (assignedFrameId !== el.frameId) {
      // Set default constraints when first assigned to a frame
      const isNewlyAssigned = assignedFrameId !== null && el.frameId === null;
      scene.upsertElement({
        ...el,
        frameId: assignedFrameId,
        constraints: isNewlyAssigned && !el.constraints ? DEFAULT_CONSTRAINTS : el.constraints,
        version: el.version + 1,
        versionNonce: Math.floor(Math.random() * 2_000_000_000),
      });
    }
  }
}

/**
 * Get all child element IDs of a frame.
 */
export function getFrameChildren(scene: Scene, frameId: string): string[] {
  const children: string[] = [];
  for (const el of scene.getAllElements()) {
    if (!el.isDeleted && el.frameId === frameId) {
      children.push(el.id);
    }
  }
  return children;
}

/**
 * Move all children of a frame by a delta.
 */
export function moveFrameChildren(scene: Scene, frameId: string, dx: number, dy: number): void {
  const children = getFrameChildren(scene, frameId);
  for (const childId of children) {
    const child = scene.getElement(childId);
    if (child && !child.isDeleted) {
      scene.upsertElement({
        ...child,
        x: child.x + dx,
        y: child.y + dy,
        version: child.version + 1,
        versionNonce: Math.floor(Math.random() * 2_000_000_000),
      });
    }
  }
}

/**
 * Remove all frameId assignments from children of a frame.
 */
export function clearFrameChildren(scene: Scene, frameId: string): void {
  const children = getFrameChildren(scene, frameId);
  for (const childId of children) {
    const child = scene.getElement(childId);
    if (child && !child.isDeleted) {
      scene.upsertElement({
        ...child,
        frameId: null,
        version: child.version + 1,
        versionNonce: Math.floor(Math.random() * 2_000_000_000),
      });
    }
  }
}

/**
 * When a frame is deleted, release its children so they become free elements.
 * This follows the Figma convention: frame is deleted, children remain as independent elements.
 * @param scene - Scene to operate on
 * @param frameId - ID of the frame being deleted
 */
export function releaseFrameChildrenOnDelete(scene: Scene, frameId: string): void {
  clearFrameChildren(scene, frameId);
}
