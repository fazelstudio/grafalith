import { describe, expect, test } from 'bun:test';
import { buildSvgString, svgFileName } from './exportSvg';
import type { DrawEntryDto, RenderModelDto } from '../../hooks/useEngine';
import type { PngExportRect } from './exportPng';

const RECT: PngExportRect = { minX: 0, minY: 0, width: 200, height: 100, scale: 2, background: 'transparent' };

function rectEntry(overrides: Partial<DrawEntryDto> = {}): DrawEntryDto {
  return {
    id: 'r1',
    locked: false,
    effectiveLocked: false,
    label: '',
    groupIds: [],
    kind: 'rectangle',
    bounds: { minX: 10, minY: 20, maxX: 110, maxY: 70 },
    frame: { minX: 10, minY: 20, maxX: 110, maxY: 70 },
    rotation: 0,
    paint: { type: 'solid', color: '#ff0000' },
    strokeColor: '#000000',
    strokeWidth: 2,
    strokeStyle: 'solid',
    opacity: 100,
    detail: { type: 'none' },
    ...overrides,
  };
}

function modelWith(entries: DrawEntryDto[]): RenderModelDto {
  return {
    base: entries,
    frames: [],
    selection: null,
    snapGuides: [],
    textEditing: null,
    viewport: { scrollX: 0, scrollY: 0, zoom: 1 },
    assetGeneration: 0,
    groups: [],
    labels: [],
    elementOrder: entries.map((entry) => entry.id),
  };
}

describe('svg export', () => {
  test('root carries size and viewBox for the export rect', () => {
    const svg = buildSvgString(RECT, modelWith([]));
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain('width="200"');
    expect(svg).toContain('viewBox="0 0 200 100"');
    expect(svg.endsWith('</svg>')).toBe(true);
  });

  test('rectangles paint from the unrotated frame with fill and stroke', () => {
    const svg = buildSvgString(RECT, modelWith([rectEntry()]));
    expect(svg).toContain('<rect x="10" y="20" width="100" height="50" fill="#ff0000"');
    expect(svg).toContain('stroke="#000000" stroke-width="2"');
  });

  test('transparent fills and strokes export as none', () => {
    const svg = buildSvgString(
      RECT,
      modelWith([rectEntry({ paint: { type: 'solid', color: 'transparent' }, strokeColor: 'transparent' })]),
    );
    expect(svg).toContain('fill="none" stroke="none"');
  });

  test('dashed strokes carry the canvas dash parity', () => {
    const svg = buildSvgString(RECT, modelWith([rectEntry({ strokeStyle: 'dashed', strokeWidth: 2 })]));
    expect(svg).toContain('stroke-dasharray="6 4"');
  });

  test('rotation wraps the shape in degrees about the frame center', () => {
    const svg = buildSvgString(RECT, modelWith([rectEntry({ rotation: Math.PI / 2 })]));
    expect(svg).toContain('<g transform="rotate(90 60 45)">');
  });

  test('linear gradients resolve to user-space defs mirroring the canvas geometry', () => {
    const svg = buildSvgString(
      RECT,
      modelWith([
        rectEntry({ paint: { type: 'linear', angle: 0, stops: [{ offset: 0, color: '#ff0000' }, { offset: 1, color: '#0000ff' }] } }),
      ]),
    );
    expect(svg).toContain('<defs><linearGradient');
    expect(svg).toContain('fill="url(#grad-r1-0)"');
    expect(svg).toContain('<stop offset="0%" stop-color="#ff0000"/>');
    expect(svg).toContain('<stop offset="100%" stop-color="#0000ff"/>');
  });

  test('text escapes markup and keeps one tspan per line', () => {
    const svg = buildSvgString(
      RECT,
      modelWith([
        rectEntry({
          kind: 'text',
          detail: { type: 'text', text: 'a<b>\nc&d', fontSize: 16, fontFamily: 'Arial', align: 'left', borderColor: null },
          strokeColor: '#111111',
        }),
      ]),
    );
    expect(svg).toContain('a&lt;b&gt;');
    expect(svg).toContain('c&amp;d');
    expect(svg).toContain('<tspan x="10" dy="0">a&lt;b&gt;</tspan><tspan x="10" dy="20">c&amp;d</tspan>');
  });

  test('arrows append head polygons for the flagged ends', () => {
    const svg = buildSvgString(
      RECT,
      modelWith([
        rectEntry({
          kind: 'arrow',
          detail: { type: 'arrow', start: null, end: 'arrow' },
          points: [[0, 0], [100, 0]],
        }),
      ]),
    );
    expect(svg).toContain('<polyline points="0,0 100,0"');
    expect(svg).toContain('<polygon points="100,0');
  });

  test('bar and dot markers export their own shapes', () => {
    const bar = buildSvgString(
      RECT,
      modelWith([rectEntry({ kind: 'arrow', detail: { type: 'arrow', start: null, end: 'bar' }, points: [[0, 0], [100, 0]] })]),
    );
    expect(bar).toContain('<line ');
    expect(bar).not.toContain('<polygon');
    const dot = buildSvgString(
      RECT,
      modelWith([rectEntry({ kind: 'arrow', detail: { type: 'arrow', start: 'dot', end: null }, points: [[0, 0], [100, 0]] })]),
    );
    expect(dot).toContain('<circle ');
    expect(dot).not.toContain('<polygon');
  });

  test('bare arrows stay plain strokes like lines', () => {
    const svg = buildSvgString(
      RECT,
      modelWith([rectEntry({ kind: 'arrow', detail: { type: 'arrow', start: null, end: null }, points: [[0, 0], [100, 0]] })]),
    );
    expect(svg).toContain('<polyline ');
    expect(svg).not.toContain('<polygon');
    expect(svg).not.toContain('<circle ');
  });

  test('clipped frames wrap children in a clip-path group', () => {
    const frame = rectEntry({
      id: 'f1',
      kind: 'frame',
      bounds: { minX: 0, minY: 0, maxX: 50, maxY: 50 },
      frame: { minX: 0, minY: 0, maxX: 50, maxY: 50 },
      detail: { type: 'frame', name: 'Card', clipContent: true },
    });
    const child = rectEntry({ id: 'c1', bounds: { minX: 5, minY: 5, maxX: 20, maxY: 20 }, frame: { minX: 5, minY: 5, maxX: 20, maxY: 20 } });
    const model: RenderModelDto = { ...modelWith([]), frames: [{ frame, children: [child] }] };
    const svg = buildSvgString(RECT, model);
    expect(svg).toContain('<clipPath id="clip-f1-0">');
    expect(svg).toContain('clip-path="url(#clip-f1-0)"');
  });

  test('opaque backgrounds paint a base rect first', () => {
    const svg = buildSvgString({ ...RECT, background: '#ffffff' }, modelWith([rectEntry()]));
    expect(svg.indexOf('fill="#ffffff"')).toBeLessThan(svg.indexOf('fill="#ff0000"'));
  });

  test('file names stay filesystem-safe', () => {
    expect(svgFileName('My Banner')).toBe('My Banner.svg');
    expect(svgFileName('a/b:c*d?e"f<g>h|i')).toBe('a-b-c-d-e-f-g-h-i.svg');
    expect(svgFileName('   ')).toBe('grafalith.svg');
  });
});
