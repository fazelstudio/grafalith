import { describe, expect, test } from 'bun:test';
import type { RenderModelDto } from '../../hooks/useEngine';
import { buildNavigatorEntries, contentBounds } from './navigator';

function entry(
  id: string,
  kind = 'rectangle',
  detail: Record<string, unknown> = { type: 'none' },
): RenderModelDto['base'][number] {
  return {
    id,
    kind,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    rotation: 0,
    paint: { type: 'solid', color: '#fff' },
    strokeColor: '#000',
    strokeWidth: 1,
    strokeStyle: 'solid',
    opacity: 100,
    detail: detail as never,
  };
}

function model(): RenderModelDto {
  return {
    base: [entry('a'), entry('b')],
    frames: [
      {
        frame: { ...entry('frame-1', 'frame', { type: 'frame', name: 'Header', clipContent: true }), bounds: { minX: 0, minY: 0, maxX: 50, maxY: 50 } },
        children: [entry('child-1', 'text', { type: 'text', text: 'Hello\nworld', fontSize: 12, fontFamily: 'sans' })],
      },
    ],
    selection: null,
    snapGuides: [],
    textEditing: null,
    viewport: { scrollX: 0, scrollY: 0, zoom: 1 },
    assetGeneration: 0,
  };
}

describe('buildNavigatorEntries', () => {
  test('lists topmost entries first with frame children nested', () => {
    const entries = buildNavigatorEntries(model(), []);
    expect(entries.map((row) => row.id)).toEqual(['b', 'a', 'frame-1', 'child-1']);
    expect(entries.map((row) => row.depth)).toEqual([0, 0, 0, 1]);
  });

  test('mirrors the engine selection for highlighting', () => {
    const entries = buildNavigatorEntries(model(), ['a', 'child-1']);
    expect(entries.find((row) => row.id === 'a')?.selected).toBe(true);
    expect(entries.find((row) => row.id === 'b')?.selected).toBe(false);
    expect(entries.find((row) => row.id === 'child-1')?.selected).toBe(true);
  });

  test('prefers frame names and text content over the raw kind', () => {
    const entries = buildNavigatorEntries(model(), []);
    expect(entries.find((row) => row.id === 'frame-1')?.name).toBe('Header');
    expect(entries.find((row) => row.id === 'child-1')?.name).toBe('Hello');
    expect(entries.find((row) => row.id === 'a')?.name).toBe('');
  });
});

describe('contentBounds', () => {
  test('returns null for an empty model', () => {
    const empty: RenderModelDto = { ...model(), base: [], frames: [] };
    expect(contentBounds(empty)).toBeNull();
  });

  test('covers base entries and frame children', () => {
    expect(contentBounds(model())).toEqual({ minX: 0, minY: 0, maxX: 50, maxY: 50 });
  });
});
