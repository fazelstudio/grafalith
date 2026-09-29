import type { Element, Constraints } from '../scene/types';
import type { Bounds } from '../shapes/geometry';

/**
 * Apply constraint logic to a child element when its parent frame is resized.
 * Returns a partial element with updated x, y, width, height based on the constraint mode.
 *
 * Only applies to direct children of non-auto-layout frames. Nested frames
 * handle their own constraints independently.
 *
 * @param child - The child element to reposition/resize
 * @param childConstraints - The constraint config for this child
 * @param oldFrameBounds - Frame bounds before resize
 * @param newFrameBounds - Frame bounds after resize
 * @returns Partial element with new x, y, width, height
 */
export function applyConstraints(
  child: Element,
  childConstraints: Constraints,
  oldFrameBounds: Bounds,
  newFrameBounds: Bounds,
): Partial<Element> {
  const oldFrameW = oldFrameBounds.maxX - oldFrameBounds.minX;
  const oldFrameH = oldFrameBounds.maxY - oldFrameBounds.minY;
  const newFrameW = newFrameBounds.maxX - newFrameBounds.minX;
  const newFrameH = newFrameBounds.maxY - newFrameBounds.minY;

  // Avoid division by zero
  const safeOldW = Math.max(oldFrameW, 0.001);
  const safeOldH = Math.max(oldFrameH, 0.001);

  const { x: newX, width: newW } = applyHorizontalConstraint(
    child,
    childConstraints.horizontal,
    oldFrameBounds,
    newFrameBounds,
    safeOldW,
    newFrameW,
  );
  const { y: newY, height: newH } = applyVerticalConstraint(
    child,
    childConstraints.vertical,
    oldFrameBounds,
    newFrameBounds,
    safeOldH,
    newFrameH,
  );

  return { x: newX, y: newY, width: newW, height: newH };
}

/** Apply horizontal constraint and return new x + width. */
function applyHorizontalConstraint(
  child: Element,
  mode: Constraints['horizontal'],
  oldFrame: Bounds,
  newFrame: Bounds,
  oldFrameW: number,
  newFrameW: number,
): { x: number; width: number } {
  const leftDist = child.x - oldFrame.minX;
  const rightDist = oldFrame.maxX - (child.x + child.width);

  switch (mode) {
    case 'min': {
      // Pin to left — left distance stays constant
      return { x: newFrame.minX + leftDist, width: child.width };
    }
    case 'max': {
      // Pin to right — right distance stays constant
      return { x: newFrame.maxX - child.width - rightDist, width: child.width };
    }
    case 'center': {
      // Center in frame — width unchanged
      return { x: newFrame.minX + (newFrameW - child.width) / 2, width: child.width };
    }
    case 'stretch': {
      // Both distances stay constant — width changes
      const newW = newFrameW - leftDist - rightDist;
      return { x: newFrame.minX + leftDist, width: Math.max(1, newW) };
    }
    case 'scale': {
      // Proportional — both position and size scale
      const ratioX = leftDist / oldFrameW;
      const scaleW = newFrameW / oldFrameW;
      return {
        x: newFrame.minX + ratioX * newFrameW,
        width: Math.max(1, child.width * scaleW),
      };
    }
  }
}

/** Apply vertical constraint and return new y + height. */
function applyVerticalConstraint(
  child: Element,
  mode: Constraints['vertical'],
  oldFrame: Bounds,
  newFrame: Bounds,
  oldFrameH: number,
  newFrameH: number,
): { y: number; height: number } {
  const topDist = child.y - oldFrame.minY;
  const bottomDist = oldFrame.maxY - (child.y + child.height);

  switch (mode) {
    case 'min': {
      // Pin to top — top distance stays constant
      return { y: newFrame.minY + topDist, height: child.height };
    }
    case 'max': {
      // Pin to bottom — bottom distance stays constant
      return { y: newFrame.maxY - child.height - bottomDist, height: child.height };
    }
    case 'center': {
      // Center in frame — height unchanged
      return { y: newFrame.minY + (newFrameH - child.height) / 2, height: child.height };
    }
    case 'stretch': {
      // Both distances stay constant — height changes
      const newH = newFrameH - topDist - bottomDist;
      return { y: newFrame.minY + topDist, height: Math.max(1, newH) };
    }
    case 'scale': {
      // Proportional — both position and size scale
      const ratioY = topDist / oldFrameH;
      const scaleH = newFrameH / oldFrameH;
      return {
        y: newFrame.minY + ratioY * newFrameH,
        height: Math.max(1, child.height * scaleH),
      };
    }
  }
}
