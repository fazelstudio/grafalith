import { describe, expect, test } from 'bun:test';
import { buildVectorPdf, escapePdfText, parseCssColor, pdfFileName, type PdfTextMeasurer } from './exportPdf';
import type { DrawEntryDto, RenderModelDto } from '../../hooks/useEngine';

const RECT = { minX: 0, minY: 0, width: 200, height: 100, background: 'transparent' };
const measure: PdfTextMeasurer = () => 100;

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

function ascii(bytes: Uint8Array): string {
  return new TextDecoder('latin1').decode(bytes);
}

/** Every xref entry must land on the object header it claims. */
function expectSoundXref(text: string): void {
  const xrefAt = text.indexOf('xref\n');
  expect(xrefAt).toBeGreaterThan(-1);
  const size = Number.parseInt(text.slice(xrefAt).split('\n')[1].split(' ')[1], 10);
  const lines = text.slice(xrefAt).split('\n');
  for (let id = 1; id < size; id++) {
    const offset = Number.parseInt(lines[2 + id].slice(0, 10), 10);
    expect(text.slice(offset, offset + `${id} 0 obj`.length)).toBe(`${id} 0 obj`);
  }
}

describe('vector pdf export', () => {
  test('one page at 96dpi with a sound cross-reference table', () => {
    const pdf = buildVectorPdf(RECT, modelWith([]), measure);
    const text = ascii(pdf);
    expect(text.startsWith('%PDF-1.4\n')).toBe(true);
    expect(text).toContain('/MediaBox [0 0 150 75]');
    expect(text).toContain('/BaseFont /Helvetica');
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expectSoundXref(text);
  });

  test('rectangles map scene coords to y-up points with fill and stroke', () => {
    const text = ascii(buildVectorPdf(RECT, modelWith([rectEntry()]), measure));
    expect(text).toContain('7.5 22.5 75 37.5 re');
    expect(text).toContain('1 0 0 rg');
    expect(text).toContain('0 0 0 RG');
  });

  test('transparent paint emits path geometry without color operands', () => {
    const text = ascii(
      buildVectorPdf(
        RECT,
        modelWith([rectEntry({ paint: { type: 'solid', color: 'transparent' }, strokeColor: 'transparent' })]),
        measure,
      ),
    );
    expect(text).toContain('re');
    expect(text).not.toContain(' rg ');
    expect(text).not.toContain(' RG ');
  });

  test('rotation matches the canvas picture about the frame center', () => {
    const text = ascii(buildVectorPdf(RECT, modelWith([rectEntry({ rotation: Math.PI / 2 })]), measure));
    expect(text).toContain('0 -1 1 0 3.75 86.25 cm');
  });

  test('half opacity rides on a shared graphics state', () => {
    const text = ascii(buildVectorPdf(RECT, modelWith([rectEntry({ opacity: 50 })]), measure));
    expect(text).toContain('/GS0 gs');
    expect(text).toContain('/CA 0.50 /ca 0.50');
  });

  test('linear gradients become axial shading patterns', () => {
    const text = ascii(
      buildVectorPdf(
        RECT,
        modelWith([
          rectEntry({ paint: { type: 'linear', angle: 0, stops: [{ offset: 0, color: '#ff0000' }, { offset: 1, color: '#0000ff' }] } }),
        ]),
        measure,
      ),
    );
    expect(text).toContain('/ShadingType 2');
    expect(text).toContain('/Pattern cs /P0 scn');
    expect(text).toContain('/FunctionType 3');
    expectSoundXref(text);
  });

  test('text centers by measured width with escaped literals', () => {
    const entry = rectEntry({
      kind: 'text',
      detail: { type: 'text', text: 'a(b)', fontSize: 16, fontFamily: 'Arial', align: 'center', borderColor: null },
      strokeColor: '#111111',
    });
    const text = ascii(buildVectorPdf(RECT, modelWith([entry]), measure));
    expect(text).toContain('/F1 12 Tf');
    expect(text).toContain('(a\\(b\\)) Tj');
    // Center of frame scene x=60 -> 45pt, minus half the 75pt measured width.
    expect(text).toContain('7.5 ');
  });

  test('clipped frames wrap children in a clip path', () => {
    const frame = rectEntry({
      id: 'f1',
      kind: 'frame',
      bounds: { minX: 0, minY: 0, maxX: 50, maxY: 50 },
      frame: { minX: 0, minY: 0, maxX: 50, maxY: 50 },
      detail: { type: 'frame', name: 'Card', clipContent: true },
    });
    const child = rectEntry({ id: 'c1', bounds: { minX: 5, minY: 5, maxX: 20, maxY: 20 }, frame: { minX: 5, minY: 5, maxX: 20, maxY: 20 } });
    const model: RenderModelDto = { ...modelWith([]), frames: [{ frame, children: [child] }] };
    expect(ascii(buildVectorPdf(RECT, model, measure))).toContain('W n');
  });

  test('arrow markers follow the wire style, bare arrows stay plain', () => {
    const head = (detail: DrawEntryDto['detail']): string =>
      ascii(
        buildVectorPdf(
          RECT,
          modelWith([rectEntry({ kind: 'arrow', detail, points: [[0, 0], [100, 0]] })]),
          measure,
        ),
      );
    // Triangle head: closed filled path after the stroked polyline.
    expect(head({ type: 'arrow', start: null, end: 'arrow' })).toContain(' h ');
    // Bar head: a second stroked path instead of a fill.
    const bar = head({ type: 'arrow', start: null, end: 'bar' });
    expect(bar.match(/ S /g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    // Dot head: the only curves in the stream come from the disc.
    expect(head({ type: 'arrow', start: 'dot', end: null })).toContain(' c ');
    const bare = head({ type: 'arrow', start: null, end: null });
    expect(bare).not.toContain(' h ');
    expect(bare).not.toContain(' c ');
  });

  test('non-finite rects fail loudly instead of writing NaN operands', () => {
    expect(() => buildVectorPdf({ ...RECT, width: Number.NaN }, modelWith([]), measure)).toThrow();
  });

  test('color parsing covers normalized hex and rgb forms', () => {
    expect(parseCssColor('#ff0000')).toEqual({ r: 1, g: 0, b: 0, a: 1 });
    expect(parseCssColor('#f00')).toEqual({ r: 1, g: 0, b: 0, a: 1 });
    expect(parseCssColor('rgba(255, 0, 0, 0.5)')).toEqual({ r: 1, g: 0, b: 0, a: 0.5 });
    expect(parseCssColor('transparent')).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(parseCssColor('not-a-color')).toBeNull();
    expect(escapePdfText('a(b)\\')).toBe('a\\(b\\)\\\\');
  });

  test('file names stay filesystem-safe', () => {
    expect(pdfFileName('My Banner')).toBe('My Banner.pdf');
    expect(pdfFileName('a/b:c*d?e"f<g>h|i')).toBe('a-b-c-d-e-f-g-h-i.pdf');
    expect(pdfFileName('   ')).toBe('grafalith.pdf');
  });
});
