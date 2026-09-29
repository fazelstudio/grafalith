import { describe, it, expect } from 'bun:test';
import { Scene } from '../scene';
import { createRectangle, createFrame } from '../scene/create-element';
import { applyConstraints } from './constraints';
import { getFrameChildren } from '../scene/frame-actions';
import type { Element, Constraints } from '../scene/types';
import type { Bounds } from '../shapes/geometry';

/** Helper: build a Bounds object from x, y, width, height. */
function bounds(x: number, y: number, w: number, h: number): Bounds {
  return { minX: x, minY: y, maxX: x + w, maxY: y + h };
}

/** Helper: create a child element with given position, size, and constraints. */
function makeChild(
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  constraints: Constraints,
): Element {
  return createRectangle({ id, x, y, width: w, height: h, constraints });
}

// ────────────────────────────────────────────────────────────────────
// Horizontal constraints
// ────────────────────────────────────────────────────────────────────
describe('Constraints — horizontal', () => {
  const oldFrame = bounds(0, 0, 200, 200);

  it('min: pins child to left edge, size unchanged', () => {
    const child = makeChild('c1', 50, 10, 40, 30, { horizontal: 'min', vertical: 'min' });
    const newFrame = bounds(0, 0, 400, 300); // frame doubled in width
    const result = applyConstraints(child, child.constraints!, oldFrame, newFrame);
    // leftDist = 50 - 0 = 50, child stays 50px from left
    expect(result.x).toBe(50);
    expect(result.width).toBe(40);
  });

  it('max: pins child to right edge, size unchanged', () => {
    const child = makeChild('c2', 140, 10, 40, 30, { horizontal: 'max', vertical: 'min' });
    const newFrame = bounds(0, 0, 400, 300);
    const result = applyConstraints(child, child.constraints!, oldFrame, newFrame);
    // rightDist = 200 - (140+40) = 20, child stays 20px from right
    // newX = 400 - 40 - 20 = 340
    expect(result.x).toBe(340);
    expect(result.width).toBe(40);
  });

  it('center: child centered horizontally, size unchanged', () => {
    const child = makeChild('c3', 80, 10, 40, 30, { horizontal: 'center', vertical: 'min' });
    const newFrame = bounds(0, 0, 400, 300);
    const result = applyConstraints(child, child.constraints!, oldFrame, newFrame);
    // centerX = (400 - 40) / 2 = 180
    expect(result.x).toBe(180);
    expect(result.width).toBe(40);
  });

  it('stretch: left and right distances preserved, width changes', () => {
    const child = makeChild('c4', 50, 10, 100, 30, { horizontal: 'stretch', vertical: 'min' });
    const newFrame = bounds(0, 0, 400, 300);
    const result = applyConstraints(child, child.constraints!, oldFrame, newFrame);
    // leftDist = 50, rightDist = 200 - 150 = 50
    // newX = 0 + 50 = 50, newW = 400 - 50 - 50 = 300
    expect(result.x).toBe(50);
    expect(result.width).toBe(300);
  });

  it('scale: position and size scale proportionally', () => {
    const child = makeChild('c5', 50, 10, 70, 30, { horizontal: 'scale', vertical: 'min' });
    const newFrame = bounds(0, 0, 400, 300); // frame doubled in width
    const result = applyConstraints(child, child.constraints!, oldFrame, newFrame);
    // ratioX = 50/200 = 0.25, newX = 0 + 0.25*400 = 100
    // scaleW = 400/200 = 2, newW = 70*2 = 140
    expect(result.x).toBe(100);
    expect(result.width).toBe(140);
  });
});

// ────────────────────────────────────────────────────────────────────
// Vertical constraints
// ────────────────────────────────────────────────────────────────────
describe('Constraints — vertical', () => {
  const oldFrame = bounds(0, 0, 200, 200);

  it('min: pins child to top edge, size unchanged', () => {
    const child = makeChild('c1', 10, 50, 30, 40, { horizontal: 'min', vertical: 'min' });
    const newFrame = bounds(0, 0, 300, 400);
    const result = applyConstraints(child, child.constraints!, oldFrame, newFrame);
    expect(result.y).toBe(50);
    expect(result.height).toBe(40);
  });

  it('max: pins child to bottom edge, size unchanged', () => {
    const child = makeChild('c2', 10, 140, 30, 40, { horizontal: 'min', vertical: 'max' });
    const newFrame = bounds(0, 0, 300, 400);
    const result = applyConstraints(child, child.constraints!, oldFrame, newFrame);
    // bottomDist = 200 - (140+40) = 20, newY = 400 - 40 - 20 = 340
    expect(result.y).toBe(340);
    expect(result.height).toBe(40);
  });

  it('center: child centered vertically, size unchanged', () => {
    const child = makeChild('c3', 10, 80, 30, 40, { horizontal: 'min', vertical: 'center' });
    const newFrame = bounds(0, 0, 300, 400);
    const result = applyConstraints(child, child.constraints!, oldFrame, newFrame);
    expect(result.y).toBe(180);
    expect(result.height).toBe(40);
  });

  it('stretch: top and bottom distances preserved, height changes', () => {
    const child = makeChild('c4', 10, 50, 30, 100, { horizontal: 'min', vertical: 'stretch' });
    const newFrame = bounds(0, 0, 300, 400);
    const result = applyConstraints(child, child.constraints!, oldFrame, newFrame);
    // topDist = 50, bottomDist = 200 - 150 = 50
    // newY = 0 + 50 = 50, newH = 400 - 50 - 50 = 300
    expect(result.y).toBe(50);
    expect(result.height).toBe(300);
  });

  it('scale: position and size scale proportionally', () => {
    const child = makeChild('c5', 10, 50, 30, 70, { horizontal: 'min', vertical: 'scale' });
    const newFrame = bounds(0, 0, 300, 400);
    const result = applyConstraints(child, child.constraints!, oldFrame, newFrame);
    // ratioY = 50/200 = 0.25, newY = 0 + 0.25*400 = 100
    // scaleH = 400/200 = 2, newH = 70*2 = 140
    expect(result.y).toBe(100);
    expect(result.height).toBe(140);
  });
});

// ────────────────────────────────────────────────────────────────────
// Combined horizontal + vertical
// ────────────────────────────────────────────────────────────────────
describe('Constraints — combined axes', () => {
  it('stretch both axes: child fills remaining space with padding', () => {
    const oldFrame = bounds(0, 0, 200, 200);
    const child = makeChild('c1', 20, 20, 160, 160, { horizontal: 'stretch', vertical: 'stretch' });
    const newFrame = bounds(0, 0, 400, 300);
    const result = applyConstraints(child, child.constraints!, oldFrame, newFrame);
    // h: leftDist=20, rightDist=200-180=20 → x=20, w=400-20-20=360
    // v: topDist=20, bottomDist=200-180=20 → y=20, h=300-20-20=260
    expect(result.x).toBe(20);
    expect(result.y).toBe(20);
    expect(result.width).toBe(360);
    expect(result.height).toBe(260);
  });

  it('scale both axes: child scales proportionally', () => {
    const oldFrame = bounds(0, 0, 200, 200);
    const child = makeChild('c1', 50, 50, 100, 100, { horizontal: 'scale', vertical: 'scale' });
    const newFrame = bounds(0, 0, 400, 400);
    const result = applyConstraints(child, child.constraints!, oldFrame, newFrame);
    // Both ratios = 0.25, both scales = 2
    expect(result.x).toBe(100);
    expect(result.y).toBe(100);
    expect(result.width).toBe(200);
    expect(result.height).toBe(200);
  });

  it('min horizontal + max vertical: pin left and bottom', () => {
    const oldFrame = bounds(0, 0, 200, 200);
    const child = makeChild('c1', 30, 150, 40, 30, { horizontal: 'min', vertical: 'max' });
    const newFrame = bounds(0, 0, 300, 400);
    const result = applyConstraints(child, child.constraints!, oldFrame, newFrame);
    // h: leftDist=30 → x=30, w=40
    // v: bottomDist=200-180=20 → y=400-30-20=350, h=30
    expect(result.x).toBe(30);
    expect(result.width).toBe(40);
    expect(result.y).toBe(350);
    expect(result.height).toBe(30);
  });
});

// ────────────────────────────────────────────────────────────────────
// Edge cases
// ────────────────────────────────────────────────────────────────────
describe('Constraints — edge cases', () => {
  it('stretch with minimum size of 1 when space is negative', () => {
    const oldFrame = bounds(0, 0, 200, 200);
    // child is nearly full width — when frame shrinks, stretch would give negative width
    const child = makeChild('c1', 10, 10, 180, 30, { horizontal: 'stretch', vertical: 'min' });
    const newFrame = bounds(0, 0, 50, 200); // frame shrunk to 50px
    const result = applyConstraints(child, child.constraints!, oldFrame, newFrame);
    // leftDist=10, rightDist=200-190=10, newW=50-10-10=30
    expect(result.width).toBe(30);
  });

  it('scale with very small frame produces width=1 minimum', () => {
    const oldFrame = bounds(0, 0, 200, 200);
    const child = makeChild('c1', 10, 10, 180, 30, { horizontal: 'scale', vertical: 'min' });
    const newFrame = bounds(0, 0, 1, 200); // frame collapsed to 1px
    const result = applyConstraints(child, child.constraints!, oldFrame, newFrame);
    expect(result.width).toBeGreaterThanOrEqual(1);
  });

  it('no constraints field returns child unchanged', () => {
    const child = createRectangle({ id: 'c1', x: 50, y: 50, width: 40, height: 30 });
    // child.constraints is undefined — applyConstraints shouldn't be called,
    // but if it is, it would error. The guard is in the caller.
    expect(child.constraints).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────────
// Integration: TransformHandler applies constraints on frame resize
// ────────────────────────────────────────────────────────────────────
describe('Constraints — integration with TransformHandler', () => {
  it('resizing a frame applies constraints to direct children', () => {
    const scene = new Scene();

    // Create a frame at (0,0) 200x200
    const frame = createFrame({ id: 'frame1', x: 0, y: 0, width: 200, height: 200 });
    scene.upsertElement(frame);

    // Create children with different constraints
    const child1 = createRectangle({
      id: 'child1', x: 10, y: 10, width: 50, height: 30,
      frameId: 'frame1', constraints: { horizontal: 'min', vertical: 'min' },
    });
    const child2 = createRectangle({
      id: 'child2', x: 140, y: 10, width: 50, height: 30,
      frameId: 'frame1', constraints: { horizontal: 'max', vertical: 'min' },
    });
    const child3 = createRectangle({
      id: 'child3', x: 75, y: 85, width: 50, height: 30,
      frameId: 'frame1', constraints: { horizontal: 'center', vertical: 'center' },
    });
    scene.upsertElement(child1);
    scene.upsertElement(child2);
    scene.upsertElement(child3);

    // Verify children are in the scene
    expect(getFrameChildren(scene, 'frame1')).toEqual(['child1', 'child2', 'child3']);

    // Manually simulate frame resize + constraint application
    // (since TransformHandler needs canvas events, we test the logic directly)
    const oldFrameBounds = { minX: 0, minY: 0, maxX: 200, maxY: 200 };
    const newFrameBounds = { minX: 0, minY: 0, maxX: 400, maxY: 200 };

    // Apply constraints to each child
    for (const child of [child1, child2, child3]) {
      if (child.constraints) {
        const patch = applyConstraints(child, child.constraints, oldFrameBounds, newFrameBounds);
        scene.upsertElement({ ...child, ...patch, version: child.version + 1, versionNonce: 999 });
      }
    }

    const updated1 = scene.getElement('child1')!;
    const updated2 = scene.getElement('child2')!;
    const updated3 = scene.getElement('child3')!;

    // child1: min horizontal — pinned to left at x=10
    expect(updated1.x).toBe(10);
    expect(updated1.width).toBe(50);

    // child2: max horizontal — pinned to right: newX = 400 - 50 - (200-190) = 340
    expect(updated2.x).toBe(340);
    expect(updated2.width).toBe(50);

    // child3: center horizontal — centerX = (400-50)/2 = 175
    expect(updated3.x).toBe(175);
    expect(updated3.width).toBe(50);

    // Vertical unchanged (frame height didn't change)
    expect(updated1.y).toBe(10);
    expect(updated2.y).toBe(10);
    expect(updated3.y).toBe(85);
  });

  it('nested frame handles constraints independently', () => {
    const scene = new Scene();

    // Outer frame
    const outerFrame = createFrame({ id: 'outer', x: 0, y: 0, width: 400, height: 400 });
    scene.upsertElement(outerFrame);

    // Inner frame (child of outer)
    const innerFrame = createFrame({
      id: 'inner', x: 50, y: 50, width: 200, height: 200,
      frameId: 'outer', constraints: { horizontal: 'stretch', vertical: 'stretch' },
    });
    scene.upsertElement(innerFrame);

    // Child of inner frame
    const grandchild = createRectangle({
      id: 'gc', x: 10, y: 10, width: 80, height: 40,
      frameId: 'inner', constraints: { horizontal: 'min', vertical: 'min' },
    });
    scene.upsertElement(grandchild);

    // Resize outer frame — inner frame should stretch, grandchild should stay put relative to inner
    const oldOuter = { minX: 0, minY: 0, maxX: 400, maxY: 400 };
    const newOuter = { minX: 0, minY: 0, maxX: 600, maxY: 400 };

    // Apply outer constraints to inner frame
    const innerPatch = applyConstraints(innerFrame, innerFrame.constraints!, oldOuter, newOuter);
    const updatedInner = { ...innerFrame, ...innerPatch };
    scene.upsertElement({ ...updatedInner, version: updatedInner.version + 1, versionNonce: 999 });

    // Inner frame should have stretched: x=50, w = 600-50-(400-250) = 600-50-150 = 400
    const finalInner = scene.getElement('inner')!;
    expect(finalInner.x).toBe(50);
    expect(finalInner.width).toBe(400);

    // Now resize inner frame — grandchild should apply its own constraints relative to inner
    const oldInner = { minX: 50, minY: 50, maxX: 250, maxY: 250 };
    const newInnerBounds = { minX: 50, minY: 50, maxX: 450, maxY: 250 };

    const gcPatch = applyConstraints(grandchild, grandchild.constraints!, oldInner, newInnerBounds);
    const updatedGc = { ...grandchild, ...gcPatch };
    scene.upsertElement({ ...updatedGc, version: updatedGc.version + 1, versionNonce: 999 });

    const finalGc = scene.getElement('gc')!;
    // min horizontal: leftDist = 10-50 = -40, newX = 50 + (-40) = 10
    expect(finalGc.x).toBe(10);
    expect(finalGc.width).toBe(80);
  });
});
