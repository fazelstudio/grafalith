import { describe, expect, test } from 'bun:test';
import { drawRenderModel, NO_PREVIEW } from './drawModel';
import type { DrawEntryDto, RenderModelDto } from '../hooks/useEngine';

/** Records canvas calls so committed paint is assertable without a DOM. */
function mockContext(): { ctx: CanvasRenderingContext2D; calls: string[] } {
  const calls: string[] = [];
  const ctx = new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (prop === 'canvas') return { parentElement: null };
        return (..._args: unknown[]) => {
          calls.push(String(prop));
        };
      },
      set: () => true,
    },
  ) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

function arrowEntry(detail: DrawEntryDto['detail'], kind = 'arrow'): DrawEntryDto {
  return {
    id: 'a1',
    locked: false,
    effectiveLocked: false,
    label: '',
    groupIds: [],
    kind,
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 0 },
    frame: { minX: 0, minY: 0, maxX: 100, maxY: 0 },
    rotation: 0,
    paint: { type: 'solid', color: 'transparent' },
    strokeColor: '#000000',
    strokeWidth: 2,
    strokeStyle: 'solid',
    opacity: 100,
    detail,
    points: [[0, 0], [100, 0]],
  };
}

function modelWith(entry: DrawEntryDto): RenderModelDto {
  return {
    base: [entry],
    frames: [],
    selection: null,
    snapGuides: [],
    textEditing: null,
    viewport: { scrollX: 0, scrollY: 0, zoom: 1 },
    assetGeneration: 0,
    groups: [],
    labels: [],
    elementOrder: [entry.id],
  };
}

describe('committed arrowheads', () => {
  test('a wire-shaped end marker paints a filled head', () => {
    const { ctx, calls } = mockContext();
    drawRenderModel(ctx, modelWith(arrowEntry({ type: 'arrow', start: null, end: 'arrow' })), 200, 100, NO_PREVIEW, null, null, false);
    // The stroke-only polyline never fills; the single fill is the head triangle.
    expect(calls.filter((call) => call === 'fill').length).toBe(1);
  });

  test('a plain line paints no head', () => {
    const { ctx, calls } = mockContext();
    drawRenderModel(ctx, modelWith(arrowEntry({ type: 'none' }, 'line')), 200, 100, NO_PREVIEW, null, null, false);
    expect(calls).not.toContain('fill');
  });

  test('a bare arrow paints no head', () => {
    const { ctx, calls } = mockContext();
    drawRenderModel(ctx, modelWith(arrowEntry({ type: 'arrow', start: null, end: null })), 200, 100, NO_PREVIEW, null, null, false);
    expect(calls).not.toContain('fill');
  });

  test('bar markers stroke a tick, dot markers fill a disc', () => {
    const bar = mockContext();
    drawRenderModel(bar.ctx, modelWith(arrowEntry({ type: 'arrow', start: null, end: 'bar' })), 200, 100, NO_PREVIEW, null, null, false);
    // Polyline stroke plus the bar tick stroke, no fill anywhere.
    expect(bar.calls.filter((call) => call === 'stroke').length).toBe(2);
    expect(bar.calls).not.toContain('fill');
    const dot = mockContext();
    drawRenderModel(dot.ctx, modelWith(arrowEntry({ type: 'arrow', start: 'dot', end: null })), 200, 100, NO_PREVIEW, null, null, false);
    expect(dot.calls).toContain('arc');
    expect(dot.calls).toContain('fill');
  });
});
