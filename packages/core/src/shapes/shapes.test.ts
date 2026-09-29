import { describe, it, expect } from 'bun:test';
import { hitTestRectangle, getRectangleBounds } from './rectangle';
import { createRectangle } from '../scene/create-element';
import { hitTestEllipse, getEllipseBounds } from './ellipse';
import { createEllipse } from '../scene/create-element';
import { hitTestLine, getLineBounds } from './line';
import { createLine } from '../scene/create-element';
import { hitTestFreedraw, getFreedrawBounds } from './freedraw';
import { createFreedraw } from '../scene/create-element';
import { hitTestPath, getPathBounds } from './path';
import { createPath } from '../scene/create-element';
import type { Point } from '../scene/types';

describe('Rectangle', () => {
  describe('hitTestRectangle', () => {
    const rect = createRectangle({ id: 'r1', x: 10, y: 20, width: 100, height: 80 });

    it('point clearly inside rectangle', () => {
      expect(hitTestRectangle(50, 50, rect)).toBe(true);
    });

    it('point clearly outside rectangle', () => {
      expect(hitTestRectangle(200, 200, rect)).toBe(false);
    });

    it('point on edge (boundary)', () => {
      // On the left edge
      expect(hitTestRectangle(10, 50, rect)).toBe(true);
      // On the right edge
      expect(hitTestRectangle(110, 50, rect)).toBe(true);
    });

    it('point just outside corner', () => {
      expect(hitTestRectangle(9, 19, rect)).toBe(false);
    });

    it('handles rotation - point inside rotated rect', () => {
      const rotated = createRectangle({
        id: 'r2',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        rotation: Math.PI / 4, // 45 degrees
      });
      // Center should still be inside
      expect(hitTestRectangle(50, 50, rotated)).toBe(true);
    });

    it('handles rotation - corner of bounding box outside rotated rect', () => {
      const rotated = createRectangle({
        id: 'r3',
        x: 0,
        y: 0,
        width: 100,
        height: 20,
        rotation: Math.PI / 4, // 45 degrees
      });
      // The bounding box corner (0,0) should be outside the rotated narrow rect
      expect(hitTestRectangle(0, 0, rotated)).toBe(false);
    });
  });

  describe('getRectangleBounds', () => {
    it('returns correct bounds without rotation', () => {
      const rect = createRectangle({ id: 'r1', x: 10, y: 20, width: 100, height: 80 });
      const bounds = getRectangleBounds(rect);
      expect(bounds).toEqual({ minX: 10, minY: 20, maxX: 110, maxY: 100 });
    });

    it('returns expanded bounds with rotation', () => {
      const rect = createRectangle({
        id: 'r2',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        rotation: Math.PI / 4,
      });
      const bounds = getRectangleBounds(rect);
      // Rotated square should have larger bounding box
      expect(bounds.minX).toBeLessThan(0);
      expect(bounds.minY).toBeLessThan(0);
      expect(bounds.maxX).toBeGreaterThan(100);
      expect(bounds.maxY).toBeGreaterThan(100);
    });
  });
});

describe('Ellipse', () => {
  describe('hitTestEllipse', () => {
    const ellipse = createEllipse({ id: 'e1', x: 10, y: 20, width: 100, height: 80 });

    it('point clearly inside ellipse', () => {
      // Center of ellipse
      expect(hitTestEllipse(60, 60, ellipse)).toBe(true);
    });

    it('point clearly outside ellipse', () => {
      expect(hitTestEllipse(200, 200, ellipse)).toBe(false);
    });

    it('point at corner of bounding box but outside ellipse', () => {
      // Top-left corner of bounding box - should be OUTSIDE the ellipse
      expect(hitTestEllipse(10, 20, ellipse)).toBe(false);
      // Bottom-right corner of bounding box - should be OUTSIDE the ellipse
      expect(hitTestEllipse(110, 100, ellipse)).toBe(false);
    });

    it('point near edge but inside ellipse', () => {
      // Just inside the right edge of ellipse at center height
      expect(hitTestEllipse(108, 60, ellipse)).toBe(true);
    });

    it('point near edge but outside ellipse', () => {
      // Just outside the right edge
      expect(hitTestEllipse(112, 60, ellipse)).toBe(false);
    });

    it('mathematical accuracy - not using bounding box', () => {
      // This is the critical test: a point at the corner of the bounding box
      // should NOT be inside the ellipse (unlike a simple bounds check)
      const circleEllipse = createEllipse({ id: 'e2', x: 0, y: 0, width: 100, height: 100 });
      // Corner of bounding box (0,0) is at 45 degrees from center (50,50)
      // Distance from center = sqrt(50^2 + 50^2) ≈ 70.7 > radius 50
      expect(hitTestEllipse(0, 0, circleEllipse)).toBe(false);
      // But center of ellipse is inside
      expect(hitTestEllipse(50, 50, circleEllipse)).toBe(true);
    });

    it('handles rotation', () => {
      const rotated = createEllipse({
        id: 'e3',
        x: 0,
        y: 0,
        width: 100,
        height: 40,
        rotation: Math.PI / 2,
      });
      // Center should be inside
      expect(hitTestEllipse(50, 20, rotated)).toBe(true);
    });
  });

  describe('getEllipseBounds', () => {
    it('returns correct bounds without rotation', () => {
      const ellipse = createEllipse({ id: 'e1', x: 10, y: 20, width: 100, height: 80 });
      const bounds = getEllipseBounds(ellipse);
      expect(bounds).toEqual({ minX: 10, minY: 20, maxX: 110, maxY: 100 });
    });

    it('returns expanded bounds with rotation', () => {
      const ellipse = createEllipse({
        id: 'e2',
        x: 0,
        y: 0,
        width: 100,
        height: 40,
        rotation: Math.PI / 2,
      });
      const bounds = getEllipseBounds(ellipse);
      // After 90° rotation, hw=50, hh=20, center=(50,20)
      // Corners rotate to (70,-30),(70,70),(30,70),(30,-30)
      expect(bounds.minX).toBeCloseTo(30);
      expect(bounds.minY).toBeCloseTo(-30);
      expect(bounds.maxX).toBeCloseTo(70);
      expect(bounds.maxY).toBeCloseTo(70);
    });
  });
});

describe('Line', () => {
  describe('hitTestLine', () => {
    const line = createLine({
      id: 'l1',
      x: 0,
      y: 0,
      width: 100,
      height: 0,
      points: [[0, 0], [100, 0]],
    });

    it('point clearly on line', () => {
      expect(hitTestLine(50, 0, line)).toBe(true);
    });

    it('point clearly away from line', () => {
      expect(hitTestLine(50, 50, line)).toBe(false);
    });

    it('point near line within threshold', () => {
      // 3 pixels away - within strokeWidth/2 + 4 threshold
      expect(hitTestLine(50, 3, line)).toBe(true);
    });

    it('point far from line outside threshold', () => {
      // 10 pixels away - outside threshold
      expect(hitTestLine(50, 10, line)).toBe(false);
    });

    it('point near start of line', () => {
      expect(hitTestLine(2, 1, line)).toBe(true);
    });

    it('point near end of line', () => {
      expect(hitTestLine(98, 1, line)).toBe(true);
    });

    it('handles diagonal line', () => {
      const diag = createLine({
        id: 'l2',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        points: [[0, 0], [100, 100]],
      });
      // Point on the diagonal
      expect(hitTestLine(50, 50, diag)).toBe(true);
      // Point off the diagonal
      expect(hitTestLine(50, 70, diag)).toBe(false);
    });

    it('handles rotated line', () => {
      const rotated = createLine({
        id: 'l3',
        x: 0,
        y: 0,
        width: 100,
        height: 0,
        rotation: Math.PI / 4,
        points: [[0, 0], [100, 0]],
      });
      // AABB center is (50, 0). Line rotates around this point.
      // Rendered line goes from (50,0) to (~120.7, ~70.7)
      // Midpoint of rendered line is at (~85.35, ~35.35)
      expect(hitTestLine(85, 35, rotated)).toBe(true);
    });
  });

  describe('getLineBounds', () => {
    it('returns correct bounds for horizontal line', () => {
      const line = createLine({
        id: 'l1',
        x: 10,
        y: 20,
        width: 100,
        height: 0,
        points: [[0, 0], [100, 0]],
      });
      const bounds = getLineBounds(line);
      expect(bounds).toEqual({ minX: 10, minY: 20, maxX: 110, maxY: 20 });
    });

    it('returns correct bounds for diagonal line', () => {
      const line = createLine({
        id: 'l2',
        x: 10,
        y: 20,
        width: 100,
        height: 100,
        points: [[0, 0], [100, 100]],
      });
      const bounds = getLineBounds(line);
      expect(bounds).toEqual({ minX: 10, minY: 20, maxX: 110, maxY: 120 });
    });

    it('returns expanded bounds with rotation', () => {
      const line = createLine({
        id: 'l3',
        x: 0,
        y: 0,
        width: 100,
        height: 0,
        rotation: Math.PI / 4,
        points: [[0, 0], [100, 0]],
      });
      const bounds = getLineBounds(line);
      // localX=0, localY=0, w=100, h=0, center=(50,0), hw=50, hh=0
      // Corners [-50,0] & [50,0] rotated by π/4:
      // (-50,0) → (14.64, -35.36), (50,0) → (85.36, 35.36)
      expect(bounds.minX).toBeCloseTo(14.64, 0);
      expect(bounds.minY).toBeCloseTo(-35.36, 0);
      expect(bounds.maxX).toBeCloseTo(85.36, 0);
      expect(bounds.maxY).toBeCloseTo(35.36, 0);
    });
  });
});

describe('Freedraw', () => {
  describe('hitTestFreedraw', () => {
    const freedraw = createFreedraw({
      id: 'f1',
      x: 0,
      y: 0,
      width: 100,
      height: 0,
      points: [[0, 0], [30, 10], [60, -5], [100, 0]],
    });

    it('point clearly on freedraw path', () => {
      expect(hitTestFreedraw(30, 10, freedraw)).toBe(true);
    });

    it('point clearly away from freedraw path', () => {
      expect(hitTestFreedraw(50, 50, freedraw)).toBe(false);
    });

    it('point near freedraw path within threshold', () => {
      expect(hitTestFreedraw(50, 2, freedraw)).toBe(true);
    });

    it('point far from freedraw path outside threshold', () => {
      expect(hitTestFreedraw(50, 15, freedraw)).toBe(false);
    });

    it('handles rotated freedraw', () => {
      const rotated = createFreedraw({
        id: 'f2',
        x: 0,
        y: 0,
        width: 100,
        height: 0,
        rotation: Math.PI / 4,
        points: [[0, 0], [50, 0], [100, 0]],
      });
      // AABB center (50,0), line rotates around this point.
      // Rendered line goes from (50,0) to (~120.7, ~70.7)
      expect(hitTestFreedraw(85, 35, rotated)).toBe(true);
    });
  });

  describe('getFreedrawBounds', () => {
    it('returns correct bounds', () => {
      const freedraw = createFreedraw({
        id: 'f1',
        x: 10,
        y: 20,
        width: 100,
        height: 50,
        points: [[0, 0], [50, 20], [100, 50]],
      });
      const bounds = getFreedrawBounds(freedraw);
      expect(bounds).toEqual({ minX: 10, minY: 20, maxX: 110, maxY: 70 });
    });

    it('returns expanded bounds with rotation', () => {
      const freedraw = createFreedraw({
        id: 'f2',
        x: 0,
        y: 0,
        width: 100,
        height: 0,
        rotation: Math.PI / 4,
        points: [[0, 0], [100, 0]],
      });
      const bounds = getFreedrawBounds(freedraw);
      // Same geometry as line: localX=0, localY=0, w=100, h=0
      expect(bounds.minX).toBeCloseTo(14.64, 0);
      expect(bounds.minY).toBeCloseTo(-35.36, 0);
      expect(bounds.maxX).toBeCloseTo(85.36, 0);
      expect(bounds.maxY).toBeCloseTo(35.36, 0);
    });

    it('handles single point', () => {
      const freedraw = createFreedraw({
        id: 'f3',
        x: 50,
        y: 50,
        points: [[0, 0]],
      });
      const bounds = getFreedrawBounds(freedraw);
      expect(bounds).toEqual({ minX: 50, minY: 50, maxX: 50, maxY: 50 });
    });
  });
});

describe('Path', () => {
  describe('hitTestPath', () => {
    it('open path - point on stroke', () => {
      const path = createPath({
        id: 'p1',
        x: 0,
        y: 0,
        width: 100,
        height: 0,
        segments: [
          { point: [0, 0], handleIn: null, handleOut: null },
          { point: [100, 0], handleIn: null, handleOut: null },
        ],
        closed: false,
      });
      // Point on the line
      expect(hitTestPath(50, 0, path)).toBe(true);
    });

    it('open path - point away from stroke', () => {
      const path = createPath({
        id: 'p2',
        x: 0,
        y: 0,
        width: 100,
        height: 0,
        segments: [
          { point: [0, 0], handleIn: null, handleOut: null },
          { point: [100, 0], handleIn: null, handleOut: null },
        ],
        closed: false,
      });
      // Point far from line
      expect(hitTestPath(50, 20, path)).toBe(false);
    });

    it('closed path with fill - point inside', () => {
      const path = createPath({
        id: 'p3',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        segments: [
          { point: [0, 0], handleIn: null, handleOut: null },
          { point: [100, 0], handleIn: null, handleOut: null },
          { point: [100, 100], handleIn: null, handleOut: null },
          { point: [0, 100], handleIn: null, handleOut: null },
        ],
        closed: true,
        backgroundColor: { type: 'solid', color: '#ff0000' },
      });
      // Center of the square
      expect(hitTestPath(50, 50, path)).toBe(true);
    });

    it('closed path with fill - point outside', () => {
      const path = createPath({
        id: 'p4',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        segments: [
          { point: [0, 0], handleIn: null, handleOut: null },
          { point: [100, 0], handleIn: null, handleOut: null },
          { point: [100, 100], handleIn: null, handleOut: null },
          { point: [0, 100], handleIn: null, handleOut: null },
        ],
        closed: true,
        backgroundColor: { type: 'solid', color: '#ff0000' },
      });
      // Outside the square
      expect(hitTestPath(150, 50, path)).toBe(false);
    });

    it('path with curves - point near curve', () => {
      const path = createPath({
        id: 'p5',
        x: 0,
        y: 0,
        width: 100,
        height: 50,
        segments: [
          { point: [0, 0], handleIn: null, handleOut: [50, 0] as Point },
          { point: [100, 0], handleIn: [0, 50] as Point, handleOut: null },
        ],
        closed: false,
      });
      // Point near the curve
      expect(hitTestPath(50, 10, path)).toBe(true);
    });

    it('handles too few segments', () => {
      const path = createPath({
        id: 'p6',
        x: 0,
        y: 0,
        segments: [
          { point: [0, 0], handleIn: null, handleOut: null },
        ],
        closed: false,
      });
      expect(hitTestPath(0, 0, path)).toBe(false);
    });
  });

  describe('getPathBounds', () => {
    it('returns correct bounds for straight path', () => {
      const path = createPath({
        id: 'p7',
        x: 10,
        y: 20,
        width: 100,
        height: 50,
        segments: [
          { point: [0, 0], handleIn: null, handleOut: null },
          { point: [100, 50], handleIn: null, handleOut: null },
        ],
        closed: false,
      });
      const bounds = getPathBounds(path);
      expect(bounds).toEqual({ minX: 10, minY: 20, maxX: 110, maxY: 70 });
    });

    it('includes control points in bounds', () => {
      const path = createPath({
        id: 'p8',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        segments: [
          { point: [0, 0], handleIn: null, handleOut: [50, 100] as Point },
          { point: [100, 0], handleIn: [-50, 100] as Point, handleOut: null },
        ],
        closed: false,
      });
      const bounds = getPathBounds(path);
      // Bounds should include the control points which extend to y=100
      expect(bounds.minX).toBe(0);
      expect(bounds.minY).toBe(0);
      expect(bounds.maxX).toBe(100);
      expect(bounds.maxY).toBe(100);
    });

    it('returns empty bounds for no segments', () => {
      const path = createPath({
        id: 'p9',
        x: 50,
        y: 50,
        segments: [],
        closed: false,
      });
      const bounds = getPathBounds(path);
      expect(bounds).toEqual({ minX: 50, minY: 50, maxX: 50, maxY: 50 });
    });
  });
});
