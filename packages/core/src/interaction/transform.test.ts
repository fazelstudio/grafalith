import { describe, it, expect } from 'bun:test';
import { Scene } from '../scene';
import { createRectangle } from '../scene/create-element';
import { TransformHandler } from './transform';
import type { Viewport } from '../render/viewport';

const identityViewport: Viewport = { scrollX: 0, scrollY: 0, zoom: 1 };

/** Create a scene with a single element for testing. */
function makeScene(id: string, x: number, y: number, w: number, h: number, rotation = 0): Scene {
  const scene = new Scene();
  scene.upsertElement(createRectangle({ id, x, y, width: w, height: h, rotation }));
  return scene;
}

describe('TransformHandler — move', () => {
  it('moves element by delta', () => {
    const scene = makeScene('r1', 100, 100, 80, 60);
    const handler = new TransformHandler(scene, identityViewport, () => {});

    // Start at (100, 100) in screen coords — same as scene since viewport is identity
    handler.startMove(new Set(['r1']), 100, 100);
    handler.updateMove(new Set(['r1']), 150, 120);
    handler.commitMove(new Set(['r1']), 150, 120);

    const el = scene.getElement('r1')!;
    expect(el.x).toBe(150);
    expect(el.y).toBe(120);
  });

  it('preserves relative positions in multi-move', () => {
    const scene = new Scene();
    scene.upsertElement(createRectangle({ id: 'a', x: 0, y: 0, width: 50, height: 50 }));
    scene.upsertElement(createRectangle({ id: 'b', x: 100, y: 100, width: 50, height: 50 }));
    const handler = new TransformHandler(scene, identityViewport, () => {});

    handler.startMove(new Set(['a', 'b']), 10, 10);
    handler.updateMove(new Set(['a', 'b']), 60, 60);
    handler.commitMove(new Set(['a', 'b']), 60, 60);

    const elA = scene.getElement('a')!;
    const elB = scene.getElement('b')!;
    // Both moved by (50, 50)
    expect(elA.x).toBe(50);
    expect(elA.y).toBe(50);
    expect(elB.x).toBe(150);
    expect(elB.y).toBe(150);
  });
});

describe('TransformHandler — resize (no rotation)', () => {
  it('resize from bottom-right increases width/height', () => {
    const scene = makeScene('r1', 100, 100, 80, 60);
    const handler = new TransformHandler(scene, identityViewport, () => {});

    // Bottom-right handle at (180, 160)
    handler.startResize('r1', 'bottom-right', 180, 160);
    handler.updateResize(220, 200);
    handler.commitResize(220, 200);

    const el = scene.getElement('r1')!;
    expect(el.x).toBe(100); // x unchanged for bottom-right
    expect(el.y).toBe(100); // y unchanged for bottom-right
    expect(el.width).toBe(120); // 220 - 100
    expect(el.height).toBe(100); // 200 - 100
  });

  it('resize from top-left changes x,y and width,height', () => {
    const scene = makeScene('r1', 100, 100, 80, 60);
    const handler = new TransformHandler(scene, identityViewport, () => {});

    // Top-left handle at (100, 100)
    handler.startResize('r1', 'top-left', 100, 100);
    handler.updateResize(80, 80);
    handler.commitResize(80, 80);

    const el = scene.getElement('r1')!;
    // Top-left: width = origX + origW - pointX = 100 + 80 - 80 = 100
    // height = origY + origH - pointY = 100 + 60 - 80 = 80
    // x = min(pointX, origX + origW - 1) = min(80, 179) = 80
    // y = min(pointY, origY + origH - 1) = min(80, 159) = 80
    expect(el.x).toBe(80);
    expect(el.y).toBe(80);
    expect(el.width).toBe(100);
    expect(el.height).toBe(80);
  });

  it('resize enforces minimum size of 1', () => {
    const scene = makeScene('r1', 100, 100, 80, 60);
    const handler = new TransformHandler(scene, identityViewport, () => {});

    // Drag bottom-right handle far to the left (negative width)
    handler.startResize('r1', 'bottom-right', 180, 160);
    handler.updateResize(50, 50);
    handler.commitResize(50, 50);

    const el = scene.getElement('r1')!;
    expect(el.width).toBeGreaterThanOrEqual(1);
    expect(el.height).toBeGreaterThanOrEqual(1);
  });
});

describe('TransformHandler — resize with rotation', () => {
  it('resize from bottom-right on 90° rotated element produces valid dimensions', () => {
    const scene = makeScene('r1', 100, 100, 80, 60, Math.PI / 2);
    const handler = new TransformHandler(scene, identityViewport, () => {});

    // The element center is at (140, 130)
    // Bottom-right handle in rotated space
    handler.startResize('r1', 'bottom-right', 140, 130);
    handler.updateResize(180, 170);
    handler.commitResize(180, 170);

    const el = scene.getElement('r1')!;
    expect(el.width).toBeGreaterThanOrEqual(1);
    expect(el.height).toBeGreaterThanOrEqual(1);
    expect(el.rotation).toBe(Math.PI / 2); // rotation preserved
  });

  it('resize from top-left on rotated element keeps opposite (local) corner fixed', () => {
    const scene = makeScene('r1', 100, 100, 80, 60, Math.PI / 4);
    const handler = new TransformHandler(scene, identityViewport, () => {});

    const rot = Math.PI / 4;
    const cosR = Math.cos(rot);
    const sinR = Math.sin(rot);
    // Opposite corner in local space for a top-left drag = (+hw, +hh).
    const origOppX = 140 + (40 * cosR - 30 * sinR);
    const origOppY = 130 + (40 * sinR + 30 * cosR);

    // Start resize from top-left
    handler.startResize('r1', 'top-left', 100, 100);
    handler.updateResize(120, 120);
    handler.commitResize(120, 120);

    const el = scene.getElement('r1')!;
    const newCx = el.x + el.width / 2;
    const newCy = el.y + el.height / 2;
    const newOppX = newCx + ((el.width / 2) * cosR - (el.height / 2) * sinR);
    const newOppY = newCy + ((el.width / 2) * sinR + (el.height / 2) * cosR);
    expect(Math.abs(newOppX - origOppX)).toBeLessThan(15);
    expect(Math.abs(newOppY - origOppY)).toBeLessThan(15);
  });
});

describe('TransformHandler — rotate', () => {
  it('rotate updates rotation angle', () => {
    const scene = makeScene('r1', 100, 100, 80, 60);
    const handler = new TransformHandler(scene, identityViewport, () => {});

    // Start from center-right, drag to center-bottom → ~90° rotation
    const cx = 140, cy = 130;
    handler.startRotate('r1', cx + 50, cy); // anchor at right
    handler.updateRotate(cx, cy + 50, false); // drag to below center
    handler.commitRotate(cx, cy + 50, false);

    const el = scene.getElement('r1')!;
    expect(Math.abs(el.rotation)).toBeGreaterThan(0.1);
  });

  it('rotate with shift snaps to 15° increments', () => {
    const scene = makeScene('r1', 100, 100, 80, 60);
    const handler = new TransformHandler(scene, identityViewport, () => {});

    const cx = 140, cy = 130;
    // Start from right, drag to slightly below → should snap to 15° (π/12)
    handler.startRotate('r1', cx + 50, cy);
    handler.updateRotate(cx + 40, cy + 15, true);
    handler.commitRotate(cx + 40, cy + 15, true);

    const el = scene.getElement('r1')!;
    const snap = Math.PI / 12;
    const nearestSnap = Math.round(el.rotation / snap) * snap;
    expect(Math.abs(el.rotation - nearestSnap)).toBeLessThan(0.01);
  });
});

describe('TransformHandler — preview', () => {
  it('getPreviewElements returns preview during transform', () => {
    const scene = makeScene('r1', 100, 100, 80, 60);
    const handler = new TransformHandler(scene, identityViewport, () => {});

    handler.startMove(new Set(['r1']), 100, 100);
    handler.updateMove(new Set(['r1']), 150, 150);

    const previews = handler.getPreviewElements();
    expect(previews.length).toBe(1);
    expect(previews[0].x).toBe(150);
    expect(previews[0].y).toBe(150);
  });

  it('cancelTransform clears preview', () => {
    const scene = makeScene('r1', 100, 100, 80, 60);
    const handler = new TransformHandler(scene, identityViewport, () => {});

    handler.startMove(new Set(['r1']), 100, 100);
    handler.updateMove(new Set(['r1']), 150, 150);
    handler.cancelTransform();

    expect(handler.getPreviewElements()).toEqual([]);
    expect(handler.isTransforming()).toBe(false);
  });
});
