/**
 * Pure coordinate helpers for the canvas host.
 *
 * The mapping is `screen = (scene + scroll) * zoom` (engine contract,
 * shared with the TS oracle `render/viewport.ts`). Pointer ops take
 * **screen CSS px**; conversions for previews are pure host presentation
 * math — never document semantics.
 */

export interface ViewportState {
  scrollX: number;
  scrollY: number;
  zoom: number;
}

export type XY = [number, number];

/** Screen CSS px → scene units. */
export function screenToScene(point: XY, viewport: ViewportState): XY {
  return [
    point[0] / viewport.zoom - viewport.scrollX,
    point[1] / viewport.zoom - viewport.scrollY,
  ];
}

/** Scene units → screen CSS px. */
export function sceneToScreen(point: XY, viewport: ViewportState): XY {
  return [
    (point[0] + viewport.scrollX) * viewport.zoom,
    (point[1] + viewport.scrollY) * viewport.zoom,
  ];
}

/** Normalize two scene corners to a top-left + size box. */
export function normalizeBox(a: XY, b: XY): { x: number; y: number; width: number; height: number } {
  return {
    x: Math.min(a[0], b[0]),
    y: Math.min(a[1], b[1]),
    width: Math.abs(b[0] - a[0]),
    height: Math.abs(b[1] - a[1]),
  };
}
