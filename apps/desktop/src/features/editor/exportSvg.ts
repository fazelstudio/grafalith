import { CANVAS_OVERLAY, gradientGeometry } from '../../render/drawModel';
import type { DrawEntryDto, RenderModelDto } from '../../hooks/useEngine';
import type { Engine } from '../../hooks/useEngine';
import type { ProjectCanvas } from '../../platform/projects/types';
import { planExportRect, queryExportModel, type PngExportRect } from './exportPng';

/** Fallback glyph color when a text stroke is transparent (canvas parity: no parent element, so the dark default applies). */
const TEXT_FALLBACK_FILL = CANVAS_OVERLAY.fallbackFill;
/** Muted annotation color for frame names and type labels (same overlay source the canvas paints). */
const ANNOTATION_FILL = CANVAS_OVERLAY.annotationMuted;
/** Placeholder stroke for unfilled images (same overlay source the canvas paints). */
const PLACEHOLDER_STROKE = CANVAS_OVERLAY.placeholderStroke;

interface SvgContext {
  defs: string[];
  seq: number;
}

function num(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return String(Math.round(value * 100) / 100);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function sanitizeId(value: string): string {
  const clean = value.replace(/[^A-Za-z0-9_-]/g, '-');
  return clean === '' ? 'entry' : clean;
}

function paintFrame(entry: DrawEntryDto): DrawEntryDto['bounds'] {
  return entry.frame ?? entry.bounds;
}

function isTransparent(color: string | null | undefined): boolean {
  const trimmed = (color ?? '').trim();
  return trimmed === '' || trimmed.toLowerCase() === 'transparent';
}

function rotationOf(entry: DrawEntryDto): number {
  return Number.isFinite(entry.rotation) ? entry.rotation : 0;
}

/** Fill attribute plus any gradient/clip definition it requires. */
function fillFor(entry: DrawEntryDto, ctx: SvgContext): { attr: string; } {
  const paint = entry.paint as { type: string; color?: string; angle?: number; stops?: { offset: number; color: string }[] };
  if (paint.type === 'solid') {
    if (isTransparent(paint.color)) return { attr: ' fill="none"' };
    return { attr: ` fill="${escapeXml(paint.color ?? '#000000')}"` };
  }
  if (paint.type === 'linear' || paint.type === 'radial') {
    const stops = Array.isArray(paint.stops) ? paint.stops : [];
    if (stops.length === 0) return { attr: ' fill="none"' };
    const frame = paintFrame(entry);
    const id = `grad-${sanitizeId(entry.id)}-${ctx.seq++}`;
    const stopTags = stops
      .map((stop) => {
        const offset = Number.isFinite(stop.offset) ? Math.min(1, Math.max(0, stop.offset)) : 0;
        return `<stop offset="${num(offset * 100)}%" stop-color="${escapeXml(stop.color)}"/>`;
      })
      .join('');
    if (paint.type === 'linear') {
      const angle = typeof paint.angle === 'number' && Number.isFinite(paint.angle) ? paint.angle : 0;
      const g = gradientGeometry(frame, angle);
      ctx.defs.push(
        `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${num(g.x0)}" y1="${num(g.y0)}" x2="${num(g.x1)}" y2="${num(g.y1)}">${stopTags}</linearGradient>`,
      );
    } else {
      const cx = (frame.minX + frame.maxX) / 2;
      const cy = (frame.minY + frame.maxY) / 2;
      const radius = Math.max(frame.maxX - frame.minX, frame.maxY - frame.minY) / 2;
      ctx.defs.push(
        `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${num(cx)}" cy="${num(cy)}" r="${num(radius)}">${stopTags}</radialGradient>`,
      );
    }
    return { attr: ` fill="url(#${id})"` };
  }
  // Conic fills have no SVG equivalent; keep the shape visible with its first stop.
  const stops = Array.isArray(paint.stops) ? paint.stops : [];
  if (stops.length > 0) return { attr: ` fill="${escapeXml(stops[0].color)}"` };
  return { attr: ' fill="none"' };
}

function strokeFor(entry: DrawEntryDto): string {
  if (isTransparent(entry.strokeColor)) return ' stroke="none"';
  const width = Number.isFinite(entry.strokeWidth) ? entry.strokeWidth : 1;
  let out = ` stroke="${escapeXml(entry.strokeColor)}" stroke-width="${num(width)}" stroke-linecap="round" stroke-linejoin="round"`;
  if (entry.strokeStyle === 'dashed') {
    out += ` stroke-dasharray="${num(width * 3)} ${num(width * 2)}"`;
  } else if (entry.strokeStyle === 'dotted') {
    out += ` stroke-dasharray="${num(width)} ${num(width)}"`;
  }
  return out;
}

/** Opacity + rotation wrapper shared by every entry so exported groups match the canvas picture. */
function wrapEntry(entry: DrawEntryDto, inner: string): string {
  const attrs: string[] = [];
  const opacity = Number.isFinite(entry.opacity) ? entry.opacity / 100 : 1;
  if (opacity < 1) attrs.push(`opacity="${num(Math.max(0, opacity))}"`);
  const rotation = rotationOf(entry);
  if (rotation !== 0) {
    const frame = paintFrame(entry);
    const cx = (frame.minX + frame.maxX) / 2;
    const cy = (frame.minY + frame.maxY) / 2;
    attrs.push(`transform="rotate(${num((rotation * 180) / Math.PI)} ${num(cx)} ${num(cy)})"`);
  }
  if (attrs.length === 0) return inner;
  return `<g ${attrs.join(' ')}>${inner}</g>`;
}

function boxShape(entry: DrawEntryDto, ctx: SvgContext): string {
  const frame = paintFrame(entry);
  const { attr: fill } = fillFor(entry, ctx);
  const stroke = strokeFor(entry);
  return `<rect x="${num(frame.minX)}" y="${num(frame.minY)}" width="${num(frame.maxX - frame.minX)}" height="${num(frame.maxY - frame.minY)}"${fill}${stroke}/>`;
}

/** Head marker by wire style, mirroring the canvas marker geometry. */
function svgHeadMarker(from: [number, number], tip: [number, number], strokeWidth: number, paint: string, marker: string): string {
  const scale = Math.max(1, strokeWidth / 2);
  const fill = ` fill="${escapeXml(paint)}" stroke="none"`;
  if (marker === 'dot') {
    return `<circle cx="${num(tip[0])}" cy="${num(tip[1])}" r="${num((8 * scale) / 2)}"${fill}/>`;
  }
  if (marker === 'bar') {
    const dx = tip[0] - from[0];
    const dy = tip[1] - from[1];
    const len = Math.hypot(dx, dy);
    if (len === 0) return '';
    const half = (8 * scale) / 2;
    const nx = (-dy / len) * half;
    const ny = (dx / len) * half;
    return `<line x1="${num(tip[0] - nx)}" y1="${num(tip[1] - ny)}" x2="${num(tip[0] + nx)}" y2="${num(tip[1] + ny)}" stroke="${escapeXml(paint)}" stroke-width="${num(strokeWidth)}" stroke-linecap="round"/>`;
  }
  return arrowheadPolygon(from, tip, strokeWidth, paint);
}

function arrowheadPolygon(from: [number, number], tip: [number, number], strokeWidth: number, fill: string): string {
  const scale = Math.max(1, strokeWidth / 2);
  const len = 12 * scale;
  const width = 8 * scale;
  const angle = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
  const baseX = tip[0] - Math.cos(angle) * len;
  const baseY = tip[1] - Math.sin(angle) * len;
  const leftX = baseX + Math.cos(angle + Math.PI / 2) * (width / 2);
  const leftY = baseY + Math.sin(angle + Math.PI / 2) * (width / 2);
  const rightX = baseX + Math.cos(angle - Math.PI / 2) * (width / 2);
  const rightY = baseY + Math.sin(angle - Math.PI / 2) * (width / 2);
  return `<polygon points="${num(tip[0])},${num(tip[1])} ${num(leftX)},${num(leftY)} ${num(rightX)},${num(rightY)}" fill="${escapeXml(fill)}" stroke="none"/>`;
}

function polylineShape(entry: DrawEntryDto, ctx: SvgContext): string {
  const points = entry.points;
  if (!points || points.length < 2) return boxShape(entry, ctx);
  const stroke = strokeFor(entry);
  const pts = points.map(([x, y]) => `${num(x)},${num(y)}`).join(' ');
  let out = `<polyline points="${pts}" fill="none"${stroke}/>`;
  if (entry.detail.type === 'arrow') {
    const width = Number.isFinite(entry.strokeWidth) ? entry.strokeWidth : 1;
    const paint = isTransparent(entry.strokeColor) ? 'transparent' : entry.strokeColor;
    const n = points.length;
    if (entry.detail.end != null && n >= 2) out += svgHeadMarker(points[n - 2], points[n - 1], width, paint, entry.detail.end);
    if (entry.detail.start != null && n >= 2) out += svgHeadMarker(points[1], points[0], width, paint, entry.detail.start);
  }
  return out;
}

function freedrawPath(entry: DrawEntryDto, ctx: SvgContext): string {
  const points = entry.points;
  if (!points || points.length < 2) return boxShape(entry, ctx);
  const stroke = strokeFor(entry);
  let d = `M ${num(points[0][0])} ${num(points[0][1])}`;
  if (points.length === 2) {
    d += ` L ${num(points[1][0])} ${num(points[1][1])}`;
  } else {
    for (let i = 1; i < points.length - 1; i++) {
      const curr = points[i];
      const next = points[i + 1];
      d += ` Q ${num(curr[0])} ${num(curr[1])} ${num((curr[0] + next[0]) / 2)} ${num((curr[1] + next[1]) / 2)}`;
    }
    const last = points[points.length - 1];
    d += ` L ${num(last[0])} ${num(last[1])}`;
  }
  return `<path d="${d}" fill="none"${stroke}/>`;
}

function textShape(entry: DrawEntryDto, ctx: SvgContext): string {
  if (entry.detail.type !== 'text') return boxShape(entry, ctx);
  const detail = entry.detail;
  const frame = paintFrame(entry);
  const w = frame.maxX - frame.minX;
  const h = frame.maxY - frame.minY;
  const { attr: fill } = fillFor(entry, ctx);
  let out = `<rect x="${num(frame.minX)}" y="${num(frame.minY)}" width="${num(w)}" height="${num(h)}"${fill} stroke="none"/>`;
  const border = (detail.borderColor ?? '').trim();
  if (border !== '' && border.toLowerCase() !== 'transparent') {
    const width = Number.isFinite(entry.strokeWidth) ? entry.strokeWidth : 1;
    let dash = '';
    if (entry.strokeStyle === 'dashed') dash = ` stroke-dasharray="${num(width * 3)} ${num(width * 2)}"`;
    else if (entry.strokeStyle === 'dotted') dash = ` stroke-dasharray="${num(width)} ${num(width)}"`;
    out += `<rect x="${num(frame.minX)}" y="${num(frame.minY)}" width="${num(w)}" height="${num(h)}" fill="none" stroke="${escapeXml(detail.borderColor as string)}" stroke-width="${num(width)}"${dash}/>`;
  }
  const anchorX =
    detail.align === 'center'
      ? (frame.minX + frame.maxX) / 2
      : detail.align === 'right'
        ? frame.maxX
        : frame.minX;
  const anchor = detail.align === 'center' ? 'middle' : detail.align === 'right' ? 'end' : 'start';
  const glyphFill = isTransparent(entry.strokeColor) ? TEXT_FALLBACK_FILL : entry.strokeColor;
  const fontSize = Number.isFinite(detail.fontSize) ? detail.fontSize : 16;
  const lineHeight = fontSize * 1.25;
  const lines = detail.text.split('\n');
  const spans = lines
    .map((line, i) => `<tspan x="${num(anchorX)}" dy="${num(i === 0 ? 0 : lineHeight)}">${escapeXml(line)}</tspan>`)
    .join('');
  out += `<text x="${num(anchorX)}" y="${num(frame.minY)}" font-size="${num(fontSize)}" font-family="${escapeXml(detail.fontFamily)}, sans-serif" text-anchor="${anchor}" dominant-baseline="hanging" fill="${escapeXml(glyphFill)}">${spans}</text>`;
  return out;
}

function pathShape(entry: DrawEntryDto, ctx: SvgContext): string {
  const segments = entry.segments;
  if (!segments || segments.length < 2) return boxShape(entry, ctx);
  const stroke = strokeFor(entry);
  let d = `M ${num(segments[0].point[0])} ${num(segments[0].point[1])}`;
  for (let i = 1; i < segments.length; i++) {
    const prev = segments[i - 1];
    const curr = segments[i];
    const out = prev.handleOut ?? prev.point;
    const inn = curr.handleIn ?? curr.point;
    d += ` C ${num(out[0])} ${num(out[1])} ${num(inn[0])} ${num(inn[1])} ${num(curr.point[0])} ${num(curr.point[1])}`;
  }
  const closed = entry.detail.type === 'path' && entry.detail.closed;
  if (closed) {
    d += ' Z';
    const { attr: fill } = fillFor(entry, ctx);
    return `<path d="${d}"${fill}${stroke}/>`;
  }
  return `<path d="${d}" fill="none"${stroke}/>`;
}

function imageExtras(entry: DrawEntryDto): string {
  const frame = paintFrame(entry);
  const cross =
    `<line x1="${num(frame.minX)}" y1="${num(frame.minY)}" x2="${num(frame.maxX)}" y2="${num(frame.maxY)}" stroke="${PLACEHOLDER_STROKE}" stroke-width="1"/>` +
    `<line x1="${num(frame.maxX)}" y1="${num(frame.minY)}" x2="${num(frame.minX)}" y2="${num(frame.maxY)}" stroke="${PLACEHOLDER_STROKE}" stroke-width="1"/>`;
  const label =
    entry.detail.type === 'image' && entry.detail.assetId
      ? `image: ${entry.detail.assetId}`
      : 'image (no asset store in desktop)';
  return cross + `<text x="${num(frame.minX + 4)}" y="${num(frame.minY + 4)}" font-size="10" font-family="sans-serif" dominant-baseline="hanging" fill="${PLACEHOLDER_STROKE}">${escapeXml(label)}</text>`;
}

function frameLabel(entry: DrawEntryDto): string {
  if (entry.detail.type !== 'frame') return '';
  const frame = paintFrame(entry);
  return `<text x="${num(frame.minX + 2)}" y="${num(frame.minY - 2)}" font-size="11" font-family="sans-serif" dominant-baseline="auto" fill="${ANNOTATION_FILL}">${escapeXml(entry.detail.name)}</text>`;
}

function typeLabel(entry: DrawEntryDto): string {
  const name = entry.detail.type === 'custom' ? entry.detail.typeName : entry.kind;
  const frame = paintFrame(entry);
  return `<text x="${num(frame.minX + 4)}" y="${num(frame.minY + 4)}" font-size="10" font-family="sans-serif" dominant-baseline="hanging" fill="${ANNOTATION_FILL}">${escapeXml(name)}</text>`;
}

function entryInner(entry: DrawEntryDto, ctx: SvgContext): string {
  switch (entry.kind) {
    case 'rectangle':
      return boxShape(entry, ctx);
    case 'frame':
      return boxShape(entry, ctx) + frameLabel(entry);
    case 'image':
      return boxShape(entry, ctx) + imageExtras(entry);
    case 'instance':
    case 'custom':
      return boxShape(entry, ctx) + typeLabel(entry);
    case 'ellipse': {
      const frame = paintFrame(entry);
      const cx = (frame.minX + frame.maxX) / 2;
      const cy = (frame.minY + frame.maxY) / 2;
      const rx = Math.max((frame.maxX - frame.minX) / 2, 0);
      const ry = Math.max((frame.maxY - frame.minY) / 2, 0);
      const { attr: fill } = fillFor(entry, ctx);
      const stroke = strokeFor(entry);
      return `<ellipse cx="${num(cx)}" cy="${num(cy)}" rx="${num(rx)}" ry="${num(ry)}"${fill}${stroke}/>`;
    }
    case 'line':
    case 'arrow':
      return polylineShape(entry, ctx);
    case 'freedraw':
      return freedrawPath(entry, ctx);
    case 'text':
      return textShape(entry, ctx);
    case 'path':
      return pathShape(entry, ctx);
    default:
      return boxShape(entry, ctx);
  }
}

function entrySvg(entry: DrawEntryDto, ctx: SvgContext): string {
  return wrapEntry(entry, entryInner(entry, ctx));
}

function framePassSvg(frame: DrawEntryDto, children: DrawEntryDto[], ctx: SvgContext): string {
  const head = entrySvg(frame, ctx);
  if (children.length === 0) return head;
  const kids = children.map((child) => entrySvg(child, ctx)).join('');
  const clip = frame.detail.type === 'frame' ? frame.detail.clipContent : true;
  if (!clip) return head + kids;
  const clipFrame = frame.frame ?? frame.bounds;
  const clipId = `clip-${sanitizeId(frame.id)}-${ctx.seq++}`;
  ctx.defs.push(
    `<clipPath id="${clipId}"><rect x="${num(clipFrame.minX)}" y="${num(clipFrame.minY)}" width="${num(clipFrame.maxX - clipFrame.minX)}" height="${num(clipFrame.maxY - clipFrame.minY)}"/></clipPath>`,
  );
  return head + `<g clip-path="url(#${clipId})">${kids}</g>`;
}

/** Builds a standalone SVG document for one export rect without touching the live session. */
export function buildSvgString(rect: PngExportRect, model: RenderModelDto): string {
  const ctx: SvgContext = { defs: [], seq: 0 };
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  const bodies: string[] = [];
  if (rect.background !== 'transparent') {
    bodies.push(
      `<rect x="${num(rect.minX)}" y="${num(rect.minY)}" width="${num(width)}" height="${num(height)}" fill="${escapeXml(rect.background)}" stroke="none"/>`,
    );
  }
  for (const entry of model.base) bodies.push(entrySvg(entry, ctx));
  for (const pass of model.frames) bodies.push(framePassSvg(pass.frame, pass.children, ctx));
  const defs = ctx.defs.length > 0 ? `<defs>${ctx.defs.join('')}</defs>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${num(width)}" height="${num(height)}" viewBox="${num(rect.minX)} ${num(rect.minY)} ${num(width)} ${num(height)}">${defs}${bodies.join('')}</svg>`;
}

/** Full SVG export: plan, render-model query, and serialize (the caller downloads). */
export async function exportSvgImage(engine: Engine, canvas: ProjectCanvas): Promise<Blob> {
  const rect = await planExportRect(engine, canvas);
  const model = await queryExportModel(engine, rect);
  const text = buildSvgString(rect, { ...model, selection: null, snapGuides: [] });
  return new Blob([text], { type: 'image/svg+xml;charset=utf-8' });
}

/** File-safe export name for a project. */
export function svgFileName(projectName: string): string {
  const clean = projectName.replace(/[\\/:"*?<>|]/g, '-').trim() || 'grafalith';
  return `${clean}.svg`;
}
