import { describe, expect, test } from 'bun:test';
import { normalizeBox, sceneToScreen, screenToScene } from './coords';

describe('screen/scene conversion (engine contract)', () => {
  test('identity viewport is a no-op', () => {
    const vp = { scrollX: 0, scrollY: 0, zoom: 1 };
    expect(screenToScene([10, 20], vp)).toEqual([10, 20]);
    expect(sceneToScreen([10, 20], vp)).toEqual([10, 20]);
  });

  test('round-trips through scroll and zoom', () => {
    const vp = { scrollX: 100, scrollY: -50, zoom: 2 };
    const scene: [number, number] = [10, 20];
    const screen = sceneToScreen(scene, vp);
    expect(screen).toEqual([220, -60]);
    const back = screenToScene(screen, vp);
    expect(Math.abs(back[0] - scene[0])).toBeLessThan(1e-12);
    expect(Math.abs(back[1] - scene[1])).toBeLessThan(1e-12);
  });

  test('zoom scales the canvas span', () => {
    const vp = { scrollX: 0, scrollY: 0, zoom: 2 };
    // An 800px canvas shows 400 scene units at 2x.
    const size = screenToScene([800, 600], vp);
    expect(size[0]).toBeCloseTo(400, 12);
    expect(size[1]).toBeCloseTo(300, 12);
  });
});

describe('normalizeBox', () => {
  test('orders corners regardless of drag direction', () => {
    expect(normalizeBox([100, 100], [0, 50])).toEqual({ x: 0, y: 50, width: 100, height: 50 });
    expect(normalizeBox([0, 50], [100, 100])).toEqual({ x: 0, y: 50, width: 100, height: 50 });
  });
});
