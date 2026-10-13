import { describe, expect, test } from 'bun:test';
import {
  applyOrientation,
  CANVAS_UNITS,
  canvasPresetRegistry,
  defaultCanvasForKind,
  fromSceneUnits,
  presetDimensions,
  toSceneUnits,
} from './canvasPresets';
import { normalizeProjectCanvas } from '../../platform/projects/types';

describe('canvas presets', () => {
  test('registry lists presets in creation-menu order', () => {
    expect(canvasPresetRegistry.all().map((preset) => preset.id)).toEqual([
      'slide-16x9',
      'slide-4x3',
      'slide-1610',
      'square-1080',
      'a4',
      'a3',
      'folio',
    ]);
  });

  test('units convert through scene units and back', () => {
    for (const unit of CANVAS_UNITS) {
      expect(fromSceneUnits(toSceneUnits(100, unit), unit)).toBeCloseTo(100, 9);
    }
    expect(toSceneUnits(1, 'in')).toBe(96);
    expect(toSceneUnits(25.4, 'mm')).toBeCloseTo(96, 9);
    expect(toSceneUnits(2.54, 'cm')).toBeCloseTo(96, 9);
    expect(toSceneUnits(72, 'pt')).toBeCloseTo(96, 9);
  });

  test('orientation swaps only when needed', () => {
    expect(applyOrientation(210, 297, 'portrait')).toEqual({ width: 210, height: 297 });
    expect(applyOrientation(210, 297, 'landscape')).toEqual({ width: 297, height: 210 });
    expect(applyOrientation(297, 210, 'landscape')).toEqual({ width: 297, height: 210 });
    const a4 = canvasPresetRegistry.get('a4')!;
    expect(presetDimensions(a4, 'portrait')).toEqual({ width: 210, height: 297 });
    expect(presetDimensions(a4, 'landscape')).toEqual({ width: 297, height: 210 });
  });

  test('defaults follow the editor family', () => {
    expect(defaultCanvasForKind('design')).toEqual({ mode: 'infinite', width: 0, height: 0, unit: 'px' });
    expect(defaultCanvasForKind('whiteboard')).toEqual({ mode: 'infinite', width: 0, height: 0, unit: 'px' });
    const slides = defaultCanvasForKind('slides');
    expect(slides.mode).toBe('fixed');
    expect(slides.width).toBe(1920);
    expect(slides.height).toBe(1080);
    expect(slides.unit).toBe('px');
  });

  test('stored canvas normalizes to infinite on any invalid shape', () => {
    const infinite = { mode: 'infinite', width: 0, height: 0, unit: 'px' };
    expect(normalizeProjectCanvas(undefined)).toEqual(infinite);
    expect(normalizeProjectCanvas(null)).toEqual(infinite);
    expect(normalizeProjectCanvas({ mode: 'fixed', width: 0, height: 10, unit: 'px' })).toEqual(infinite);
    expect(normalizeProjectCanvas({ mode: 'fixed', width: 10, height: -1, unit: 'px' })).toEqual(infinite);
    expect(normalizeProjectCanvas({ mode: 'round', width: 10, height: 10, unit: 'px' })).toEqual(infinite);
    expect(
      normalizeProjectCanvas({ mode: 'fixed', width: 100, height: 50, unit: 'furlong' }),
    ).toEqual({ mode: 'fixed', width: 100, height: 50, unit: 'px' });
    expect(normalizeProjectCanvas({ mode: 'fixed', width: 100, height: 50, unit: 'mm' })).toEqual({
      mode: 'fixed',
      width: 100,
      height: 50,
      unit: 'mm',
    });
  });
});
