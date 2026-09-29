import { describe, it, expect } from 'bun:test';
import { Scene, createRectangle } from '../scene';
import {
  alignLeft,
  alignRight,
  alignTop,
  alignBottom,
  alignCenterH,
  alignCenterV,
  distributeHorizontal,
  distributeVertical,
  computeCombinedBounds,
} from './alignment';

function makeRect(scene: Scene, id: string, x: number, y: number, w: number, h: number): void {
  scene.upsertElement(createRectangle({ id, x, y, width: w, height: h }));
}

describe('alignment', () => {
  describe('computeCombinedBounds', () => {
    it('returns combined bounds of all valid elements', () => {
      const scene = new Scene();
      makeRect(scene, 'a', 10, 20, 100, 50);
      makeRect(scene, 'b', 200, 300, 80, 60);
      const b = computeCombinedBounds(scene, ['a', 'b']);
      expect(b).toEqual({ minX: 10, minY: 20, maxX: 280, maxY: 360 });
    });

    it('returns null for empty ids', () => {
      const scene = new Scene();
      expect(computeCombinedBounds(scene, [])).toBeNull();
    });

    it('ignores deleted elements', () => {
      const scene = new Scene();
      makeRect(scene, 'a', 10, 20, 100, 50);
      scene.upsertElement({ ...scene.getElement('a')!, isDeleted: true });
      expect(computeCombinedBounds(scene, ['a'])).toBeNull();
    });
  });

  describe('alignLeft', () => {
    it('moves elements to leftmost edge', () => {
      const scene = new Scene();
      makeRect(scene, 'a', 10, 0, 50, 50);
      makeRect(scene, 'b', 100, 0, 50, 50);
      alignLeft(scene, ['a', 'b']);
      expect(scene.getElement('a')!.x).toBe(10);
      expect(scene.getElement('b')!.x).toBe(10);
    });
  });

  describe('alignRight', () => {
    it('moves elements to rightmost edge', () => {
      const scene = new Scene();
      makeRect(scene, 'a', 10, 0, 50, 50);
      makeRect(scene, 'b', 100, 0, 50, 50);
      alignRight(scene, ['a', 'b']);
      expect(scene.getElement('a')!.x).toBe(100);
      expect(scene.getElement('b')!.x).toBe(100);
    });
  });

  describe('alignTop', () => {
    it('moves elements to topmost edge', () => {
      const scene = new Scene();
      makeRect(scene, 'a', 0, 10, 50, 50);
      makeRect(scene, 'b', 0, 200, 50, 50);
      alignTop(scene, ['a', 'b']);
      expect(scene.getElement('a')!.y).toBe(10);
      expect(scene.getElement('b')!.y).toBe(10);
    });
  });

  describe('alignBottom', () => {
    it('moves elements to bottommost edge', () => {
      const scene = new Scene();
      makeRect(scene, 'a', 0, 10, 50, 50);
      makeRect(scene, 'b', 0, 200, 50, 50);
      alignBottom(scene, ['a', 'b']);
      expect(scene.getElement('a')!.y).toBe(200);
      expect(scene.getElement('b')!.y).toBe(200);
    });
  });

  describe('alignCenterH', () => {
    it('moves elements to horizontal center', () => {
      const scene = new Scene();
      makeRect(scene, 'a', 0, 0, 100, 50);
      makeRect(scene, 'b', 300, 0, 60, 50);
      alignCenterH(scene, ['a', 'b']);
      // Combined: minX=0, maxX=360, centerX=180
      // a: center at 50, dx=130 -> x=130
      // b: center at 330, dx=-150 -> x=150
      expect(scene.getElement('a')!.x).toBe(130);
      expect(scene.getElement('b')!.x).toBe(150);
    });
  });

  describe('alignCenterV', () => {
    it('moves elements to vertical center', () => {
      const scene = new Scene();
      makeRect(scene, 'a', 0, 0, 50, 100);
      makeRect(scene, 'b', 0, 300, 50, 60);
      alignCenterV(scene, ['a', 'b']);
      // Combined: minY=0, maxY=360, centerY=180
      // a: center at 50, dy=130 -> y=130
      // b: center at 330, dy=-150 -> y=150
      expect(scene.getElement('a')!.y).toBe(130);
      expect(scene.getElement('b')!.y).toBe(150);
    });
  });

  describe('distributeHorizontal', () => {
    it('distributes 3 elements evenly horizontally', () => {
      const scene = new Scene();
      makeRect(scene, 'a', 0, 0, 50, 50);
      makeRect(scene, 'b', 100, 0, 50, 50);
      makeRect(scene, 'c', 250, 0, 50, 50);
      distributeHorizontal(scene, ['a', 'b', 'c']);
      // Sorted by x: a(0), b(100), c(250). Outer (first/last) stay fixed;
      // gap = (span - widths-except-last) / (n-1) = (250-100)/2 = 75.
      // a=0, b=0+50+75=125, c=125+50+75=250 (equal 75 gaps).
      expect(scene.getElement('a')!.x).toBe(0);
      expect(scene.getElement('b')!.x).toBe(125);
      expect(scene.getElement('c')!.x).toBe(250);
    });

    it('keeps already-even distribution fixed', () => {
      const scene = new Scene();
      makeRect(scene, 'a', 0, 0, 10, 10);
      makeRect(scene, 'b', 20, 0, 10, 10);
      makeRect(scene, 'c', 40, 0, 10, 10);
      distributeHorizontal(scene, ['a', 'b', 'c']);
      expect(scene.getElement('a')!.x).toBe(0);
      expect(scene.getElement('b')!.x).toBe(20);
      expect(scene.getElement('c')!.x).toBe(40);
    });

    it('does nothing with fewer than 3 elements', () => {
      const scene = new Scene();
      makeRect(scene, 'a', 0, 0, 50, 50);
      makeRect(scene, 'b', 100, 0, 50, 50);
      distributeHorizontal(scene, ['a', 'b']);
      expect(scene.getElement('a')!.x).toBe(0);
      expect(scene.getElement('b')!.x).toBe(100);
    });
  });

  describe('distributeVertical', () => {
    it('distributes 3 elements evenly vertically', () => {
      const scene = new Scene();
      makeRect(scene, 'a', 0, 0, 50, 50);
      makeRect(scene, 'b', 0, 100, 50, 50);
      makeRect(scene, 'c', 0, 250, 50, 50);
      distributeVertical(scene, ['a', 'b', 'c']);
      // Same math as horizontal: gap=75, a=0, b=125, c=250.
      expect(scene.getElement('a')!.y).toBe(0);
      expect(scene.getElement('b')!.y).toBe(125);
      expect(scene.getElement('c')!.y).toBe(250);
    });
  });
});
