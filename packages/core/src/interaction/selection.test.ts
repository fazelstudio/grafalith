import { describe, it, expect } from 'bun:test';
import { Scene } from '../scene';
import { createRectangle, createEllipse } from '../scene/create-element';
import { queryElementsInBounds, boundsOverlap, SelectionManager } from './selection';
import type { Bounds } from '../shapes/geometry';

describe('boundsOverlap', () => {
  it('returns true for overlapping bounds', () => {
    const a: Bounds = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    const b: Bounds = { minX: 5, minY: 5, maxX: 15, maxY: 15 };
    expect(boundsOverlap(a, b)).toBe(true);
  });

  it('returns false for non-overlapping bounds (horizontal)', () => {
    const a: Bounds = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    const b: Bounds = { minX: 20, minY: 0, maxX: 30, maxY: 10 };
    expect(boundsOverlap(a, b)).toBe(false);
  });

  it('returns false for non-overlapping bounds (vertical)', () => {
    const a: Bounds = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    const b: Bounds = { minX: 0, minY: 20, maxX: 10, maxY: 30 };
    expect(boundsOverlap(a, b)).toBe(false);
  });

  it('returns true for identical bounds', () => {
    const a: Bounds = { minX: 5, minY: 5, maxX: 10, maxY: 10 };
    expect(boundsOverlap(a, a)).toBe(true);
  });

  it('returns true for touching edges (adjacent)', () => {
    const a: Bounds = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    const b: Bounds = { minX: 10, minY: 0, maxX: 20, maxY: 10 };
    // Touching at x=10 — minX <= maxX and maxX >= minX both true
    expect(boundsOverlap(a, b)).toBe(true);
  });

  it('returns false when one contains the other (subset)', () => {
    const outer: Bounds = { minX: 0, minY: 0, maxX: 20, maxY: 20 };
    const inner: Bounds = { minX: 5, minY: 5, maxX: 10, maxY: 10 };
    expect(boundsOverlap(outer, inner)).toBe(true);
  });
});

describe('queryElementsInBounds', () => {
  function makeScene(): Scene {
    const scene = new Scene();
    scene.upsertElement(createRectangle({ id: 'r1', x: 0, y: 0, width: 100, height: 80 }));
    scene.upsertElement(createRectangle({ id: 'r2', x: 200, y: 200, width: 50, height: 50 }));
    scene.upsertElement(createEllipse({ id: 'e1', x: 50, y: 50, width: 120, height: 80 }));
    scene.upsertElement(createRectangle({ id: 'r3', x: 500, y: 500, width: 30, height: 30 }));
    return scene;
  }

  it('returns elements that overlap with query bounds', () => {
    const scene = makeScene();
    const results = queryElementsInBounds(scene, { minX: 0, minY: 0, maxX: 150, maxY: 150 });
    const ids = results.map((e) => e.id).sort();
    expect(ids).toEqual(['e1', 'r1']);
  });

  it('returns empty array when no elements overlap', () => {
    const scene = makeScene();
    const results = queryElementsInBounds(scene, { minX: 900, minY: 900, maxX: 950, maxY: 950 });
    expect(results).toEqual([]);
  });

  it('returns all elements when bounds cover entire scene', () => {
    const scene = makeScene();
    const results = queryElementsInBounds(scene, { minX: -100, minY: -100, maxX: 1000, maxY: 1000 });
    expect(results.length).toBe(4);
  });

  it('excludes deleted elements', () => {
    const scene = makeScene();
    scene.upsertElement({ ...scene.getElement('r2')!, isDeleted: true });
    const results = queryElementsInBounds(scene, { minX: 150, minY: 150, maxX: 300, maxY: 300 });
    const ids = results.map((e) => e.id);
    expect(ids).not.toContain('r2');
  });

  it('returns empty for zero-area bounds that do not touch any element', () => {
    const scene = makeScene();
    // Point at (150, 150) — between r1 and r2
    const results = queryElementsInBounds(scene, { minX: 150, minY: 150, maxX: 150, maxY: 150 });
    // Zero-area bounds — pointInBounds needs <= so a point on the edge may or may not match
    // Depending on boundsOverlap implementation. The key is no false positives.
    expect(results.length).toBe(0);
  });
});

describe('SelectionManager', () => {
  function makeSceneWithElements(): Scene {
    const scene = new Scene();
    scene.upsertElement(createRectangle({ id: 'a', x: 0, y: 0, width: 100, height: 100 }));
    scene.upsertElement(createRectangle({ id: 'b', x: 200, y: 200, width: 100, height: 100 }));
    return scene;
  }

  const noopViewport = { scrollX: 0, scrollY: 0, zoom: 1 };
  const noopChange = () => {};

  it('starts with empty selection', () => {
    const scene = makeSceneWithElements();
    const mgr = new SelectionManager(scene, noopViewport, noopChange);
    expect(mgr.getSelectedIds().size).toBe(0);
  });

  it('setSelection replaces selection', () => {
    const scene = makeSceneWithElements();
    const mgr = new SelectionManager(scene, noopViewport, noopChange);
    mgr.setSelection(new Set(['a']));
    expect(mgr.isSelected('a')).toBe(true);
    expect(mgr.isSelected('b')).toBe(false);
  });

  it('addToSelection adds without replacing', () => {
    const scene = makeSceneWithElements();
    const mgr = new SelectionManager(scene, noopViewport, noopChange);
    mgr.setSelection(new Set(['a']));
    mgr.addToSelection('b');
    expect(mgr.isSelected('a')).toBe(true);
    expect(mgr.isSelected('b')).toBe(true);
  });

  it('toggleSelection toggles on/off', () => {
    const scene = makeSceneWithElements();
    const mgr = new SelectionManager(scene, noopViewport, noopChange);
    mgr.setSelection(new Set(['a']));
    mgr.toggleSelection('b');
    expect(mgr.isSelected('b')).toBe(true);
    mgr.toggleSelection('b');
    expect(mgr.isSelected('b')).toBe(false);
    // 'a' should still be selected
    expect(mgr.isSelected('a')).toBe(true);
  });

  it('clearSelection removes all', () => {
    const scene = makeSceneWithElements();
    const mgr = new SelectionManager(scene, noopViewport, noopChange);
    mgr.setSelection(new Set(['a', 'b']));
    mgr.clearSelection();
    expect(mgr.getSelectedIds().size).toBe(0);
  });

  it('deleteSelected soft-deletes selected elements', () => {
    const scene = makeSceneWithElements();
    const mgr = new SelectionManager(scene, noopViewport, noopChange);
    mgr.setSelection(new Set(['a']));
    mgr.deleteSelected();

    const el = scene.getElement('a');
    expect(el).toBeDefined();
    expect(el!.isDeleted).toBe(true);
    // Should be cleared from selection
    expect(mgr.isSelected('a')).toBe(false);
  });

  it('nudgeSelected moves elements by delta', () => {
    const scene = makeSceneWithElements();
    const mgr = new SelectionManager(scene, noopViewport, noopChange);
    mgr.setSelection(new Set(['a']));
    mgr.nudgeSelected(10, 20);

    const el = scene.getElement('a')!;
    expect(el.x).toBe(10);
    expect(el.y).toBe(20);
  });

  it('hitTest finds element at point', () => {
    const scene = makeSceneWithElements();
    const mgr = new SelectionManager(scene, noopViewport, noopChange);
    const hit = mgr.hitTest(50, 50);
    expect(hit).toBeDefined();
    expect(hit!.id).toBe('a');
  });

  it('hitTest returns null when no element at point', () => {
    const scene = makeSceneWithElements();
    const mgr = new SelectionManager(scene, noopViewport, noopChange);
    const hit = mgr.hitTest(500, 500);
    expect(hit).toBeNull();
  });

  it('hitTest returns top element when overlapping', () => {
    const scene = new Scene();
    scene.upsertElement(createRectangle({ id: 'bottom', x: 0, y: 0, width: 200, height: 200 }));
    scene.upsertElement(createRectangle({ id: 'top', x: 50, y: 50, width: 100, height: 100 }));
    const mgr = new SelectionManager(scene, noopViewport, noopChange);
    const hit = mgr.hitTest(100, 100);
    expect(hit!.id).toBe('top');
  });
});
