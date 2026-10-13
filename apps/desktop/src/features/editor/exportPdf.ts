import { gradientGeometry } from '../../render/drawModel';
import type { DrawEntryDto, RenderModelDto } from '../../hooks/useEngine';
import type { Engine } from '../../hooks/useEngine';
import type { ProjectCanvas } from '../../platform/projects/types';
import { planExportRect, queryExportModel } from './exportPng';

/**
 * Dependency-free vector PDF export: every committed shape kind maps to
 * native PDF operators (paths, axial/radial shading, Helvetica text) so no
 * raster step or third-party writer is needed. A raster wrapper would be
 * smaller but would surrender resolution independence, which is the point
 * of offering PDF next to SVG.
 */

/** PDF points per scene px (scene units are px at 96 DPI). */
export const PDF_POINTS_PER_PX = 72 / 96;
/** Host text measurement in scene units (platform-owned, like the canvas). */
export type PdfTextMeasurer = (line: string, fontSize: number, fontFamily: string) => number;
/** Helvetica ascender ratio: canvas `top` baseline sits one ascender above the PDF alphabetic baseline. */
const HELVETICA_ASCENT = 0.718;
/** Helvetica descender ratio, for labels the canvas pins by glyph bottom. */
const HELVETICA_DESCENT = 0.207;
/** Cubic control offset for a quarter ellipse (kappa). */
const ELLIPSE_KAPPA = 0.5522847498;

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

function fnum(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

/** Escapes a PDF literal string (parens, backslash, and non-printable bytes as octal). */
export function escapePdfText(value: string): string {
  let out = '';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (char === '(' || char === ')' || char === '\\') out += `\\${char}`;
    else if (code >= 32 && code <= 126) out += char;
    else if (code <= 0xff) out += `\\${code.toString(8).padStart(3, '0')}`;
    else out += `\\${(code & 0xff).toString(8).padStart(3, '0')}`;
  }
  return out;
}

function hexPair(text: string): number {
  return Number.parseInt(text, 16) / 255;
}

/**
 * Parses the normalized CSS colors the DOM wrapper produces (`#rrggbb`,
 * `#rgb`, `#rrggbbaa`, `rgb()/rgba()` with numbers or percents) plus
 * `transparent`. Anything else returns null so the caller falls back to
 * black instead of emitting an invalid operand.
 */
export function parseCssColor(css: string): Rgba | null {
  const text = css.trim();
  if (text === '') return null;
  if (text.toLowerCase() === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  if (text.startsWith('#')) {
    const hex = text.slice(1);
    if (/^[0-9a-fA-F]{3}$/.test(hex)) {
      return { r: hexPair(hex[0] + hex[0]), g: hexPair(hex[1] + hex[1]), b: hexPair(hex[2] + hex[2]), a: 1 };
    }
    if (/^[0-9a-fA-F]{4}$/.test(hex)) {
      return { r: hexPair(hex[0] + hex[0]), g: hexPair(hex[1] + hex[1]), b: hexPair(hex[2] + hex[2]), a: hexPair(hex[3] + hex[3]) };
    }
    if (/^[0-9a-fA-F]{6}$/.test(hex)) {
      return { r: hexPair(hex.slice(0, 2)), g: hexPair(hex.slice(2, 4)), b: hexPair(hex.slice(4, 6)), a: 1 };
    }
    if (/^[0-9a-fA-F]{8}$/.test(hex)) {
      return { r: hexPair(hex.slice(0, 2)), g: hexPair(hex.slice(2, 4)), b: hexPair(hex.slice(4, 6)), a: hexPair(hex.slice(6, 8)) };
    }
    return null;
  }
  const rgb = text.match(/^rgba?\(\s*(.+)\s*\)$/i);
  if (rgb) {
    const parts = rgb[1].split(',').map((part) => part.trim());
    if (parts.length === 3 || parts.length === 4) {
      const channel = (part: string): number | null => {
        if (part.endsWith('%')) {
          const n = Number(part.slice(0, -1));
          return Number.isFinite(n) ? Math.min(1, Math.max(0, n / 100)) : null;
        }
        const n = Number(part);
        return Number.isFinite(n) ? Math.min(1, Math.max(0, n / 255)) : null;
      };
      const r = channel(parts[0]);
      const g = channel(parts[1]);
      const b = channel(parts[2]);
      let a = 1;
      if (parts.length === 4) {
        const raw = parts[3].trim();
        const n = raw.endsWith('%') ? Number(raw.slice(0, -1)) / 100 : Number(raw);
        if (!Number.isFinite(n)) return null;
        a = Math.min(1, Math.max(0, n));
      }
      if (r === null || g === null || b === null) return null;
      return { r, g, b, a };
    }
  }
  return null;
}

function isNoneColor(color: string | null | undefined, parsed: Rgba | null): boolean {
  const trimmed = (color ?? '').trim();
  if (trimmed === '' || trimmed.toLowerCase() === 'transparent') return true;
  return parsed !== null && parsed.a <= 0;
}

function rgbOp(parsed: Rgba): string {
  return `${fnum(parsed.r)} ${fnum(parsed.g)} ${fnum(parsed.b)}`;
}

function paintFrame(entry: DrawEntryDto): DrawEntryDto['bounds'] {
  return entry.frame ?? entry.bounds;
}

interface PdfResources {
  gs: { alpha: string; name: string }[];
  shadings: { name: string; body: string }[];
  patterns: { name: string; shading: string }[];
}

interface PdfContext {
  ops: string[];
  res: PdfResources;
  gsSeq: number;
  shadingSeq: number;
  rect: { minX: number; maxY: number };
  scale: number;
  measure: PdfTextMeasurer;
}

/** Scene x to PDF points (origin at the export rect's left edge). */
function px(ctx: PdfContext, x: number): number {
  return (x - ctx.rect.minX) * ctx.scale;
}

/** Scene y to PDF points (PDF y grows upward from the export rect's bottom edge). */
function py(ctx: PdfContext, y: number): number {
  return (ctx.rect.maxY - y) * ctx.scale;
}

function gsFor(ctx: PdfContext, alpha: number): string {
  const key = alpha.toFixed(2);
  const found = ctx.res.gs.find((entry) => entry.alpha === key);
  if (found) return found.name;
  const name = `GS${ctx.gsSeq++}`;
  ctx.res.gs.push({ alpha: key, name });
  return name;
}

function entryAlpha(entry: DrawEntryDto): number {
  const opacity = Number.isFinite(entry.opacity) ? entry.opacity / 100 : 1;
  return Math.min(1, Math.max(0, opacity));
}

/** Emits the transparency state when the effective alpha is below one. */
function alphaOp(ctx: PdfContext, alpha: number): string {
  if (alpha >= 1) return '';
  return `/${gsFor(ctx, alpha)} gs `;
}

/** Fill color operator for a parsed color at an effective alpha. */
function fillOp(ctx: PdfContext, parsed: Rgba, alpha: number): string {
  return `${alphaOp(ctx, alpha)}${rgbOp(parsed)} rg `;
}

/** Stroke color operator for a parsed color at an effective alpha. */
function strokeOp(ctx: PdfContext, parsed: Rgba, alpha: number): string {
  return `${alphaOp(ctx, alpha)}${rgbOp(parsed)} RG `;
}

function strokeAttrs(ctx: PdfContext, entry: DrawEntryDto): string {
  const width = (Number.isFinite(entry.strokeWidth) ? entry.strokeWidth : 1) * ctx.scale;
  let out = `${fnum(width)} w 1 J 1 j `;
  if (entry.strokeStyle === 'dashed') {
    out += `[${fnum(width * 3)} ${fnum(width * 2)}] 0 d `;
  } else if (entry.strokeStyle === 'dotted') {
    out += `[${fnum(width)} ${fnum(width)}] 0 d `;
  } else {
    out += `[] 0 d `;
  }
  return out;
}

/** Rotation about the frame center: canvas angles run clockwise (y-down), PDF counterclockwise (y-up). */
function rotationOp(ctx: PdfContext, entry: DrawEntryDto): string {
  const rotation = Number.isFinite(entry.rotation) ? entry.rotation : 0;
  if (rotation === 0) return '';
  const frame = paintFrame(entry);
  const cx = px(ctx, (frame.minX + frame.maxX) / 2);
  const cy = py(ctx, (frame.minY + frame.maxY) / 2);
  const phi = -rotation;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const e = cx * (1 - cos) + cy * sin;
  const f = cy * (1 - cos) - cx * sin;
  return `${fnum(cos)} ${fnum(sin)} ${fnum(-sin)} ${fnum(cos)} ${fnum(e)} ${fnum(f)} cm `;
}

type FillSpec =
  | { kind: 'none' }
  | { kind: 'solid'; color: Rgba }
  | { kind: 'gradient'; id: string }
  | { kind: 'fallback'; color: Rgba };

function gradientStops(entry: DrawEntryDto): { offset: number; color: string }[] | null {
  const paint = entry.paint as { type: string; stops?: { offset: number; color: string }[] };
  if (paint.type !== 'linear' && paint.type !== 'radial') return null;
  const stops = Array.isArray(paint.stops) ? paint.stops : [];
  if (stops.length === 0) return null;
  return stops.map((stop) => ({
    offset: Number.isFinite(stop.offset) ? Math.min(1, Math.max(0, stop.offset)) : 0,
    color: stop.color,
  }));
}

/**
 * Registers an N-stop stitching shading (axial or radial) over the entry
 * frame. Single-stop gradients collapse to solid: a one-point stitch has
 * no interval to interpolate.
 */
function shadingFor(ctx: PdfContext, entry: DrawEntryDto): FillSpec {
  const stops = gradientStops(entry);
  if (!stops) {
    const paint = entry.paint as { type: string; color?: string };
    if (paint.type === 'solid') {
      const parsed = parseCssColor(paint.color ?? '');
      if (isNoneColor(paint.color, parsed)) return { kind: 'none' };
      return { kind: 'solid', color: parsed ?? { r: 0, g: 0, b: 0, a: 1 } };
    }
    // Conic fills have no PDF equivalent either; keep the shape visible with its first stop.
    const paintStops = (entry.paint as { stops?: { color: string }[] }).stops ?? [];
    if (paintStops.length > 0) {
      const parsed = parseCssColor(paintStops[0].color);
      if (parsed && !isNoneColor(paintStops[0].color, parsed)) {
        return { kind: 'fallback', color: parsed };
      }
    }
    return { kind: 'none' };
  }
  if (stops.length === 1) {
    const parsed = parseCssColor(stops[0].color);
    if (isNoneColor(stops[0].color, parsed)) return { kind: 'none' };
    return { kind: 'solid', color: parsed ?? { r: 0, g: 0, b: 0, a: 1 } };
  }
  const paint = entry.paint as { type: string; angle?: number };
  const frame = paintFrame(entry);
  const sorted = [...stops].sort((a, b) => a.offset - b.offset);
  const functions = sorted
    .slice(0, -1)
    .map((stop, i) => {
      const next = sorted[i + 1];
      const c0 = parseCssColor(stop.color) ?? { r: 0, g: 0, b: 0, a: 1 };
      const c1 = parseCssColor(next.color) ?? { r: 0, g: 0, b: 0, a: 1 };
      return `<< /FunctionType 2 /Domain [0 1] /C0 [${rgbOp(c0)}] /C1 [${rgbOp(c1)}] /N 1 >>`;
    })
    .join(' ');
  const bounds = sorted.slice(1, -1).map((stop) => fnum(stop.offset)).join(' ');
  const encode = sorted.slice(0, -1).map(() => '0 1').join(' ');
  let coords: string;
  let shadingType: number;
  if (paint.type === 'linear') {
    const angle = typeof paint.angle === 'number' && Number.isFinite(paint.angle) ? paint.angle : 0;
    const g = gradientGeometry(frame, angle);
    coords = `${fnum(px(ctx, g.x0))} ${fnum(py(ctx, g.y0))} ${fnum(px(ctx, g.x1))} ${fnum(py(ctx, g.y1))}`;
    shadingType = 2;
  } else {
    const cx = (frame.minX + frame.maxX) / 2;
    const cy = (frame.minY + frame.maxY) / 2;
    const radius = Math.max(frame.maxX - frame.minX, frame.maxY - frame.minY) / 2;
    const r = Math.max(0, radius) * ctx.scale;
    coords = `${fnum(px(ctx, cx))} ${fnum(py(ctx, cy))} 0 ${fnum(px(ctx, cx))} ${fnum(py(ctx, cy))} ${fnum(r)}`;
    shadingType = 3;
  }
  const shadingName = `Sh${ctx.shadingSeq}`;
  const patternName = `P${ctx.shadingSeq}`;
  ctx.shadingSeq += 1;
  ctx.res.shadings.push({
    name: shadingName,
    body: `<< /ShadingType ${shadingType} /ColorSpace /DeviceRGB /Coords [${coords}] /Function << /FunctionType 3 /Domain [0 1] /Functions [${functions}] /Bounds [${bounds}] /Encode [${encode}] >> /Extend [true true] >>`,
  });
  ctx.res.patterns.push({ name: patternName, shading: shadingName });
  return { kind: 'gradient', id: patternName };
}

/** Paints one already-constructed path according to the fill spec (`f`, pattern fill, or nothing). */
function paintPathOp(ctx: PdfContext, entry: DrawEntryDto, fill: FillSpec): string {
  const alpha = entryAlpha(entry);
  switch (fill.kind) {
    case 'none':
      return '';
    case 'gradient':
      return `/Pattern cs /${fill.id} scn ${alphaOp(ctx, alpha)}f `;
    case 'solid':
    case 'fallback':
      return `${fillOp(ctx, fill.color, alpha * fill.color.a)}f `;
  }
}

/** Strokes one already-constructed path, or nothing for transparent strokes. */
function strokePathOp(ctx: PdfContext, entry: DrawEntryDto): string {
  const parsed = parseCssColor(entry.strokeColor);
  if (isNoneColor(entry.strokeColor, parsed)) return '';
  const color = parsed ?? { r: 0, g: 0, b: 0, a: 1 };
  return `${strokeAttrs(ctx, entry)}${strokeOp(ctx, color, entryAlpha(entry) * color.a)}S `;
}

function rectPath(ctx: PdfContext, frame: DrawEntryDto['bounds']): string {
  return `${fnum(px(ctx, frame.minX))} ${fnum(py(ctx, frame.maxY))} ${fnum((frame.maxX - frame.minX) * ctx.scale)} ${fnum((frame.maxY - frame.minY) * ctx.scale)} re `;
}

function boxOps(ctx: PdfContext, entry: DrawEntryDto): string {
  const frame = paintFrame(entry);
  const fill = shadingFor(ctx, entry);
  const path = rectPath(ctx, frame);
  return `q ${rotationOp(ctx, entry)}${path}${paintPathOp(ctx, entry, fill)}${path}${strokePathOp(ctx, entry)}Q\n`;
}

function ellipseOps(ctx: PdfContext, entry: DrawEntryDto): string {
  const frame = paintFrame(entry);
  const cx = (frame.minX + frame.maxX) / 2;
  const cy = (frame.minY + frame.maxY) / 2;
  const rx = Math.max((frame.maxX - frame.minX) / 2, 0) * ctx.scale;
  const ry = Math.max((frame.maxY - frame.minY) / 2, 0) * ctx.scale;
  const kx = ELLIPSE_KAPPA * rx;
  const ky = ELLIPSE_KAPPA * ry;
  const X = px(ctx, cx);
  const Y = py(ctx, cy);
  const path =
    `${fnum(X + rx)} ${fnum(Y)} m ` +
    `${fnum(X + rx)} ${fnum(Y + ky)} ${fnum(X + kx)} ${fnum(Y + ry)} ${fnum(X)} ${fnum(Y + ry)} c ` +
    `${fnum(X - kx)} ${fnum(Y + ry)} ${fnum(X - rx)} ${fnum(Y + ky)} ${fnum(X - rx)} ${fnum(Y)} c ` +
    `${fnum(X - rx)} ${fnum(Y - ky)} ${fnum(X - kx)} ${fnum(Y - ry)} ${fnum(X)} ${fnum(Y - ry)} c ` +
    `${fnum(X + kx)} ${fnum(Y - ry)} ${fnum(X + rx)} ${fnum(Y - ky)} ${fnum(X + rx)} ${fnum(Y)} c h `;
  const fill = shadingFor(ctx, entry);
  return `q ${rotationOp(ctx, entry)}${path}${paintPathOp(ctx, entry, fill)}${path}${strokePathOp(ctx, entry)}Q\n`;
}

/** Head marker by wire style, mirroring the canvas marker geometry. */
function pdfHeadMarker(ctx: PdfContext, from: [number, number], tip: [number, number], strokeWidth: number, color: Rgba, alpha: number, marker: string): string {
  const scale = Math.max(1, strokeWidth / 2);
  if (marker === 'dot') {
    const cx = px(ctx, tip[0]);
    const cy = py(ctx, tip[1]);
    const r = ((8 * scale) / 2) * ctx.scale;
    const k = ELLIPSE_KAPPA * r;
    return `${fnum(cx + r)} ${fnum(cy)} m ${fnum(cx + r)} ${fnum(cy + k)} ${fnum(cx + k)} ${fnum(cy + r)} ${fnum(cx)} ${fnum(cy + r)} c ${fnum(cx - k)} ${fnum(cy + r)} ${fnum(cx - r)} ${fnum(cy + k)} ${fnum(cx - r)} ${fnum(cy)} c ${fnum(cx - r)} ${fnum(cy - k)} ${fnum(cx - k)} ${fnum(cy - r)} ${fnum(cx)} ${fnum(cy - r)} c ${fnum(cx + k)} ${fnum(cy - r)} ${fnum(cx + r)} ${fnum(cy - k)} ${fnum(cx + r)} ${fnum(cy)} c h ${fillOp(ctx, color, alpha * color.a)}f `;
  }
  if (marker === 'bar') {
    const dx = (tip[0] - from[0]) * ctx.scale;
    const dy = -(tip[1] - from[1]) * ctx.scale;
    const len = Math.hypot(dx, dy);
    if (len === 0) return '';
    const half = ((8 * scale) / 2) * ctx.scale;
    const nx = (-dy / len) * half;
    const ny = (dx / len) * half;
    const tx = px(ctx, tip[0]);
    const ty = py(ctx, tip[1]);
    const width = strokeWidth * ctx.scale;
    return `${fnum(tx - nx)} ${fnum(ty - ny)} m ${fnum(tx + nx)} ${fnum(ty + ny)} l ${fnum(width)} w 0 J 2 j [] 0 d ${strokeOp(ctx, color, alpha * color.a)}S `;
  }
  return arrowheadOps(ctx, from, tip, strokeWidth, color, alpha);
}

function arrowheadOps(ctx: PdfContext, from: [number, number], tip: [number, number], strokeWidth: number, color: Rgba, alpha: number): string {
  const scale = Math.max(1, strokeWidth / 2);
  const len = 12 * scale * ctx.scale;
  const width = 8 * scale * ctx.scale;
  const dx = (tip[0] - from[0]) * ctx.scale;
  const dy = -(tip[1] - from[1]) * ctx.scale;
  const angle = Math.atan2(dy, dx);
  const tx = px(ctx, tip[0]);
  const ty = py(ctx, tip[1]);
  const baseX = tx - Math.cos(angle) * len;
  const baseY = ty - Math.sin(angle) * len;
  const leftX = baseX + Math.cos(angle + Math.PI / 2) * (width / 2);
  const leftY = baseY + Math.sin(angle + Math.PI / 2) * (width / 2);
  const rightX = baseX + Math.cos(angle - Math.PI / 2) * (width / 2);
  const rightY = baseY + Math.sin(angle - Math.PI / 2) * (width / 2);
  return `${fnum(tx)} ${fnum(ty)} m ${fnum(leftX)} ${fnum(leftY)} l ${fnum(rightX)} ${fnum(rightY)} l h ${fillOp(ctx, color, alpha * color.a)}f `;
}

function polylineOps(ctx: PdfContext, entry: DrawEntryDto): string {
  const points = entry.points;
  if (!points || points.length < 2) return boxOps(ctx, entry);
  const head = `${fnum(px(ctx, points[0][0]))} ${fnum(py(ctx, points[0][1]))} m `;
  const rest = points.slice(1).map(([x, y]) => `${fnum(px(ctx, x))} ${fnum(py(ctx, y))} l `).join('');
  const path = head + rest;
  let out = `q ${rotationOp(ctx, entry)}${path}${strokeAttrs(ctx, entry)}`;
  const parsed = parseCssColor(entry.strokeColor);
  if (!isNoneColor(entry.strokeColor, parsed)) {
    const color = parsed ?? { r: 0, g: 0, b: 0, a: 1 };
    out += strokeOp(ctx, color, entryAlpha(entry) * color.a);
  }
  out += 'S ';
  if (entry.detail.type === 'arrow') {
    const width = Number.isFinite(entry.strokeWidth) ? entry.strokeWidth : 1;
    const color = parsed ?? { r: 0, g: 0, b: 0, a: 1 };
    const alpha = entryAlpha(entry);
    const n = points.length;
    if (entry.detail.end != null && n >= 2) out += pdfHeadMarker(ctx, points[n - 2], points[n - 1], width, color, alpha, entry.detail.end);
    if (entry.detail.start != null && n >= 2) out += pdfHeadMarker(ctx, points[1], points[0], width, color, alpha, entry.detail.start);
  }
  return `${out}Q\n`;
}

/** PDF has no quadratic operator: elevate the canvas quadratic smoothing to cubics. */
function freedrawOps(ctx: PdfContext, entry: DrawEntryDto): string {
  const points = entry.points;
  if (!points || points.length < 2) return boxOps(ctx, entry);
  const X = (p: [number, number]): number => px(ctx, p[0]);
  const Y = (p: [number, number]): number => py(ctx, p[1]);
  let path = `${fnum(X(points[0]))} ${fnum(Y(points[0]))} m `;
  const quad = (p0: [number, number], q: [number, number], p1: [number, number]): string => {
    const c1x = p0[0] + (2 / 3) * (q[0] - p0[0]);
    const c1y = p0[1] + (2 / 3) * (q[1] - p0[1]);
    const c2x = p1[0] + (2 / 3) * (q[0] - p1[0]);
    const c2y = p1[1] + (2 / 3) * (q[1] - p1[1]);
    return `${fnum(px(ctx, c1x))} ${fnum(py(ctx, c1y))} ${fnum(px(ctx, c2x))} ${fnum(py(ctx, c2y))} ${fnum(px(ctx, p1[0]))} ${fnum(py(ctx, p1[1]))} c `;
  };
  if (points.length === 2) {
    path += `${fnum(X(points[1]))} ${fnum(Y(points[1]))} l `;
  } else {
    let prev: [number, number] = points[0];
    for (let i = 1; i < points.length - 1; i++) {
      const curr = points[i];
      const next = points[i + 1];
      const mid: [number, number] = [(curr[0] + next[0]) / 2, (curr[1] + next[1]) / 2];
      path += quad(prev, curr, mid);
      prev = mid;
    }
    const last = points[points.length - 1];
    path += `${fnum(X(last))} ${fnum(Y(last))} l `;
  }
  return `q ${rotationOp(ctx, entry)}${path}${strokeAttrs(ctx, entry)}${strokePathOp(ctx, entry)}Q\n`;
}

/** Emits one left/center/right-aligned line through an absolute text matrix. */
function textLineOps(ctx: PdfContext, line: string, xPt: number, yPt: number, sizePt: number, align: string, color: Rgba, alpha: number): string {
  const widthPt = ctx.measure(line, sizePt / ctx.scale, '') * ctx.scale;
  const x = align === 'center' ? xPt - widthPt / 2 : align === 'right' ? xPt - widthPt : xPt;
  return `BT /F1 ${fnum(sizePt)} Tf 1 0 0 1 ${fnum(x)} ${fnum(yPt)} Tm ${fillOp(ctx, color, alpha)}(${escapePdfText(line)}) Tj ET `;
}

function textOps(ctx: PdfContext, entry: DrawEntryDto): string {
  if (entry.detail.type !== 'text') return boxOps(ctx, entry);
  const detail = entry.detail;
  const frame = paintFrame(entry);
  const alpha = entryAlpha(entry);
  const fill = shadingFor(ctx, entry);
  const bgPath = rectPath(ctx, frame);
  let out = `q ${rotationOp(ctx, entry)}${bgPath}${paintPathOp(ctx, entry, fill)}`;
  const border = parseCssColor(detail.borderColor ?? '');
  if (!isNoneColor(detail.borderColor, border) && border) {
    const width = (Number.isFinite(entry.strokeWidth) ? entry.strokeWidth : 1) * ctx.scale;
    let dash = '[] 0 d ';
    if (entry.strokeStyle === 'dashed') dash = `[${fnum(width * 3)} ${fnum(width * 2)}] 0 d `;
    else if (entry.strokeStyle === 'dotted') dash = `[${fnum(width)} ${fnum(width)}] 0 d `;
    out += `${bgPath}${fnum(width)} w 1 J 1 j ${dash}${strokeOp(ctx, border, alpha * border.a)}S `;
  }
  const glyph = parseCssColor(entry.strokeColor);
  const glyphColor = !isNoneColor(entry.strokeColor, glyph) && glyph ? glyph : { r: 0, g: 0, b: 0, a: 1 };
  const fontSize = Number.isFinite(detail.fontSize) ? detail.fontSize : 16;
  const sizePt = fontSize * ctx.scale;
  const lineHeight = fontSize * 1.25;
  const anchorSceneX =
    detail.align === 'center'
      ? (frame.minX + frame.maxX) / 2
      : detail.align === 'right'
        ? frame.maxX
        : frame.minX;
  const lines = detail.text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === '') continue;
    const baselineScene = frame.minY + i * lineHeight + HELVETICA_ASCENT * fontSize;
    out += textLineOps(ctx, lines[i], px(ctx, anchorSceneX), py(ctx, baselineScene), sizePt, detail.align, glyphColor, alpha * glyphColor.a);
  }
  return `${out}Q\n`;
}

function pathOps(ctx: PdfContext, entry: DrawEntryDto): string {
  const segments = entry.segments;
  if (!segments || segments.length < 2) return boxOps(ctx, entry);
  let path = `${fnum(px(ctx, segments[0].point[0]))} ${fnum(py(ctx, segments[0].point[1]))} m `;
  for (let i = 1; i < segments.length; i++) {
    const prev = segments[i - 1];
    const curr = segments[i];
    const out = prev.handleOut ?? prev.point;
    const inn = curr.handleIn ?? curr.point;
    path += `${fnum(px(ctx, out[0]))} ${fnum(py(ctx, out[1]))} ${fnum(px(ctx, inn[0]))} ${fnum(py(ctx, inn[1]))} ${fnum(px(ctx, curr.point[0]))} ${fnum(py(ctx, curr.point[1]))} c `;
  }
  const closed = entry.detail.type === 'path' && entry.detail.closed;
  if (closed) path += 'h ';
  const fill = closed ? shadingFor(ctx, entry) : { kind: 'none' as const };
  const paint = closed ? paintPathOp(ctx, entry, fill) : '';
  return `q ${rotationOp(ctx, entry)}${path}${paint}${path}${strokePathOp(ctx, entry)}Q\n`;
}

function annotationOps(ctx: PdfContext, text: string, topSceneY: number, x: number, size: number): string {
  if (text === '') return '';
  const color = { r: 0.4, g: 0.4, b: 0.4, a: 1 };
  // Canvas paints these labels from their top edge, like committed text.
  return textLineOps(ctx, text, px(ctx, x), py(ctx, topSceneY + HELVETICA_ASCENT * size), size * ctx.scale, 'left', color, 1);
}

function entryOps(ctx: PdfContext, entry: DrawEntryDto): string {
  switch (entry.kind) {
    case 'rectangle':
      return boxOps(ctx, entry);
    case 'frame': {
      const frame = paintFrame(entry);
      const label = entry.detail.type === 'frame' ? entry.detail.name : '';
      // The canvas pins the frame name by glyph bottom just above the frame edge.
      const labelOps = label !== '' ? `q ${textLineOps(ctx, label, px(ctx, frame.minX + 2), py(ctx, frame.minY - 2 + HELVETICA_DESCENT * 11), 11 * ctx.scale, 'left', { r: 0.4, g: 0.4, b: 0.4, a: 1 }, 1)}Q\n` : '';
      return boxOps(ctx, entry) + labelOps;
    }
    case 'image': {
      const frame = paintFrame(entry);
      const gray = { r: 0.6, g: 0.6, b: 0.6, a: 1 };
      const cross =
        `${fnum(px(ctx, frame.minX))} ${fnum(py(ctx, frame.minY))} m ${fnum(px(ctx, frame.maxX))} ${fnum(py(ctx, frame.maxY))} l ` +
        `${fnum(px(ctx, frame.maxX))} ${fnum(py(ctx, frame.minY))} m ${fnum(px(ctx, frame.minX))} ${fnum(py(ctx, frame.maxY))} l ` +
        `0.75 w 0 J 0 j [] 0 d ${strokeOp(ctx, gray, 1)}S `;
      const asset = entry.detail.type === 'image' && entry.detail.assetId ? `image: ${entry.detail.assetId}` : 'image (no asset store in desktop)';
      return boxOps(ctx, entry) + `q ${rotationOp(ctx, entry)}${cross}${annotationOps(ctx, asset, frame.minX + 4, frame.minY + 4, 10)}Q\n`;
    }
    case 'instance':
    case 'custom': {
      const frame = paintFrame(entry);
      const name = entry.detail.type === 'custom' ? entry.detail.typeName : entry.kind;
      return boxOps(ctx, entry) + `q ${annotationOps(ctx, name, frame.minX + 4, frame.minY + 4, 10)}Q\n`;
    }
    case 'ellipse':
      return ellipseOps(ctx, entry);
    case 'line':
    case 'arrow':
      return polylineOps(ctx, entry);
    case 'freedraw':
      return freedrawOps(ctx, entry);
    case 'text':
      return textOps(ctx, entry);
    case 'path':
      return pathOps(ctx, entry);
    default:
      return boxOps(ctx, entry);
  }
}

function framePassOps(ctx: PdfContext, frame: DrawEntryDto, children: DrawEntryDto[]): string {
  const head = entryOps(ctx, frame);
  if (children.length === 0) return head;
  const kids = children.map((child) => entryOps(ctx, child)).join('');
  const clip = frame.detail.type === 'frame' ? frame.detail.clipContent : true;
  if (!clip) return head + kids;
  const clipFrame = frame.frame ?? frame.bounds;
  return head + `q ${rectPath(ctx, clipFrame)}W n ${kids}Q\n`;
}

/**
 * Builds a one-page vector PDF for an export rect. Pure over its inputs:
 * text widths arrive through `measure` so tests never need a canvas.
 */
export function buildVectorPdf(rect: { minX: number; minY: number; width: number; height: number; background: string }, model: RenderModelDto, measure: PdfTextMeasurer): Uint8Array<ArrayBuffer> {
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  if (!Number.isFinite(rect.minX) || !Number.isFinite(rect.minY) || !Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error('PDF export rect must be finite');
  }
  const ctx: PdfContext = {
    ops: [],
    res: { gs: [], shadings: [], patterns: [] },
    gsSeq: 0,
    shadingSeq: 0,
    rect: { minX: rect.minX, maxY: rect.minY + height },
    scale: PDF_POINTS_PER_PX,
    measure,
  };
  if (rect.background !== 'transparent') {
    const parsed = parseCssColor(rect.background) ?? { r: 1, g: 1, b: 1, a: 1 };
    ctx.ops.push(`q ${rectPath(ctx, { minX: rect.minX, minY: rect.minY, maxX: rect.minX + width, maxY: rect.minY + height })}${fillOp(ctx, parsed, parsed.a)}f Q\n`);
  }
  for (const entry of model.base) ctx.ops.push(entryOps(ctx, entry));
  for (const pass of model.frames) ctx.ops.push(framePassOps(ctx, pass.frame, pass.children));

  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  let length = 0;
  const pushBytes = (bytes: Uint8Array): void => {
    chunks.push(bytes);
    length += bytes.length;
  };
  const pushText = (text: string): void => pushBytes(enc.encode(text));

  // Object numbers: 1 catalog, 2 pages, 3 page, 4 contents, 5 font,
  // then one per graphics state, shading, and pattern in registration order.
  const gsBase = 6;
  const shadingBase = gsBase + ctx.res.gs.length;
  const patternBase = shadingBase + ctx.res.shadings.length;
  const objectCount = 5 + ctx.res.gs.length + ctx.res.shadings.length + ctx.res.patterns.length;
  const offsets: number[] = new Array(objectCount + 1).fill(0);

  const widthPt = fnum(width * ctx.scale);
  const heightPt = fnum(height * ctx.scale);
  const resourceParts: string[] = ['/Font << /F1 5 0 R >>'];
  if (ctx.res.gs.length > 0) {
    resourceParts.push(`/ExtGState << ${ctx.res.gs.map((entry, i) => `/${entry.name} ${gsBase + i} 0 R`).join(' ')} >>`);
  }
  if (ctx.res.shadings.length > 0) {
    resourceParts.push(`/Shading << ${ctx.res.shadings.map((entry, i) => `/${entry.name} ${shadingBase + i} 0 R`).join(' ')} >>`);
  }
  if (ctx.res.patterns.length > 0) {
    resourceParts.push(`/Pattern << ${ctx.res.patterns.map((entry, i) => `/${entry.name} ${patternBase + i} 0 R`).join(' ')} >>`);
  }

  pushText('%PDF-1.4\n');
  offsets[1] = length;
  pushText('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  offsets[2] = length;
  pushText('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');
  offsets[3] = length;
  pushText(`3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${widthPt} ${heightPt}] /Resources << ${resourceParts.join(' ')} >> /Contents 4 0 R >>\nendobj\n`);
  const content = enc.encode(ctx.ops.join(''));
  offsets[4] = length;
  pushText(`4 0 obj\n<< /Length ${content.length} >>\nstream\n`);
  pushBytes(content);
  pushText('\nendstream\nendobj\n');
  offsets[5] = length;
  pushText('5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n');
  ctx.res.gs.forEach((entry, i) => {
    offsets[gsBase + i] = length;
    pushText(`${gsBase + i} 0 obj\n<< /Type /ExtGState /CA ${entry.alpha} /ca ${entry.alpha} >>\nendobj\n`);
  });
  ctx.res.shadings.forEach((entry, i) => {
    offsets[shadingBase + i] = length;
    const body = enc.encode(`${entry.body}`);
    pushText(`${shadingBase + i} 0 obj\n<< /Length ${body.length} >>\nstream\n`);
    pushBytes(body);
    pushText('\nendstream\nendobj\n');
  });
  ctx.res.patterns.forEach((entry, i) => {
    offsets[patternBase + i] = length;
    pushText(`${patternBase + i} 0 obj\n<< /Type /Pattern /PatternType 2 /Matrix [1 0 0 1 0 0] /Shading ${shadingBase + ctx.res.shadings.findIndex((shading) => shading.name === entry.shading)} 0 R >>\nendobj\n`);
  });

  const xrefStart = length;
  pushText(`xref\n0 ${objectCount + 1}\n0000000000 65535 f \n`);
  for (let i = 1; i <= objectCount; i++) {
    pushText(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  }
  pushText(`trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/** Resolves arbitrary CSS colors through the canvas so named/hsl forms export exactly as painted. */
function makeColorNormalizer(): (css: string) => string {
  const probe = document.createElement('canvas').getContext('2d');
  if (!probe) return (css: string) => css;
  return (css: string) => {
    const trimmed = css.trim();
    if (trimmed === '' || trimmed.toLowerCase() === 'transparent') return css;
    probe.fillStyle = '#000000';
    probe.fillStyle = trimmed;
    return probe.fillStyle;
  };
}

function normalizeEntryColors(entry: DrawEntryDto, normalize: (css: string) => string): DrawEntryDto {
  const paint = entry.paint as { type: string; color?: string; stops?: { offset: number; color: string }[] };
  let nextPaint = entry.paint;
  if (paint.type === 'solid' && typeof paint.color === 'string') {
    nextPaint = { ...entry.paint, color: normalize(paint.color) } as DrawEntryDto['paint'];
  } else if ((paint.type === 'linear' || paint.type === 'radial') && Array.isArray(paint.stops)) {
    nextPaint = {
      ...entry.paint,
      stops: paint.stops.map((stop) => ({ ...stop, color: normalize(stop.color) })),
    } as DrawEntryDto['paint'];
  }
  let detail = entry.detail;
  if (detail.type === 'text' && typeof detail.borderColor === 'string') {
    detail = { ...detail, borderColor: normalize(detail.borderColor) };
  }
  return { ...entry, paint: nextPaint, strokeColor: normalize(entry.strokeColor), detail };
}

/** Full PDF export: plan, query the committed model, and write one vector page (the caller downloads). */
export async function exportPdfBlob(engine: Engine, canvas: ProjectCanvas): Promise<Blob> {
  const rect = await planExportRect(engine, canvas);
  const model = await queryExportModel(engine, rect);
  const normalize = makeColorNormalizer();
  const clean: RenderModelDto = {
    ...model,
    selection: null,
    snapGuides: [],
    base: model.base.map((entry) => normalizeEntryColors(entry, normalize)),
    frames: model.frames.map((pass) => ({
      frame: normalizeEntryColors(pass.frame, normalize),
      children: pass.children.map((child) => normalizeEntryColors(child, normalize)),
    })),
  };
  const measurer: PdfTextMeasurer = (line, fontSize, fontFamily) => {
    const probe = document.createElement('canvas').getContext('2d');
    if (!probe) throw new Error('2D context unavailable');
    probe.font = `${fontSize}px ${fontFamily}, sans-serif`;
    return probe.measureText(line).width;
  };
  return new Blob([buildVectorPdf(rect, clean, measurer)], { type: 'application/pdf' });
}

/** File-safe export name for a project. */
export function pdfFileName(projectName: string): string {
  const clean = projectName.replace(/[\\/:"*?<>|]/g, '-').trim() || 'grafalith';
  return `${clean}.pdf`;
}
