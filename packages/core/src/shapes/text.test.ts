import { describe, it, expect } from 'bun:test';
import { measureText, hitTestText, getTextBounds } from './text';
import { createText } from '../scene/create-element';

/** Minimal mock of CanvasRenderingContext2D for measureText testing. */
function getMockCtx(): CanvasRenderingContext2D {
  let currentFont = '';
  return {
    save() {},
    restore() {},
    set font(v: string) { currentFont = v; },
    get font() { return currentFont; },
    measureText(text: string) {
      // Approximate width: average char width ~0.6 * fontSize for sans-serif
      const fontSize = parseFloat(currentFont) || 16;
      return { width: text.length * fontSize * 0.6 } as TextMetrics;
    },
    fillText() {},
    strokeText() {},
    set textBaseline(_v: string) {},
    set textAlign(_v: string) {},
    set globalAlpha(_v: number) {},
    set fillStyle(_v: string | CanvasGradient | CanvasPattern) {},
    set strokeStyle(_v: string | CanvasGradient | CanvasPattern) {},
    set lineWidth(_v: number) {},
    setLineDash(_v: number[]) {},
    beginPath() {},
    moveTo(_x: number, _y: number) {},
    lineTo(_x: number, _y: number) {},
    fillRect(_x: number, _y: number, _w: number, _h: number) {},
    strokeRect(_x: number, _y: number, _w: number, _h: number) {},
    translate(_x: number, _y: number) {},
    rotate(_angle: number) {},
    fill() {},
    stroke() {},
    closePath() {},
    arcTo(_x1: number, _y1: number, _x2: number, _y2: number, _r: number) {},
    setTransform(_a: number, _b: number, _c: number, _d: number, _e: number, _f: number) {},
    clearRect(_x: number, _y: number, _w: number, _h: number) {},
  } as unknown as CanvasRenderingContext2D;
}

describe('Text', () => {
  describe('measureText', () => {
    it('returns consistent results for same input', () => {
      const ctx = getMockCtx();
      const a = measureText(ctx, 'Hello', 16, 'sans-serif');
      const b = measureText(ctx, 'Hello', 16, 'sans-serif');
      expect(a.width).toBe(b.width);
      expect(a.height).toBe(b.height);
    });

    it('width increases with longer text', () => {
      const ctx = getMockCtx();
      const short = measureText(ctx, 'Hi', 16, 'sans-serif');
      const long = measureText(ctx, 'Hello World', 16, 'sans-serif');
      expect(long.width).toBeGreaterThan(short.width);
    });

    it('height scales with fontSize', () => {
      const ctx = getMockCtx();
      const small = measureText(ctx, 'Test', 12, 'sans-serif');
      const large = measureText(ctx, 'Test', 24, 'sans-serif');
      expect(large.height).toBeGreaterThan(small.height);
    });

    it('height increases with line count (multi-line)', () => {
      const ctx = getMockCtx();
      const single = measureText(ctx, 'One line', 16, 'sans-serif');
      const multi = measureText(ctx, 'Line one\nLine two\nLine three', 16, 'sans-serif');
      expect(multi.height).toBeGreaterThan(single.height);
      // 3 lines should be 3x the single line height
      expect(multi.height).toBeCloseTo(single.height * 3, 0);
    });

    it('empty text returns non-zero height', () => {
      const ctx = getMockCtx();
      const result = measureText(ctx, '', 16, 'sans-serif');
      expect(result.height).toBeGreaterThan(0);
      expect(result.width).toBeGreaterThanOrEqual(0);
    });

    it('different font sizes produce different measurements', () => {
      const ctx = getMockCtx();
      const a = measureText(ctx, 'Test', 10, 'sans-serif');
      const b = measureText(ctx, 'Test', 30, 'sans-serif');
      expect(b.width).toBeGreaterThan(a.width);
      expect(b.height).toBeGreaterThan(a.height);
    });
  });

  describe('hitTestText', () => {
    it('point inside text bounds', () => {
      const el = createText({ id: 't1', x: 10, y: 20, width: 100, height: 40 });
      expect(hitTestText(50, 35, el)).toBe(true);
    });

    it('point outside text bounds', () => {
      const el = createText({ id: 't2', x: 10, y: 20, width: 100, height: 40 });
      expect(hitTestText(200, 200, el)).toBe(false);
    });

    it('point on boundary', () => {
      const el = createText({ id: 't3', x: 10, y: 20, width: 100, height: 40 });
      expect(hitTestText(10, 20, el)).toBe(true);
      expect(hitTestText(110, 60, el)).toBe(true);
    });

    it('handles rotation', () => {
      const el = createText({
        id: 't4', x: 0, y: 0, width: 100, height: 100, rotation: Math.PI / 4,
      });
      // Center should still be inside
      expect(hitTestText(50, 50, el)).toBe(true);
    });
  });

  describe('getTextBounds', () => {
    it('returns correct bounds without rotation', () => {
      const el = createText({ id: 't5', x: 10, y: 20, width: 100, height: 50 });
      const bounds = getTextBounds(el);
      expect(bounds.minX).toBe(10);
      expect(bounds.minY).toBe(20);
      expect(bounds.maxX).toBe(110);
      expect(bounds.maxY).toBe(70);
    });

    it('returns expanded bounds with rotation', () => {
      const el = createText({
        id: 't6', x: 0, y: 0, width: 100, height: 50, rotation: Math.PI / 4,
      });
      const bounds = getTextBounds(el);
      // Rotated bounds should be larger than original
      expect(bounds.maxX - bounds.minX).toBeGreaterThan(100);
      expect(bounds.maxY - bounds.minY).toBeGreaterThan(50);
    });
  });
});
