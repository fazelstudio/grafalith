import { describe, it, expect } from 'bun:test';
import {
  distanceToBounds,
  calculateFocus,
  calculateAttachmentPoint,
  calculateGap,
} from './arrow-binding';
import { Bounds } from '../shapes/geometry';

describe('Arrow Binding', () => {
  describe('distanceToBounds', () => {
    const bounds: Bounds = { minX: 100, minY: 100, maxX: 200, maxY: 200 };

    it('returns 0 for point inside bounds', () => {
      expect(distanceToBounds([150, 150], bounds)).toBe(0);
    });

    it('returns correct distance to left edge', () => {
      expect(distanceToBounds([80, 150], bounds)).toBe(20);
    });

    it('returns correct distance to right edge', () => {
      expect(distanceToBounds([220, 150], bounds)).toBe(20);
    });

    it('returns correct distance to top edge', () => {
      expect(distanceToBounds([150, 80], bounds)).toBe(20);
    });

    it('returns correct distance to bottom edge', () => {
      expect(distanceToBounds([150, 220], bounds)).toBe(20);
    });

    it('returns diagonal distance to corner', () => {
      // Distance to top-left corner (100,100) from (80,80)
      const d = distanceToBounds([80, 80], bounds);
      expect(d).toBeCloseTo(Math.sqrt(20 * 20 + 20 * 20), 5);
    });
  });

  describe('calculateFocus', () => {
    const bounds: Bounds = { minX: 100, minY: 100, maxX: 200, maxY: 200 };
    // perimeter = 2 * (100 + 100) = 400

    it('focus at top-left corner is ~0', () => {
      const focus = calculateFocus([100, 100], bounds);
      expect(focus).toBeCloseTo(0, 2);
    });

    it('focus at top-right corner', () => {
      const focus = calculateFocus([200, 100], bounds);
      // top edge = 100 / 400 = 0.25
      expect(focus).toBeCloseTo(0.25, 2);
    });

    it('focus at bottom-right corner', () => {
      const focus = calculateFocus([200, 200], bounds);
      // top + right = (100 + 100) / 400 = 0.5
      expect(focus).toBeCloseTo(0.5, 2);
    });

    it('focus at bottom-left corner', () => {
      const focus = calculateFocus([100, 200], bounds);
      // top + right + bottom = (100 + 100 + 100) / 400 = 0.75
      expect(focus).toBeCloseTo(0.75, 2);
    });

    it('focus at top-center', () => {
      const focus = calculateFocus([150, 100], bounds);
      // top edge midpoint = 50 / 400 = 0.125
      expect(focus).toBeCloseTo(0.125, 2);
    });

    it('focus at right-center', () => {
      const focus = calculateFocus([200, 150], bounds);
      // top(100) + right_mid(50) = 150 / 400 = 0.375
      expect(focus).toBeCloseTo(0.375, 2);
    });

    it('returns value in [0,1)', () => {
      const focus = calculateFocus([150, 150], bounds);
      expect(focus).toBeGreaterThanOrEqual(0);
      expect(focus).toBeLessThan(1);
    });
  });

  describe('calculateAttachmentPoint', () => {
    const bounds: Bounds = { minX: 100, minY: 100, maxX: 200, maxY: 200 };

    it('focus=0 returns top-left corner', () => {
      const pt = calculateAttachmentPoint(0, bounds);
      expect(pt[0]).toBeCloseTo(100, 5);
      expect(pt[1]).toBeCloseTo(100, 5);
    });

    it('focus=0.25 returns top-right corner', () => {
      const pt = calculateAttachmentPoint(0.25, bounds);
      expect(pt[0]).toBeCloseTo(200, 5);
      expect(pt[1]).toBeCloseTo(100, 5);
    });

    it('focus=0.5 returns bottom-right corner', () => {
      const pt = calculateAttachmentPoint(0.5, bounds);
      expect(pt[0]).toBeCloseTo(200, 5);
      expect(pt[1]).toBeCloseTo(200, 5);
    });

    it('focus=0.75 returns bottom-left corner', () => {
      const pt = calculateAttachmentPoint(0.75, bounds);
      expect(pt[0]).toBeCloseTo(100, 5);
      expect(pt[1]).toBeCloseTo(200, 5);
    });

    it('focus=0.125 returns top-center', () => {
      const pt = calculateAttachmentPoint(0.125, bounds);
      expect(pt[0]).toBeCloseTo(150, 5);
      expect(pt[1]).toBeCloseTo(100, 5);
    });

    it('focus=0.375 returns right-center', () => {
      const pt = calculateAttachmentPoint(0.375, bounds);
      expect(pt[0]).toBeCloseTo(200, 5);
      expect(pt[1]).toBeCloseTo(150, 5);
    });

    it('wraps around for focus > 1', () => {
      const pt = calculateAttachmentPoint(1.25, bounds);
      // 1.25 % 1 = 0.25 → top-right
      expect(pt[0]).toBeCloseTo(200, 5);
      expect(pt[1]).toBeCloseTo(100, 5);
    });

    it('attachment point is always on the perimeter', () => {
      const focuses = [0, 0.1, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.7, 0.75, 0.8, 0.9];
      for (const f of focuses) {
        const pt = calculateAttachmentPoint(f, bounds);
        const onPerimeter =
          (pt[1] === bounds.minY && pt[0] >= bounds.minX && pt[0] <= bounds.maxX) || // top
          (pt[0] === bounds.maxX && pt[1] >= bounds.minY && pt[1] <= bounds.maxY) || // right
          (pt[1] === bounds.maxY && pt[0] >= bounds.minX && pt[0] <= bounds.maxX) || // bottom
          (pt[0] === bounds.minX && pt[1] >= bounds.minY && pt[1] <= bounds.maxY);   // left
        expect(onPerimeter).toBe(true);
      }
    });
  });

  describe('calculateGap', () => {
    const bounds: Bounds = { minX: 100, minY: 100, maxX: 200, maxY: 200 };

    it('returns 0 for point on the edge', () => {
      expect(calculateGap([100, 150], bounds)).toBe(0);
      expect(calculateGap([150, 100], bounds)).toBe(0);
    });

    it('returns correct gap for point outside', () => {
      expect(calculateGap([250, 150], bounds)).toBe(50);
      expect(calculateGap([150, 250], bounds)).toBe(50);
    });
  });
});
