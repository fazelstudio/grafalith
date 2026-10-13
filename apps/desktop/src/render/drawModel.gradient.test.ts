import { describe, expect, test } from 'bun:test';
import { gradientGeometry } from './drawModel';

describe('gradientGeometry', () => {
  test('linear endpoints center on the frame, not the scene origin', () => {
    const frame = { minX: 500, minY: 400, maxX: 600, maxY: 450 };
    const got = gradientGeometry(frame, 0);
    expect(got.cx).toBe(550);
    expect(got.cy).toBe(425);
    // 0° runs left-to-right across max(w,h)/2 = 50 each way.
    expect(got.x0).toBe(500);
    expect(got.x1).toBe(600);
    expect(got.y0).toBe(425);
    expect(got.y1).toBe(425);
    expect(got.radius).toBe(50);
  });

  test('90° runs vertically and radial shares the same center', () => {
    const frame = { minX: 0, minY: 0, maxX: 100, maxY: 60 };
    const got = gradientGeometry(frame, 90);
    expect(got.x0).toBeCloseTo(50, 9);
    expect(got.x1).toBeCloseTo(50, 9);
    expect(got.y0).toBeCloseTo(-20, 9);
    expect(got.y1).toBeCloseTo(80, 9);
  });

  test('non-finite angles fall back to 0° instead of NaN', () => {
    const frame = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
    for (const angle of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const got = gradientGeometry(frame, angle);
      expect(got.x0).toBe(0);
      expect(got.x1).toBe(100);
      expect(got.y0).toBe(50);
      expect(got.y1).toBe(50);
    }
  });
});
