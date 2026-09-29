import { Scene } from '../scene';
import type { Element } from '../scene/types';
import { getFrameChildren } from '../scene/frame-actions';

/**
 * Apply auto-layout to a frame, repositioning all direct children.
 * Children are arranged according to direction, gap, padding, and alignment.
 * Each child's position is recalculated — manual positions are overridden.
 *
 * @param scene - Scene to operate on
 * @param frameId - ID of the frame with auto-layout enabled
 */
export function applyAutoLayout(scene: Scene, frameId: string): void {
  const frame = scene.getElement(frameId);
  if (!frame || frame.type !== 'frame' || !frame.autoLayout || frame.isDeleted) return;

  const config = frame.autoLayout;
  const childIds = getFrameChildren(scene, frameId);
  if (childIds.length === 0) return;

  const children = childIds
    .map((id) => scene.getElement(id))
    .filter((el): el is Element => el !== undefined && !el.isDeleted);

  if (children.length === 0) return;

  const isHorizontal = config.direction === 'horizontal';

  // Calculate available space (inside padding)
  const padLeft = config.padding.left;
  const padTop = config.padding.top;
  const padRight = config.padding.right;
  const padBottom = config.padding.bottom;

  const availableW = frame.width - padLeft - padRight;
  const availableH = frame.height - padTop - padBottom;

  // Separate fixed and fill children
  const fixedChildren = children.filter((c) => c.childLayoutSizing !== 'fill');
  const fillChildren = children.filter((c) => c.childLayoutSizing === 'fill');

  // Total fixed size on primary axis (including gaps between them for start/center/end)
  let totalFixedSize = 0;
  for (let i = 0; i < fixedChildren.length; i++) {
    totalFixedSize += isHorizontal ? fixedChildren[i].width : fixedChildren[i].height;
    if (config.primaryAxisAlign !== 'space-between' && i < fixedChildren.length - 1) {
      totalFixedSize += config.gap;
    }
  }

  // Space available for fill children
  const totalFillSlots = fillChildren.length;
  const fillSpace = Math.max(0, (isHorizontal ? availableW : availableH) - totalFixedSize);
  const fillSize = totalFillSlots > 0 ? fillSpace / totalFillSlots : 0;

  // Compute primary-axis positions
  const positions: number[] = [];
  let primaryCursor = 0;

  if (config.primaryAxisAlign === 'space-between') {
    // Distribute gaps evenly between all children
    const totalGapSpace = Math.max(0, (isHorizontal ? availableW : availableH) - totalFixedSize);
    const gapCount = Math.max(1, children.length - 1);
    const evenlySpacedGap = gapCount > 0 ? totalGapSpace / gapCount : 0;

    // Positions stored relative to available space (padding added at application time)
    primaryCursor = 0;

    for (let i = 0; i < children.length; i++) {
      positions.push(primaryCursor);
      const childSize = children[i].childLayoutSizing === 'fill'
        ? fillSize
        : (isHorizontal ? children[i].width : children[i].height);
      primaryCursor += childSize;
      if (i < children.length - 1) primaryCursor += evenlySpacedGap;
    }
  } else {
    // start, center, end — compute offset first
    const totalContentSize = totalFixedSize + totalFillSlots * fillSize;
    let offset = 0;

    if (config.primaryAxisAlign === 'center') {
      offset = Math.max(0, ((isHorizontal ? availableW : availableH) - totalContentSize) / 2);
    } else if (config.primaryAxisAlign === 'end') {
      offset = Math.max(0, (isHorizontal ? availableW : availableH) - totalContentSize);
    }

    primaryCursor = offset;

    for (let i = 0; i < children.length; i++) {
      positions.push(primaryCursor);
      const childSize = children[i].childLayoutSizing === 'fill'
        ? fillSize
        : (isHorizontal ? children[i].width : children[i].height);
      primaryCursor += childSize + config.gap;
    }
  }

  // Apply positions and counter-axis alignment
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const primaryPos = positions[i];
    const childCounterSize = isHorizontal ? child.height : child.width;

    let counterPos = padTop;
    let newCounterSize = childCounterSize;

    if (isHorizontal) {
      // Counter axis = Y (vertical)
      const counterAvailable = availableH;

      switch (config.counterAxisAlign) {
        case 'start':
          counterPos = padTop;
          newCounterSize = child.height;
          break;
        case 'center':
          counterPos = padTop + (counterAvailable - child.height) / 2;
          newCounterSize = child.height;
          break;
        case 'end':
          counterPos = padTop + counterAvailable - child.height;
          newCounterSize = child.height;
          break;
        case 'stretch':
          counterPos = padTop;
          newCounterSize = counterAvailable;
          break;
      }

      const newX = frame.x + padLeft + primaryPos;
      const newY = frame.y + counterPos;
      const newW = child.childLayoutSizing === 'fill' ? fillSize : child.width;

      scene.upsertElement({
        ...child,
        x: newX,
        y: newY,
        width: Math.max(1, newW),
        height: Math.max(1, newCounterSize),
        version: child.version + 1,
        versionNonce: Math.floor(Math.random() * 2_000_000_000),
      });
    } else {
      // Counter axis = X (horizontal)
      const counterAvailable = availableW;

      switch (config.counterAxisAlign) {
        case 'start':
          counterPos = padLeft;
          newCounterSize = child.width;
          break;
        case 'center':
          counterPos = padLeft + (counterAvailable - child.width) / 2;
          newCounterSize = child.width;
          break;
        case 'end':
          counterPos = padLeft + counterAvailable - child.width;
          newCounterSize = child.width;
          break;
        case 'stretch':
          counterPos = padLeft;
          newCounterSize = counterAvailable;
          break;
      }

      const newX = frame.x + counterPos;
      const newY = frame.y + padTop + primaryPos;
      const newH = child.childLayoutSizing === 'fill' ? fillSize : child.height;

      scene.upsertElement({
        ...child,
        x: newX,
        y: newY,
        width: Math.max(1, newCounterSize),
        height: Math.max(1, newH),
        version: child.version + 1,
        versionNonce: Math.floor(Math.random() * 2_000_000_000),
      });
    }
  }

  // If frame sizing is 'hug', resize frame to fit children
  if (config.sizing === 'hug') {
    let primaryTotal = 0;

    for (let i = 0; i < children.length; i++) {
      const child = scene.getElement(children[i].id);
      if (!child) continue;
      const childSize = isHorizontal ? child.width : child.height;
      primaryTotal += childSize;
      if (i < children.length - 1) primaryTotal += config.gap;
    }

    // Counter-axis: find max child size
    let maxCounter = 0;
    for (const child of children) {
      const c = scene.getElement(child.id);
      if (!c) continue;
      const counterSize = isHorizontal ? c.height : c.width;
      if (counterSize > maxCounter) maxCounter = counterSize;
    }

    const newFrameW = isHorizontal
      ? primaryTotal + padLeft + padRight
      : maxCounter + padLeft + padRight;
    const newFrameH = isHorizontal
      ? maxCounter + padTop + padBottom
      : primaryTotal + padTop + padBottom;

    scene.upsertElement({
      ...frame,
      width: Math.max(1, newFrameW),
      height: Math.max(1, newFrameH),
      version: frame.version + 1,
      versionNonce: Math.floor(Math.random() * 2_000_000_000),
    });
  }
}
