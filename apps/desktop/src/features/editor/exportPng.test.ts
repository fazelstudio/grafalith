import { describe, expect, test } from 'bun:test';
import { planExportRect, pngFileName, queryExportModel, PNG_EXPORT_SCALE } from './exportPng';
import type { Engine } from '../../hooks/useEngine';

/** Engine stub answering one canned batch result per op. */
function stubEngine(plans: Record<string, unknown>): Engine {
  return {
    sendBatch: async (ops: unknown[]) => {
      const results = (ops as { op: string }[]).map((op) => ({
        op: op.op,
        ok: true,
        data: plans[op.op] ?? null,
      }));
      return JSON.stringify({ version: 1, applied: results.length, results });
    },
  } as unknown as Engine;
}

describe('png export planning', () => {
  test('fixed canvas exports the exact page without engine math', async () => {
    let calls = 0;
    const engine = stubEngine({});
    engine.sendBatch = async () => {
      calls += 1;
      return JSON.stringify({ version: 1, applied: 0, results: [] });
    };
    const rect = await planExportRect(engine, { mode: 'fixed', width: 1920, height: 1080, unit: 'px' });
    expect(rect).toEqual({ minX: 0, minY: 0, width: 1920, height: 1080, scale: PNG_EXPORT_SCALE, background: 'transparent' });
    expect(calls).toBe(0);
  });

  test('huge fixed pages clamp the scale to the pixel budget', async () => {
    const engine = stubEngine({});
    const rect = await planExportRect(engine, { mode: 'fixed', width: 11338, height: 3779, unit: 'mm' });
    expect(rect.scale).toBeLessThanOrEqual(PNG_EXPORT_SCALE);
    expect(Math.round(rect.width * rect.scale)).toBeLessThanOrEqual(4096);
    expect(Math.round(rect.height * rect.scale)).toBeLessThanOrEqual(4096);
  });

  test('infinite canvas follows the engine content plan', async () => {
    const engine = stubEngine({
      planPngExport: {
        contentBounds: { minX: 10, minY: 20, maxX: 310, maxY: 220 },
        canvasWidthPx: 680,
        canvasHeightPx: 480,
        effectiveScale: 2,
        background: 'transparent',
        padding: 20,
      },
    });
    const rect = await planExportRect(engine, { mode: 'infinite', width: 0, height: 0, unit: 'px' });
    expect(rect).toEqual({ minX: 10, minY: 20, width: 340, height: 240, scale: 2, background: 'transparent' });
  });

  test('missing plan data fails loudly', async () => {
    const engine = stubEngine({});
    await expect(planExportRect(engine, { mode: 'infinite', width: 0, height: 0, unit: 'px' })).rejects.toThrow();
  });

  test('export model queries carry the one-shot viewport override', async () => {
    let seen: unknown[] = [];
    const engine = stubEngine({
      renderModel: { base: [], frames: [], selection: null, viewport: { scrollX: 0, scrollY: 0, zoom: 1 } },
    });
    const rawSend = engine.sendBatch;
    engine.sendBatch = async (ops: unknown[]) => {
      seen = ops as unknown[];
      return rawSend(ops);
    };
    await queryExportModel(engine, { minX: 10, minY: 20, width: 100, height: 50, scale: 2, background: 'transparent' });
    const query = (seen[0] as Record<string, unknown>)['viewport'] as Record<string, number>;
    expect(query).toEqual({ scrollX: -10, scrollY: -20, zoom: 2 });
  });

  test('file names stay filesystem-safe', () => {
    expect(pngFileName('My Banner')).toBe('My Banner.png');
    expect(pngFileName('a/b:c*d?e"f<g>h|i')).toBe('a-b-c-d-e-f-g-h-i.png');
    expect(pngFileName('   ')).toBe('grafalith.png');
  });
});
