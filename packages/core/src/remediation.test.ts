import { describe, test, expect } from 'bun:test';
import { Scene } from './scene/scene';
import { HistoryManager } from './history/history-manager';
import { createRectangle, createEllipse, createLine } from './scene/create-element';
import { copyElements, pasteElements, clearClipboardBuffer } from './interaction/clipboard';
import { TransformHandler } from './interaction/transform';
import { findSnapToObject, defaultSnapConfig } from './interaction/snap';
import { hitTestPath } from './shapes/path';
import { hitTestArrow } from './shapes/arrow';
import { getImageBounds, hitTestImage } from './shapes/image';
import { exportSceneToJSON } from './io/export-json';
import { importSceneFromJSON } from './io/import-json';
import { groupElements, getGroupMembers } from './scene/group-actions';
import type { PathElement, ArrowElement } from './scene/types';

const viewport = { scrollX: 0, scrollY: 0, zoom: 1 };

function makeSceneWithRects(): { scene: Scene; history: HistoryManager; ids: string[] } {
  const scene = new Scene();
  const history = new HistoryManager(scene);
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) {
    const el = createRectangle({ x: i * 100, y: 0, width: 50, height: 50 });
    scene.upsertElement(el);
    ids.push(el.id);
  }
  // Clear history from setup so tests observe only their own actions.
  while (history.canUndo()) {
    history.undo();
  }
  // Re-create cleanly: undo removed them; rebuild without history.
  history['undoStack' as never] = [] as never;
  history['redoStack' as never] = [] as never;
  return { scene, history, ids };
}

describe('remediation — centralized version discipline', () => {
  test('upsert auto-bumps version without caller pre-bump', () => {
    const scene = new Scene();
    const el = createRectangle({ x: 0, y: 0 });
    scene.upsertElement(el);
    const v0 = scene.getElement(el.id)!.version;
    scene.upsertElement({ ...scene.getElement(el.id)!, x: 10 });
    const v1 = scene.getElement(el.id)!.version;
    expect(v1).toBe(v0 + 1);
  });

  test('snapshots do not alias caller objects (deep clone boundary)', () => {
    const scene = new Scene();
    const history = new HistoryManager(scene);
    const el = createRectangle({ x: 0, y: 0 });
    scene.upsertElement(el);
    const stored = scene.getElement(el.id)!;
    expect(stored).not.toBe(el);
    expect(history.canUndo()).toBe(true);
    history.destroy();
  });

  test('deleteElement bumps version and removes from grid', () => {
    const scene = new Scene();
    const el = createRectangle({ x: 0, y: 0, width: 50, height: 50 });
    scene.upsertElement(el);
    const v0 = scene.getElement(el.id)!.version;
    scene.deleteElement(el.id);
    // Soft-delete keeps the record; grid must not return it.
    const grid = scene.getSpatialGrid();
    const found = grid.queryBounds({ minX: -10, minY: -10, maxX: 100, maxY: 100 });
    expect(found.has(el.id)).toBe(false);
    const tombstone = scene['elements' as never] as Map<string, { version: number }>;
    expect((tombstone.get(el.id) as { version: number }).version).toBe(v0 + 1);
  });
});

describe('remediation — history atomicity and redo invalidation', () => {
  test('batched move clears redo stack', () => {
    const scene = new Scene();
    const history = new HistoryManager(scene);
    const el = createRectangle({ x: 0, y: 0 });
    scene.upsertElement(el);
    history.undo();
    expect(history.canRedo()).toBe(true);
    history.startBatch();
    scene.upsertElement({ ...scene.getElement(el.id)!, x: 5 });
    history.endBatch();
    expect(history.canRedo()).toBe(false);
    history.destroy();
  });

  test('z-order change is undoable', () => {
    const { scene, history, ids } = makeSceneWithRects();
    // Rebuild deterministically (helper undid setup).
    const s2 = new Scene();
    const h2 = new HistoryManager(s2);
    const created = ids.map((_, i) => {
      const el = createRectangle({ x: i * 100, y: 0, width: 50, height: 50 });
      s2.upsertElement(el);
      return el.id;
    });
    const before = s2.getElementOrder();
    const rotated = [created[1], created[2], created[0]];
    s2.setElementOrder(rotated);
    expect(s2.getElementOrder()).toEqual(rotated);
    h2.undo();
    expect(s2.getElementOrder()).toEqual(before);
    h2.redo();
    expect(s2.getElementOrder()).toEqual(rotated);
    h2.destroy();
    history.destroy();
    void scene;
  });

  test('create undo/redo preserves order slot', () => {
    const scene = new Scene();
    const history = new HistoryManager(scene);
    const a = createRectangle({ x: 0, y: 0 });
    const b = createRectangle({ x: 100, y: 0 });
    scene.upsertElement(a);
    scene.upsertElement(b);
    const orderBefore = scene.getElementOrder();
    history.undo(); // undo create b
    expect(scene.getElement(b.id)).toBeUndefined();
    history.redo();
    expect(scene.getElement(b.id)?.id).toBe(b.id);
    expect(scene.getElementOrder()).toEqual(orderBefore);
    history.destroy();
  });
});

describe('remediation — clipboard identity and relations', () => {
  test('consecutive pastes cascade (no exact stacking)', () => {
    const scene = new Scene();
    const history = new HistoryManager(scene);
    const el = createRectangle({ x: 0, y: 0, width: 50, height: 50 });
    scene.upsertElement(el);
    copyElements(scene, [el.id]);
    const p1 = pasteElements(scene, history);
    const p2 = pasteElements(scene, history);
    expect(p1[0].x).toBe(10);
    expect(p2[0].x).toBe(20);
    expect(p1[0].id).not.toBe(p2[0].id);
    expect(p1[0].versionNonce).not.toBe(p2[0].versionNonce);
    clearClipboardBuffer();
    history.destroy();
  });

  test('pasted group gets fresh group id (no merge with original)', () => {
    const scene = new Scene();
    const history = new HistoryManager(scene);
    const a = createRectangle({ x: 0, y: 0 });
    const b = createRectangle({ x: 100, y: 0 });
    scene.upsertElement(a);
    scene.upsertElement(b);
    const gid = groupElements(scene, [a.id, b.id]);
    copyElements(scene, [a.id, b.id]);
    const pasted = pasteElements(scene, history);
    expect(pasted).toHaveLength(2);
    const pastedGroupIds = pasted[0].groupIds;
    expect(pastedGroupIds.length).toBe(1);
    expect(pastedGroupIds[0]).not.toBe(gid);
    expect(pasted[1].groupIds[0]).toBe(pastedGroupIds[0]);
    // Original group intact and disjoint.
    expect(getGroupMembers(scene, a.id)).toHaveLength(2);
    clearClipboardBuffer();
    history.destroy();
  });

  test('pasted frame child detaches when frame not copied', () => {
    const scene = new Scene();
    const history = new HistoryManager(scene);
    const frame = createRectangle({ x: 0, y: 0, width: 500, height: 500 });
    (frame as unknown as Record<string, unknown>).type = 'frame';
    scene.upsertElement(frame as never);
    const child = createRectangle({ x: 10, y: 10 });
    (child as unknown as Record<string, unknown>).frameId = frame.id;
    scene.upsertElement(child as never);
    copyElements(scene, [child.id]);
    const [pasted] = pasteElements(scene, history);
    expect((pasted as unknown as Record<string, unknown>).frameId).toBeNull();
    clearClipboardBuffer();
    history.destroy();
  });

  test('targetPosition paste preserves relative layout', () => {
    const scene = new Scene();
    const history = new HistoryManager(scene);
    const a = createRectangle({ x: 0, y: 0, width: 10, height: 10 });
    const b = createRectangle({ x: 100, y: 0, width: 10, height: 10 });
    scene.upsertElement(a);
    scene.upsertElement(b);
    copyElements(scene, [a.id, b.id]);
    const pasted = pasteElements(scene, history, { x: 500, y: 500 });
    const xs = pasted.map((el) => el.x).sort((x, y) => x - y);
    expect(xs[1] - xs[0]).toBe(100);
    clearClipboardBuffer();
    history.destroy();
  });
});

describe('remediation — transform guards and geometry', () => {
  test('locked elements are not moved by TransformHandler', () => {
    const scene = new Scene();
    const el = createRectangle({ x: 0, y: 0, width: 50, height: 50 });
    scene.upsertElement({ ...el, locked: true });
    const handler = new TransformHandler(scene, viewport, () => {});
    handler.startMove(new Set([el.id]), 0, 0);
    expect(handler.isTransforming()).toBe(false);
  });

  test('line resize scales points (previously a no-op)', () => {
    const scene = new Scene();
    const line = createLine({ points: [[0, 0], [100, 0]] as never });
    scene.upsertElement(line);
    const handler = new TransformHandler(scene, viewport, () => {});
    handler.startResize(line.id, 'right', 100, 0);
    handler.updateResize(200, 0);
    handler.commitResize(200, 0);
    const updated = scene.getElement(line.id) as unknown as { points: [number, number][]; width: number };
    expect(updated.width).toBeGreaterThan(100);
    expect(updated.points[1][0]).toBeGreaterThan(100);
  });

  test('snap threshold is zoom-independent', () => {
    const moving = { minX: 0, minY: 0, maxX: 50, maxY: 50 };
    // 4 units away in x, far in y (no y-snap possible) — isolates x behavior.
    const other = createRectangle({ x: 54, y: 200, width: 50, height: 50 });
    const exclude = new Set<string>();
    // 4 scene units at zoom=1 = 4px < 5px → snaps.
    const r1 = findSnapToObject(moving, [other], defaultSnapConfig.snapThreshold, exclude, 1);
    expect(r1.guides.length).toBeGreaterThan(0);
    // 4 scene units at zoom=10 = 40px > 5px → no snap.
    const r2 = findSnapToObject(moving, [other], defaultSnapConfig.snapThreshold, exclude, 10);
    expect(r2.guides.length).toBe(0);
  });
});

describe('remediation — hit testing consistency', () => {
  test('closed filled path hits interior with transparent stroke', () => {
    const el = {
      id: 'p1',
      type: 'path',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: 0,
      strokeColor: 'transparent',
      backgroundColor: { type: 'solid', color: '#ff0000' },
      strokeWidth: 1,
      closed: true,
      segments: [
        { point: [0, 0], handleIn: null, handleOut: null },
        { point: [100, 0], handleIn: null, handleOut: null },
        { point: [100, 100], handleIn: null, handleOut: null },
        { point: [0, 100], handleIn: null, handleOut: null },
      ],
    } as unknown as PathElement;
    expect(hitTestPath(50, 50, el)).toBe(true);
  });

  test('arrowhead tip hits the arrow', () => {
    const el = {
      id: 'a1',
      type: 'arrow',
      x: 0,
      y: 0,
      width: 100,
      height: 10,
      rotation: 0,
      strokeWidth: 1,
      points: [[0, 0], [100, 0]],
      startArrowhead: null,
      endArrowhead: 'arrow',
    } as unknown as ArrowElement;
    expect(hitTestArrow(100, 0, el)).toBe(true);
  });

  test('image bounds are rotation-aware', () => {
    const el = createEllipse({ x: 0, y: 0, width: 100, height: 20 }) as unknown as Record<string, unknown>;
    void el;
    const img = {
      id: 'img1',
      type: 'image',
      x: 0,
      y: 0,
      width: 100,
      height: 20,
      rotation: Math.PI / 4,
    } as unknown as Parameters<typeof getImageBounds>[0];
    const b = getImageBounds(img);
    // Rotated AABB must be larger than the unrotated box in height.
    expect(b.maxY - b.minY).toBeGreaterThan(20);
    expect(hitTestImage(50, 10, { ...img, rotation: 0 })).toBe(true);
  });
});

describe('remediation — serialization hardening', () => {
  test('export carries schemaVersion and order; import restores order', () => {
    const scene = new Scene();
    const a = createRectangle({ x: 0, y: 0 });
    const b = createRectangle({ x: 100, y: 0 });
    scene.upsertElement(a);
    scene.upsertElement(b);
    const json = exportSceneToJSON(scene);
    const parsed = JSON.parse(json) as { schemaVersion: number; elementOrder: string[] };
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.elementOrder).toEqual([a.id, b.id]);

    const scene2 = new Scene();
    const result = importSceneFromJSON(json, scene2);
    expect(result.imported).toBe(2);
    expect(scene2.getElementOrder()).toEqual([a.id, b.id]);
  });

  test('import repairs dangling frame refs and reports skips', () => {
    const scene = new Scene();
    const good = createRectangle({ x: 0, y: 0 });
    const badFrame = { ...createRectangle({ x: 0, y: 0 }), frameId: 'missing-frame' };
    const json = JSON.stringify({
      schemaVersion: 1,
      version: 1,
      elements: [good, badFrame, { id: 'bad', type: 'nope' }],
    });
    const result = importSceneFromJSON(json, scene);
    expect(result.imported).toBe(2);
    expect(result.skipped).toBe(1);
    const imported = scene.getElement(badFrame.id);
    expect((imported as unknown as Record<string, unknown>).frameId).toBeNull();
  });

  test('NaN coordinates are rejected, not poisoned into the scene', () => {
    const scene = new Scene();
    const bad = { ...createRectangle({ x: 0, y: 0 }), x: NaN };
    const json = JSON.stringify({ schemaVersion: 1, version: 1, elements: [bad] });
    expect(() => importSceneFromJSON(json, scene)).toThrow('No valid elements');
    expect(scene.getElementCount()).toBe(0);
  });
});
