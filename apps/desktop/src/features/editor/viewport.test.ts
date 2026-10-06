import { describe, expect, test } from 'bun:test';
import { clampZoom, fitViewport, zoomViewport } from './viewport';

describe('clampZoom', () => {
  test('passes through values inside the engine range', () => {
    expect(clampZoom(1)).toBe(1);
    expect(clampZoom(2.5)).toBe(2.5);
  });

  test('clamps to the engine zoom range', () => {
    expect(clampZoom(0.01)).toBe(0.1);
    expect(clampZoom(99)).toBe(10);
  });

  test('falls back to 1 for non-finite input', () => {
    expect(clampZoom(NaN)).toBe(1);
    expect(clampZoom(Infinity)).toBe(1);
  });
});

describe('fitViewport', () => {
  test('returns null without content or view size', () => {
    expect(fitViewport(null, 800, 600)).toBeNull();
    expect(fitViewport({ minX: 0, minY: 0, maxX: 100, maxY: 100 }, 0, 600)).toBeNull();
    expect(fitViewport({ minX: 0, minY: 0, maxX: 0, maxY: 0 }, 800, 600)).toBeNull();
  });

  test('fits content exactly without padding', () => {
    const viewport = fitViewport({ minX: 0, minY: 0, maxX: 100, maxY: 100 }, 200, 200, 0);
    expect(viewport).toEqual({ scrollX: 0, scrollY: 0, zoom: 2 });
  });

  test('centers content with padding', () => {
    const viewport = fitViewport({ minX: 0, minY: 0, maxX: 100, maxY: 100 }, 200, 200, 50);
    expect(viewport?.zoom).toBe(1);
    expect(viewport?.scrollX).toBe(50);
    expect(viewport?.scrollY).toBe(50);
  });

  test('offsets content away from the origin', () => {
    const viewport = fitViewport({ minX: 40, minY: 30, maxX: 140, maxY: 130 }, 200, 200, 0);
    expect(viewport?.zoom).toBe(2);
    expect(viewport?.scrollX).toBe(-40);
    expect(viewport?.scrollY).toBe(-30);
  });
});

describe('zoomViewport', () => {
  test('keeps the anchor scene point under the cursor', () => {
    const before = { scrollX: 10, scrollY: 20, zoom: 1 };
    const after = zoomViewport(before, 2, 100, 80);
    expect(after.zoom).toBe(2);
    expect((100 / 2 - after.scrollX) * 1).toBeCloseTo(100 / 1 - before.scrollX, 9);
    expect((80 / 2 - after.scrollY) * 1).toBeCloseTo(80 / 1 - before.scrollY, 9);
  });

  test('rejects non-positive factors', () => {
    const before = { scrollX: 0, scrollY: 0, zoom: 1 };
    expect(zoomViewport(before, 0, 50, 50)).toEqual(before);
    expect(zoomViewport(before, NaN, 50, 50)).toEqual(before);
  });
});
