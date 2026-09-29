import { describe, it, expect } from 'bun:test';
import { Scene, createRectangle } from '../scene';
import {
  snapToGridValue,
  snapPositionToGrid,
  findSnapToObject,
  applySnap,
  defaultSnapConfig,
} from './snap';
import type { SnapConfig } from './snap';

function makeRect(scene: Scene, id: string, x: number, y: number, w: number, h: number): void {
  scene.upsertElement(createRectangle({ id, x, y, width: w, height: h }));
}

describe('snap', () => {
  describe('snapToGridValue', () => {
    it('snaps to nearest grid multiple', () => {
      expect(snapToGridValue(0, 20)).toBe(0);
      expect(snapToGridValue(9, 20)).toBe(0);
      expect(snapToGridValue(11, 20)).toBe(20);
      expect(snapToGridValue(30, 20)).toBe(40);
      expect(snapToGridValue(-5, 20) === 0).toBe(true);
      expect(snapToGridValue(-15, 20) === -20).toBe(true);
    });
  });

  describe('snapPositionToGrid', () => {
    it('snaps both x and y when enabled', () => {
      const config: SnapConfig = { ...defaultSnapConfig, snapToGrid: true, gridSize: 20 };
      const result = snapPositionToGrid(13, 37, config);
      expect(result).toEqual({ x: 20, y: 40 });
    });

    it('returns original position when disabled', () => {
      const config: SnapConfig = { ...defaultSnapConfig, snapToGrid: false };
      const result = snapPositionToGrid(13, 37, config);
      expect(result).toEqual({ x: 13, y: 37 });
    });
  });

  describe('findSnapToObject', () => {
    it('snaps to vertical edge of another element', () => {
      const scene = new Scene();
      makeRect(scene, 'target', 100, 0, 50, 50);
      const target = scene.getElement('target')!;

      // moving left edge (155) is 5px from target right edge (150)
      const movingBounds = { minX: 155, minY: 0, maxX: 205, maxY: 50 };
      const result = findSnapToObject(movingBounds, [target], 10, new Set());

      // Should snap left edge of moving to right edge of target (150)
      // snapOffsetX = 150 - 155 = -5, so center moves from 180 to 175
      expect(result.x).toBe(175);
      expect(result.guides.length).toBeGreaterThanOrEqual(1);
      expect(result.guides.some(g => g.type === 'vertical')).toBe(true);
    });

    it('snaps to horizontal edge of another element', () => {
      const scene = new Scene();
      makeRect(scene, 'target', 0, 100, 50, 50);
      const target = scene.getElement('target')!;

      // moving top edge (155) is 5px from target bottom edge (150)
      const movingBounds = { minX: 0, minY: 155, maxX: 50, maxY: 205 };
      const result = findSnapToObject(movingBounds, [target], 10, new Set());

      // Should snap top edge of moving to bottom edge of target (150)
      // snapOffsetY = 150 - 155 = -5, so center moves from 180 to 175
      expect(result.y).toBe(175);
      expect(result.guides.length).toBeGreaterThanOrEqual(1);
      expect(result.guides.some(g => g.type === 'horizontal')).toBe(true);
    });

    it('returns no guides when nothing is within threshold', () => {
      const scene = new Scene();
      makeRect(scene, 'target', 500, 500, 50, 50);
      const target = scene.getElement('target')!;

      const movingBounds = { minX: 0, minY: 0, maxX: 50, maxY: 50 };
      const result = findSnapToObject(movingBounds, [target], 5, new Set());

      expect(result.guides.length).toBe(0);
    });

    it('excludes specified IDs', () => {
      const scene = new Scene();
      makeRect(scene, 'self', 100, 0, 50, 50);
      const self = scene.getElement('self')!;

      const movingBounds = { minX: 100, minY: 0, maxX: 150, maxY: 50 };
      const result = findSnapToObject(movingBounds, [self], 10, new Set(['self']));

      expect(result.guides.length).toBe(0);
    });
  });

  describe('applySnap', () => {
    it('applies grid snap when no object snap triggers', () => {
      const config: SnapConfig = { ...defaultSnapConfig, snapToGrid: true, gridSize: 20, snapToObjects: false };
      const result = applySnap(13, 37, { minX: 13, minY: 37, maxX: 63, maxY: 87 }, config, [], new Set());
      expect(result.x).toBe(20);
      expect(result.y).toBe(40);
      expect(result.guides.length).toBe(0);
    });
  });
});
