import { describe, it, expect } from 'bun:test';
import { Scene } from './scene';
import { createRectangle, createEllipse } from './create-element';

describe('Scene', () => {
  it('should start with zero elements and zero nonce', () => {
    const scene = new Scene();
    expect(scene.getElementCount()).toBe(0);
    expect(scene.getSceneNonce()).toBe(0);
  });

  it('upsertElement adds element and increments sceneNonce', () => {
    const scene = new Scene();
    const rect = createRectangle({ id: 'rect-1' });

    scene.upsertElement(rect);

    expect(scene.getElementCount()).toBe(1);
    expect(scene.getSceneNonce()).toBe(1);
    expect(scene.getElement('rect-1')).toBeDefined();
    expect(scene.getElement('rect-1')!.type).toBe('rectangle');
  });

  it('upsertElement updates existing element without duplicating', () => {
    const scene = new Scene();
    const rect = createRectangle({ id: 'rect-1', x: 10 });

    scene.upsertElement(rect);
    scene.upsertElement({ ...rect, x: 50 });

    expect(scene.getElementCount()).toBe(1);
    expect(scene.getSceneNonce()).toBe(2);
    expect(scene.getElement('rect-1')!.x).toBe(50);
  });

  it('deleteElement sets isDeleted = true', () => {
    const scene = new Scene();
    const rect = createRectangle({ id: 'rect-1' });
    scene.upsertElement(rect);

    scene.deleteElement('rect-1');

    expect(scene.getSceneNonce()).toBe(2);
    const el = scene.getElement('rect-1');
    expect(el).toBeDefined();
    expect(el!.isDeleted).toBe(true);
  });

  it('getAllElements excludes deleted elements', () => {
    const scene = new Scene();
    const rect1 = createRectangle({ id: 'rect-1' });
    const rect2 = createRectangle({ id: 'rect-2' });

    scene.upsertElement(rect1);
    scene.upsertElement(rect2);
    scene.deleteElement('rect-1');

    const visible = scene.getAllElements();
    expect(visible.length).toBe(1);
    expect(visible[0].id).toBe('rect-2');
  });

  it('getElement returns undefined for non-existent id', () => {
    const scene = new Scene();
    expect(scene.getElement('non-existent')).toBeUndefined();
  });

  it('getAllElementsIncludingDeleted returns all elements', () => {
    const scene = new Scene();
    const rect1 = createRectangle({ id: 'rect-1' });
    const rect2 = createEllipse({ id: 'ellipse-1' });

    scene.upsertElement(rect1);
    scene.upsertElement(rect2);
    scene.deleteElement('rect-1');

    const all = scene.getAllElementsIncludingDeleted();
    expect(all.length).toBe(2);
    expect(all.find((e) => e.id === 'rect-1')!.isDeleted).toBe(true);
    expect(all.find((e) => e.id === 'ellipse-1')!.isDeleted).toBe(false);
  });

  it('deleteElement on non-existent id is a no-op', () => {
    const scene = new Scene();
    scene.deleteElement('ghost');
    expect(scene.getSceneNonce()).toBe(0);
  });

  it('elements maintain z-order (insertion order)', () => {
    const scene = new Scene();
    const a = createRectangle({ id: 'a' });
    const b = createRectangle({ id: 'b' });
    const c = createRectangle({ id: 'c' });

    scene.upsertElement(a);
    scene.upsertElement(b);
    scene.upsertElement(c);

    const ids = scene.getAllElements().map((e) => e.id);
    expect(ids).toEqual(['a', 'b', 'c']);
  });

  it('multiple mutations track nonce correctly', () => {
    const scene = new Scene();
    const rect = createRectangle({ id: 'rect-1' });

    scene.upsertElement(rect);
    const nonce1 = scene.getSceneNonce();

    scene.upsertElement({ ...rect, x: 20 });
    const nonce2 = scene.getSceneNonce();

    scene.deleteElement('rect-1');
    const nonce3 = scene.getSceneNonce();

    expect(nonce2).toBeGreaterThan(nonce1);
    expect(nonce3).toBeGreaterThan(nonce2);
  });
});