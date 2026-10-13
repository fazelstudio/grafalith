import { createRegistry, type Descriptor } from '../../registries/core';
import type { CanvasUnit, ProjectCanvas, ProjectKind } from '../../platform/projects/types';

/** Scene units per display unit at 96 DPI (CorelDRAW-style unit set). */
const UNIT_TO_SCENE: Record<CanvasUnit, number> = {
  px: 1,
  in: 96,
  pt: 96 / 72,
  mm: 96 / 25.4,
  cm: 96 / 2.54,
  m: (96 / 25.4) * 1000,
};

/** Display units offered by the canvas size inputs, largest first. */
export const CANVAS_UNITS: readonly CanvasUnit[] = ['px', 'mm', 'cm', 'm', 'in', 'pt'];

/** Convert a display value to scene units (px at 96 DPI). */
export function toSceneUnits(value: number, unit: CanvasUnit): number {
  return value * UNIT_TO_SCENE[unit];
}

/** Convert scene units back to a display value (rounded to 2 decimals). */
export function fromSceneUnits(value: number, unit: CanvasUnit): number {
  return Math.round((value / UNIT_TO_SCENE[unit]) * 100) / 100;
}

/** One fixed-canvas starting point (the infinite workboard needs no preset). */
export interface CanvasPresetDefinition extends Descriptor {
  /** Page width in the preset's own unit. */
  width: number;
  /** Page height in the preset's own unit. */
  height: number;
  /** Unit the preset dimensions are expressed in. */
  unit: CanvasUnit;
}

// Single source for fixed-canvas starting points: slides, paper, and
// social sizes share this list instead of hardcoding dimensions in the
// create dialog, so adding a size means adding one entry here plus its
// locale strings.
const PRESETS: readonly CanvasPresetDefinition[] = [
  {
    id: 'slide-16x9',
    labelKey: 'projects.canvas.presets.slide169',
    defaultLabel: 'Slide 16:9',
    width: 1920,
    height: 1080,
    unit: 'px',
  },
  {
    id: 'slide-4x3',
    labelKey: 'projects.canvas.presets.slide43',
    defaultLabel: 'Slide 4:3',
    width: 1024,
    height: 768,
    unit: 'px',
  },
  {
    id: 'slide-1610',
    labelKey: 'projects.canvas.presets.slide1610',
    defaultLabel: 'Slide 16:10',
    width: 1920,
    height: 1200,
    unit: 'px',
  },
  {
    id: 'square-1080',
    labelKey: 'projects.canvas.presets.square1080',
    defaultLabel: 'Square 1080',
    width: 1080,
    height: 1080,
    unit: 'px',
  },
  {
    id: 'a4',
    labelKey: 'projects.canvas.presets.a4',
    defaultLabel: 'A4',
    width: 210,
    height: 297,
    unit: 'mm',
  },
  {
    id: 'a3',
    labelKey: 'projects.canvas.presets.a3',
    defaultLabel: 'A3',
    width: 297,
    height: 420,
    unit: 'mm',
  },
  {
    id: 'folio',
    labelKey: 'projects.canvas.presets.folio',
    defaultLabel: 'Folio / HVS',
    width: 215,
    height: 330,
    unit: 'mm',
  },
];

/** Validated lookup over fixed-canvas presets in creation-menu order. */
export const canvasPresetRegistry = createRegistry<CanvasPresetDefinition>('canvasPreset', PRESETS, {
  validateItem: (preset) => {
    if (!(preset.width > 0) || !(preset.height > 0)) {
      return `non-positive dimensions for id "${preset.id}"`;
    }
    return undefined;
  },
});

/** Default canvas per editor family (whiteboard is always infinite). */
export function defaultCanvasForKind(kind: ProjectKind): ProjectCanvas {
  if (kind === 'slides') {
    const preset = canvasPresetRegistry.get('slide-16x9') ?? canvasPresetRegistry.all()[0];
    return {
      mode: 'fixed',
      width: toSceneUnits(preset.width, preset.unit),
      height: toSceneUnits(preset.height, preset.unit),
      unit: preset.unit,
    };
  }
  return { mode: 'infinite', width: 0, height: 0, unit: 'px' };
}

/** Portrait preset dimensions, or swapped dimensions for landscape. */
export function presetDimensions(
  preset: CanvasPresetDefinition,
  orientation: 'portrait' | 'landscape',
): { width: number; height: number } {
  if (orientation === 'landscape' && preset.width < preset.height) {
    return { width: preset.height, height: preset.width };
  }
  if (orientation === 'portrait' && preset.width > preset.height) {
    return { width: preset.height, height: preset.width };
  }
  return { width: preset.width, height: preset.height };
}

/** Landscape swaps width and height; portrait keeps the given order. */
export function applyOrientation(
  width: number,
  height: number,
  orientation: 'portrait' | 'landscape',
): { width: number; height: number } {
  if (orientation === 'landscape' && width < height) return { width: height, height: width };
  if (orientation === 'portrait' && width > height) return { width: height, height: width };
  return { width, height };
}
