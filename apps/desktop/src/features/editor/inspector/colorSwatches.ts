import type { PaintDto } from '../../../hooks/useEngine';

/** One gradient stop in editor space (offset 0–1). */
export interface GradientStopValue {
  offset: number;
  color: string;
}

/** Gradient fill in editor space; the wire shape adds the `type` tag. */
export interface GradientFillValue {
  type: 'gradient';
  gradientType: 'linear' | 'radial';
  angle: number;
  stops: GradientStopValue[];
}

/** Fill committed through the inspector: a color string or a gradient. */
export type FillValue = string | GradientFillValue;

/** Built-in swatch seeds; the recent list never grows past this length. */
export const COLOR_TEMPLATES: readonly string[] = [
  '#000000',
  '#ffffff',
  '#64748b',
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#3b82f6',
];

const RECENTS_PREFIX = 'grafalith:color-recents:';
const MAX_STOPS = 5;

/** Structural check for gradient objects arriving from storage or UI. */
export function isGradientFill(value: unknown): value is GradientFillValue {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record['type'] !== 'gradient') return false;
  if (record['gradientType'] !== 'linear' && record['gradientType'] !== 'radial') return false;
  if (typeof record['angle'] !== 'number' || !Number.isFinite(record['angle'])) return false;
  if (!Array.isArray(record['stops']) || record['stops'].length === 0) return false;
  return (record['stops'] as unknown[]).every(
    (stop) =>
      typeof stop === 'object' &&
      stop !== null &&
      typeof (stop as Record<string, unknown>)['offset'] === 'number' &&
      typeof (stop as Record<string, unknown>)['color'] === 'string',
  );
}

/** Lowercase `#rrggbb` for valid hex input, otherwise null. */
export function normalizeHexColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const hex = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(hex)) return hex;
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(hex);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  return null;
}

/** HSV color: hue 0–360, saturation/value 0–100. */
export interface HsvColor {
  /** Hue in degrees. */
  h: number;
  /** Saturation in percent. */
  s: number;
  /** Value (brightness) in percent. */
  v: number;
}

/**
 * Parses `#rrggbb` to HSV; invalid input yields black. Powers stop-dot
 * dragging on the hue bar, which keeps a stop's saturation/value while its
 * hue follows the pointer.
 */
export function hexToHsv(hex: string): HsvColor {
  const normalized = normalizeHexColor(hex) ?? '#000000';
  const r = parseInt(normalized.slice(1, 3), 16) / 255;
  const g = parseInt(normalized.slice(3, 5), 16) / 255;
  const b = parseInt(normalized.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const v = max * 100;
  const s = max === 0 ? 0 : (delta / max) * 100;
  let h = 0;
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s, v };
}

/** Formats HSV (hue wrapped, saturation/value clamped) to `#rrggbb`. */
export function hsvToHex(h: number, s: number, v: number): string {
  const hue = ((h % 360) + 360) % 360;
  const sat = Math.min(100, Math.max(0, s)) / 100;
  const val = Math.min(100, Math.max(0, v)) / 100;
  const c = val * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = val - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hue < 60) {
    r = c;
    g = x;
  } else if (hue < 120) {
    r = x;
    g = c;
  } else if (hue < 180) {
    g = c;
    b = x;
  } else if (hue < 240) {
    g = x;
    b = c;
  } else if (hue < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  const toHex = (channel: number): string =>
    Math.round((channel + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function normalizeStop(stop: GradientStopValue): GradientStopValue {
  const offset = Number.isFinite(stop.offset) ? Math.min(1, Math.max(0, stop.offset)) : 0;
  return { offset, color: typeof stop.color === 'string' && stop.color !== '' ? stop.color : '#000000' };
}

function clampStops(stops: readonly GradientStopValue[]): GradientStopValue[] {
  return stops
    .map(normalizeStop)
    .sort((a, b) => a.offset - b.offset)
    .slice(0, MAX_STOPS);
}

/**
 * Stop offset for a pointer over the gradient bar: fraction across the bar
 * clamped to 0–1 at two decimals. Pure for testing; the bar feeds it
 * clientX and its bounding rect.
 */
export function stopOffsetAt(clientX: number, rectLeft: number, rectWidth: number): number {
  if (!Number.isFinite(clientX) || !Number.isFinite(rectLeft) || !Number.isFinite(rectWidth) || rectWidth <= 0) {
    return 0;
  }
  return Math.round(Math.min(1, Math.max(0, (clientX - rectLeft) / rectWidth)) * 100) / 100;
}

/** Structural equality ignoring hex case so repeats never fill the recents. */
export function fillEquals(a: FillValue, b: FillValue): boolean {
  if (typeof a === 'string' || typeof b === 'string') {
    return typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
  }
  return (
    a.gradientType === b.gradientType &&
    a.angle === b.angle &&
    a.stops.length === b.stops.length &&
    a.stops.every(
      (stop, index) =>
        stop.offset === b.stops[index].offset &&
        stop.color.toLowerCase() === b.stops[index].color.toLowerCase(),
    )
  );
}

/** Render-model paint to an editable fill; degenerate gradients fall back to black. */
export function paintToFill(paint: PaintDto): FillValue {
  if (paint.type === 'solid') return paint.color;
  if (paint.stops.length === 0) return '#000000';
  return {
    type: 'gradient',
    gradientType: paint.type,
    angle: paint.type === 'linear' ? paint.angle : 0,
    stops: clampStops(paint.stops),
  };
}

/** Editable fill to the `setStyle` patch shape (string passes through verbatim). */
export function fillToPatch(value: FillValue): string | Record<string, unknown> {
  if (typeof value === 'string') return value;
  return {
    type: 'gradient',
    gradientType: value.gradientType,
    angle: value.angle,
    stops: clampStops(value.stops).map((stop) => ({ offset: stop.offset, color: stop.color })),
  };
}

/** Editable fill to a CSS background for swatch and button previews. */
export function fillToCss(value: FillValue): string {
  if (typeof value === 'string') return value;
  const stops = clampStops(value.stops)
    .map((stop) => `${stop.color} ${stop.offset * 100}%`)
    .join(', ');
  if (value.gradientType === 'radial') return `radial-gradient(circle, ${stops})`;
  const angle = ((value.angle + 90) % 360 + 360) % 360;
  return `linear-gradient(${angle}deg, ${stops})`;
}

/** Editable fill to a render paint for host-side live previews. */
export function fillToPaint(value: FillValue): PaintDto {
  if (typeof value === 'string') return { type: 'solid', color: value };
  const stops = clampStops(value.stops).map((stop) => ({ offset: stop.offset, color: stop.color }));
  if (value.gradientType === 'radial') return { type: 'radial', stops };
  return { type: 'linear', angle: value.angle, stops };
}

/** Solid approximation of any fill: the string itself or the first stop. */
export function solidOfFill(value: FillValue): string {
  if (typeof value === 'string') return normalizeHexColor(value) ?? '#000000';
  return normalizeHexColor(value.stops[0]?.color) ?? '#000000';
}

/** Gradient view of any fill: itself, or a fresh two-stop blend from solid. */
export function gradientOfFill(value: FillValue): GradientFillValue {
  if (isGradientFill(value)) return value;
  const color = typeof value === 'string' ? (normalizeHexColor(value) ?? '#000000') : '#000000';
  return {
    type: 'gradient',
    gradientType: 'linear',
    angle: 90,
    stops: [
      { offset: 0, color },
      { offset: 1, color: '#ffffff' },
    ],
  };
}

/** Last committed fill per mode so toggling restores instead of rebuilding. */
export interface FillModeMemory {
  /** Last solid color, if the picker ever held one. */
  solid: string | null;
  /** Last gradient, if the picker ever held one. */
  gradient: GradientFillValue | null;
}

/** Empty mode memory (nothing to restore yet; toggles derive instead). */
export function emptyFillModeMemory(): FillModeMemory {
  return { solid: null, gradient: null };
}

/**
 * Switches fill mode while remembering each side: leaving a mode stores
 * the draft there, entering restores the stored fill and only derives a
 * fresh one when nothing was stored yet. Pure for testing.
 */
export function switchFillMode(
  memory: FillModeMemory,
  draft: FillValue,
  to: 'solid' | 'gradient',
): { next: FillValue; memory: FillModeMemory } {
  if (to === 'solid') {
    if (isGradientFill(draft)) return { next: memory.solid ?? solidOfFill(draft), memory: { ...memory, gradient: draft } };
    return { next: draft, memory };
  }
  if (typeof draft === 'string') return { next: memory.gradient ?? gradientOfFill(draft), memory: { ...memory, solid: draft } };
  return { next: draft, memory };
}

function recentsKey(projectId: string): string {
  return `${RECENTS_PREFIX}${projectId}`;
}

function readRecents(projectId: string): FillValue[] {
  try {
    const raw = window.localStorage.getItem(recentsKey(projectId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const valid: FillValue[] = [];
    for (const item of parsed) {
      if (typeof item === 'string') {
        if (item === 'transparent' || normalizeHexColor(item) !== null) valid.push(item);
      } else if (isGradientFill(item)) {
        valid.push({ ...item, stops: clampStops(item.stops) });
      }
    }
    return valid.slice(0, COLOR_TEMPLATES.length);
  } catch {
    return [];
  }
}

function writeRecents(projectId: string, recents: readonly FillValue[]): void {
  try {
    window.localStorage.setItem(recentsKey(projectId), JSON.stringify(recents));
  } catch {
    // Private mode or unavailable storage: recents stay in memory for the session.
  }
}

/** Stored recents for one project, newest first. */
export function loadColorRecents(projectId: string): FillValue[] {
  return readRecents(projectId);
}

/** Record one committed fill: dedupe, newest first, capped at the template count. */
export function recordColorRecent(projectId: string, value: FillValue): void {
  const next = readRecents(projectId).filter((item) => !fillEquals(item, value));
  next.unshift(value);
  writeRecents(projectId, next.slice(0, COLOR_TEMPLATES.length));
}

/** Swatch row: recents first, templates filling the remaining slots. */
export function visibleSwatches(projectId: string): FillValue[] {
  const shown: FillValue[] = [];
  for (const item of [...readRecents(projectId), ...COLOR_TEMPLATES]) {
    if (shown.length >= COLOR_TEMPLATES.length) break;
    if (!shown.some((seen) => fillEquals(seen, item))) shown.push(item);
  }
  return shown;
}

/** Duplicate a project's recents alongside the duplicated project. */
export function copyColorRecents(sourceId: string, targetId: string): void {
  if (sourceId === targetId) return;
  writeRecents(targetId, readRecents(sourceId));
}

/** Drop one project's recents after permanent deletion. */
export function clearColorRecents(projectId: string): void {
  try {
    window.localStorage.removeItem(recentsKey(projectId));
  } catch {
    // Unavailable storage: nothing persisted, nothing to clear.
  }
}

/** Drop recents whose project no longer exists. */
export function pruneColorRecents(knownIds: readonly string[]): void {
  try {
    const known = new Set(knownIds);
    const doomed: string[] = [];
    for (let index = 0; index < window.localStorage.length; index++) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(RECENTS_PREFIX) && !known.has(key.slice(RECENTS_PREFIX.length))) {
        doomed.push(key);
      }
    }
    for (const key of doomed) window.localStorage.removeItem(key);
  } catch {
    // Unavailable storage: nothing persisted, nothing to prune.
  }
}
