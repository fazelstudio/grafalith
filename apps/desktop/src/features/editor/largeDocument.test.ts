import { describe, expect, test } from 'bun:test';
import type { DrawEntryDto, RenderModelDto } from '../../hooks/useEngine';
import { buildNavigatorEntries, contentBounds, selectionBounds } from './navigator';
import { normalizeSelection } from './selection';

function makeEntry(id: string, index: number): DrawEntryDto {
  return {
    id,
    kind: 'rectangle',
    bounds: { minX: index * 12, minY: index * 8, maxX: index * 12 + 10, maxY: index * 8 + 10 },
    rotation: 0,
    paint: { type: 'solid', color: '#ffffff' },
    strokeColor: '#000000',
    strokeWidth: 1,
    strokeStyle: 'solid',
    opacity: 100,
    detail: { type: 'none' },
  };
}

/** Realistic 5,000-entry scene: flat entries plus framed passes. */
function largeModel(): RenderModelDto {
  const base: DrawEntryDto[] = [];
  for (let i = 0; i < 3900; i++) base.push(makeEntry(`base-${i}`, i));
  const frames = [];
  for (let f = 0; f < 100; f++) {
    const children: DrawEntryDto[] = [];
    for (let c = 0; c < 10; c++) children.push(makeEntry(`frame-${f}-child-${c}`, 3900 + f * 10 + c));
    frames.push({ frame: makeEntry(`frame-${f}`, 3900 + f), children });
  }
  return {
    base,
    frames,
    selection: null,
    snapGuides: [],
    textEditing: null,
    viewport: { scrollX: 0, scrollY: 0, zoom: 1 },
    assetGeneration: 0,
  };
}

function budget(label: string, ms: number, limitMs: number): void {
  console.log(`[large-document] ${label}: ${ms.toFixed(1)}ms (budget ${limitMs}ms)`);
  expect(ms).toBeLessThan(limitMs);
}

describe('large document behavior', () => {
  test('navigator, selection, and bounds stay interactive at 5,000 entries', () => {
    const model = largeModel();

    let start = performance.now();
    const entries = buildNavigatorEntries(model, []);
    budget('navigator rows', performance.now() - start, 750);

    expect(entries.length).toBe(5000);
    // Paint order: flat entries topmost-first, then framed passes.
    expect(entries[0].id).toBe('base-3899');
    expect(entries[entries.length - 1].id).toBe('frame-0-child-0');

    const ids = entries.map((entry) => entry.id);
    const ghosts = Array.from({ length: 100 }, (_, i) => `ghost-${i}`);
    start = performance.now();
    const normalized = normalizeSelection([...ids, ...ghosts], new Set(ids));
    budget('selection normalization', performance.now() - start, 750);
    expect(normalized.length).toBe(5000);

    start = performance.now();
    const bounds = contentBounds(model);
    budget('content bounds', performance.now() - start, 750);
    expect(bounds).not.toBeNull();

    start = performance.now();
    const selected = selectionBounds(model, ids.slice(0, 2500));
    budget('selection bounds', performance.now() - start, 750);
    expect(selected).not.toBeNull();
    expect(selectionBounds(model, [])).toBeNull();
    expect(selectionBounds(model, ghosts)).toBeNull();
  });
});
