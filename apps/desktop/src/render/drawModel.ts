import type {
  DrawEntryDto,
  RenderModelDto,
  SnapGuideDto,
  ViewportDto,
} from '../hooks/useEngine';
import { themeTokens } from '../app/theme/tokens';

/**
 * Live ghost preview for one frame. The host owns the cursor locally (it
 * sent every move); committed geometry comes from the engine model. Move
 * deltas, resize boxes, and rotation angles arrive from the read-only
 * `previewMove`/`previewResize`/`previewRotate` queries — the same math as
 * the commit path — so the host never reimplements transform semantics.
 */
export type GhostPreview =
  | { kind: 'none' }
  /** Shape-draw drag: origin → cursor (commit math: normalized box / diagonal). */
  | { kind: 'draw'; shape: string; origin: [number, number]; cursor: [number, number] }
  /** Rubber-band drag: translucent rect. */
  | { kind: 'rubber'; origin: [number, number]; cursor: [number, number] }
  /** Freedraw stroke: live trail in scene coords (origin first). */
  | { kind: 'freedraw'; trail: [number, number][] }
  /** Move drag: committed entries shifted by the snapped delta. */
  | { kind: 'move'; affected: string[]; dx: number; dy: number }
  /** Resize drag: engine-computed box outline (content repaints on commit). */
  | { kind: 'resize'; box: { x: number; y: number; width: number; height: number } }
  /** Rotate drag: committed entry repainted at the preview angle. */
  | { kind: 'rotate'; id: string; rotation: number };

export const NO_PREVIEW: GhostPreview = { kind: 'none' };

/**
 * Canvas overlay palette (single source).
 *
 * These are scene-contrast colors, intentionally independent of the UI
 * theme tokens: selection and preview strokes must stay legible on both
 * the light (`#f0efec`) and dark (`#141412`) canvas backgrounds, so they
 * do not follow the accent token. The rubber-band fill reuses the
 * selection hue at low alpha instead of duplicating the hex literal.
 */
export const CANVAS_OVERLAY = themeTokens.light.canvasOverlay;

const SELECTION_COLOR = CANVAS_OVERLAY.selection;
const PREVIEW_COLOR = CANVAS_OVERLAY.preview;
const SNAP_COLOR = CANVAS_OVERLAY.snapGuide;
const RUBBER_FILL = CANVAS_OVERLAY.rubberBandFill;
const ARROWHEAD_LENGTH = 12;
const ARROWHEAD_WIDTH = 8;

export function drawRenderModel(
  ctx: CanvasRenderingContext2D,
  model: RenderModelDto,
  cssWidth: number,
  cssHeight: number,
  preview: GhostPreview = NO_PREVIEW,
  editingId: string | null = null,
  liveGuides: SnapGuideDto[] | null = null,
): void {
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  const viewport = model.viewport;
  const { zoom } = viewport;
  ctx.save();
  // screen = (scene + scroll) * zoom — the engine mapping.
  ctx.translate(viewport.scrollX * zoom, viewport.scrollY * zoom);
  ctx.scale(zoom, zoom);

  const skipped = skippedIds(preview, editingId);
  for (const entry of model.base) {
    if (skipped.has(entry.id)) continue;
    drawEntry(ctx, entry);
  }
  for (const pass of model.frames) {
    if (skipped.has(pass.frame.id)) continue;
    drawFramePass(ctx, pass.frame, pass.children, skipped);
  }

  drawGhost(ctx, model, preview);

  if (model.selection) {
    drawSelectionOverlay(ctx, model.selection, zoom);
  }

  const guides = liveGuides ?? model.snapGuides;
  if (guides.length > 0) {
    drawSnapGuides(ctx, guides);
  }

  ctx.restore();
}

function skippedIds(preview: GhostPreview, editingId: string | null): Set<string> {
  const skipped = new Set<string>();
  if (editingId) skipped.add(editingId);
  if (preview.kind === 'move') {
    for (const id of preview.affected) skipped.add(id);
  } else if (preview.kind === 'rotate') {
    skipped.add(preview.id);
  }
  return skipped;
}

function findEntry(model: RenderModelDto, id: string): DrawEntryDto | null {
  for (const entry of model.base) {
    if (entry.id === id) return entry;
  }
  for (const pass of model.frames) {
    if (pass.frame.id === id) return pass.frame;
    for (const child of pass.children) {
      if (child.id === id) return child;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------

function drawEntry(ctx: CanvasRenderingContext2D, entry: DrawEntryDto): void {
  switch (entry.kind) {
    case 'rectangle':
    case 'frame':
    case 'image':
    case 'instance':
    case 'custom':
      drawBoxKind(ctx, entry);
      return;
    case 'ellipse':
      drawEllipseKind(ctx, entry);
      return;
    case 'line':
      drawPolyline(ctx, entry, false);
      return;
    case 'arrow':
      drawPolyline(ctx, entry, true);
      return;
    case 'freedraw':
      drawFreedraw(ctx, entry);
      return;
    case 'text':
      drawTextKind(ctx, entry);
      return;
    case 'path':
      drawPathKind(ctx, entry);
      return;
    default:
      drawBoxKind(ctx, entry);
  }
}

function applyPaint(ctx: CanvasRenderingContext2D, entry: DrawEntryDto): void {
  ctx.globalAlpha = entry.opacity / 100;
  ctx.fillStyle = CANVAS_OVERLAY.fallbackFill;
  ctx.strokeStyle = entry.strokeColor;
  ctx.lineWidth = entry.strokeWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  applyDash(ctx, entry);
}

function applyDash(ctx: CanvasRenderingContext2D, entry: DrawEntryDto): void {
  const w = entry.strokeWidth;
  if (entry.strokeStyle === 'dashed') {
    ctx.setLineDash([w * 3, w * 2]);
  } else if (entry.strokeStyle === 'dotted') {
    ctx.setLineDash([w, w]);
  } else {
    ctx.setLineDash([]);
  }
}

function fillPath(ctx: CanvasRenderingContext2D, entry: DrawEntryDto): void {
  const { paint } = entry;
  if (paint.type === 'solid') {
    if (paint.color === 'transparent') return;
    ctx.fillStyle = paint.color;
    ctx.fill();
    return;
  }
  const { bounds } = entry;
  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxY - bounds.minY;
  const maxDim = Math.max(w, h);
  let gradient: CanvasGradient;
  if (paint.type === 'linear') {
    const angleRad = (paint.angle * Math.PI) / 180;
    const half = maxDim / 2;
    gradient = ctx.createLinearGradient(
      -half * Math.cos(angleRad),
      -half * Math.sin(angleRad),
      half * Math.cos(angleRad),
      half * Math.sin(angleRad),
    );
  } else {
    gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, maxDim / 2);
  }
  for (const stop of paint.stops) {
    gradient.addColorStop(stop.offset, stop.color);
  }
  ctx.fillStyle = gradient;
  ctx.fill();
}

function withRotation<T>(ctx: CanvasRenderingContext2D, entry: DrawEntryDto, body: () => T): T {
  const { bounds, rotation } = entry;
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rotation);
  ctx.translate(-cx, -cy);
  try {
    return body();
  } finally {
    ctx.restore();
  }
}

function drawBoxKind(ctx: CanvasRenderingContext2D, entry: DrawEntryDto): void {
  withRotation(ctx, entry, () => {
    applyPaint(ctx, entry);
    const { bounds } = entry;
    const w = bounds.maxX - bounds.minX;
    const h = bounds.maxY - bounds.minY;
    ctx.beginPath();
    ctx.rect(bounds.minX, bounds.minY, w, h);
    fillPath(ctx, entry);
    ctx.beginPath();
    ctx.rect(bounds.minX, bounds.minY, w, h);
    ctx.stroke();
    if (entry.kind === 'image') {
      drawImagePlaceholder(ctx, entry);
    } else if (entry.kind === 'frame') {
      drawFrameLabel(ctx, entry);
    } else if (entry.kind === 'instance' || entry.kind === 'custom') {
      drawTypeLabel(ctx, entry);
    }
  });
}

function drawEllipseKind(ctx: CanvasRenderingContext2D, entry: DrawEntryDto): void {
  withRotation(ctx, entry, () => {
    applyPaint(ctx, entry);
    const { bounds } = entry;
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    const rx = (bounds.maxX - bounds.minX) / 2;
    const ry = (bounds.maxY - bounds.minY) / 2;
    ctx.beginPath();
    ctx.ellipse(cx, cy, Math.max(rx, 0), Math.max(ry, 0), 0, 0, Math.PI * 2);
    fillPath(ctx, entry);
    ctx.beginPath();
    ctx.ellipse(cx, cy, Math.max(rx, 0), Math.max(ry, 0), 0, 0, Math.PI * 2);
    ctx.stroke();
  });
}

function tracePolyline(ctx: CanvasRenderingContext2D, points: [number, number][]): void {
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i][0], points[i][1]);
  }
}

function drawPolyline(ctx: CanvasRenderingContext2D, entry: DrawEntryDto, arrowheads: boolean): void {
  const points = entry.points;
  if (!points || points.length < 2) {
    // Degenerate stroke: fall back to the bounds outline so something visible remains.
    drawBoxKind(ctx, entry);
    return;
  }
  withRotation(ctx, entry, () => {
    applyPaint(ctx, entry);
    tracePolyline(ctx, points);
    ctx.stroke();
    if (!arrowheads || entry.detail.type !== 'arrow') return;
    ctx.setLineDash([]);
    ctx.fillStyle = entry.strokeColor;
    const n = points.length;
    if (entry.detail.hasEnd && n >= 2) {
      drawArrowhead(ctx, points[n - 2], points[n - 1], entry.strokeWidth);
    }
    if (entry.detail.hasStart && n >= 2) {
      drawArrowhead(ctx, points[1], points[0], entry.strokeWidth);
    }
  });
}

function drawArrowhead(
  ctx: CanvasRenderingContext2D,
  from: [number, number],
  tip: [number, number],
  strokeWidth: number,
): void {
  // TS arrow.ts parity: len 12 × scale, width 8 × scale, scale = max(1, w/2).
  const scale = Math.max(1, strokeWidth / 2);
  const len = ARROWHEAD_LENGTH * scale;
  const width = ARROWHEAD_WIDTH * scale;
  const dx = tip[0] - from[0];
  const dy = tip[1] - from[1];
  const angle = Math.atan2(dy, dx);
  const baseX = tip[0] - Math.cos(angle) * len;
  const baseY = tip[1] - Math.sin(angle) * len;
  const leftX = baseX + Math.cos(angle + Math.PI / 2) * (width / 2);
  const leftY = baseY + Math.sin(angle + Math.PI / 2) * (width / 2);
  const rightX = baseX + Math.cos(angle - Math.PI / 2) * (width / 2);
  const rightY = baseY + Math.sin(angle - Math.PI / 2) * (width / 2);
  ctx.beginPath();
  ctx.moveTo(tip[0], tip[1]);
  ctx.lineTo(leftX, leftY);
  ctx.lineTo(rightX, rightY);
  ctx.closePath();
  ctx.fill();
}

function drawFreedraw(ctx: CanvasRenderingContext2D, entry: DrawEntryDto): void {
  const points = entry.points;
  if (!points || points.length < 2) {
    drawBoxKind(ctx, entry);
    return;
  }
  withRotation(ctx, entry, () => {
    applyPaint(ctx, entry);
    // TS freedraw.ts parity: quadratic smoothing through midpoints.
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    if (points.length === 2) {
      ctx.lineTo(points[1][0], points[1][1]);
    } else {
      for (let i = 1; i < points.length - 1; i++) {
        const curr = points[i];
        const next = points[i + 1];
        ctx.quadraticCurveTo(curr[0], curr[1], (curr[0] + next[0]) / 2, (curr[1] + next[1]) / 2);
      }
      const last = points[points.length - 1];
      ctx.lineTo(last[0], last[1]);
    }
    ctx.stroke();
  });
}

function drawTextKind(ctx: CanvasRenderingContext2D, entry: DrawEntryDto): void {
  const detail = entry.detail;
  if (detail.type !== 'text') {
    drawBoxKind(ctx, entry);
    return;
  }
  withRotation(ctx, entry, () => {
    applyPaint(ctx, entry);
    const { bounds } = entry;
    ctx.fillStyle = entry.strokeColor;
    ctx.font = `${detail.fontSize}px ${detail.fontFamily}`;
    ctx.textBaseline = 'top';
    const lines = detail.text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], bounds.minX, bounds.minY + i * detail.fontSize * 1.25);
    }
  });
}

function drawPathKind(ctx: CanvasRenderingContext2D, entry: DrawEntryDto): void {
  const segments = entry.segments;
  if (!segments || segments.length < 2) {
    drawBoxKind(ctx, entry);
    return;
  }
  withRotation(ctx, entry, () => {
    applyPaint(ctx, entry);
    ctx.beginPath();
    ctx.moveTo(segments[0].point[0], segments[0].point[1]);
    for (let i = 1; i < segments.length; i++) {
      const prev = segments[i - 1];
      const curr = segments[i];
      const out = prev.handleOut ?? prev.point;
      const inn = curr.handleIn ?? curr.point;
      ctx.bezierCurveTo(out[0], out[1], inn[0], inn[1], curr.point[0], curr.point[1]);
    }
    if (entry.detail.type === 'path' && entry.detail.closed) {
      ctx.closePath();
      fillPath(ctx, entry);
    }
    ctx.stroke();
  });
}

function drawImagePlaceholder(ctx: CanvasRenderingContext2D, entry: DrawEntryDto): void {
  const { bounds } = entry;
  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxY - bounds.minY;
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = CANVAS_OVERLAY.placeholderStroke;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(bounds.minX, bounds.minY);
  ctx.lineTo(bounds.maxX, bounds.maxY);
  ctx.moveTo(bounds.maxX, bounds.minY);
  ctx.lineTo(bounds.minX, bounds.maxY);
  ctx.stroke();
  ctx.fillStyle = CANVAS_OVERLAY.placeholderStroke;
  ctx.font = '10px sans-serif';
  ctx.textBaseline = 'top';
  const label = entry.detail.type === 'image' && entry.detail.assetId
    ? `image: ${entry.detail.assetId}`
    : 'image (no asset store in desktop)';
  ctx.fillText(label, bounds.minX + 4, bounds.minY + 4, Math.max(w - 8, 0));
  void h;
  ctx.restore();
}

function drawFrameLabel(ctx: CanvasRenderingContext2D, entry: DrawEntryDto): void {
  if (entry.detail.type !== 'frame') return;
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.fillStyle = CANVAS_OVERLAY.annotationMuted;
  ctx.font = '11px sans-serif';
  ctx.textBaseline = 'bottom';
  ctx.fillText(entry.detail.name, entry.bounds.minX + 2, entry.bounds.minY - 2);
  ctx.restore();
}

function drawTypeLabel(ctx: CanvasRenderingContext2D, entry: DrawEntryDto): void {
  const name = entry.detail.type === 'custom' ? entry.detail.typeName : entry.kind;
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.fillStyle = CANVAS_OVERLAY.annotationMuted;
  ctx.font = '10px sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillText(name, entry.bounds.minX + 4, entry.bounds.minY + 4);
  ctx.restore();
}

function drawFramePass(
  ctx: CanvasRenderingContext2D,
  frame: DrawEntryDto,
  children: DrawEntryDto[],
  skipped: Set<string>,
): void {
  drawBoxKind(ctx, frame);
  const clip = frame.detail.type === 'frame' ? frame.detail.clipContent : true;
  if (!clip) {
    for (const child of children) {
      if (skipped.has(child.id)) continue;
      drawEntry(ctx, child);
    }
    return;
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(frame.bounds.minX, frame.bounds.minY, frame.bounds.maxX - frame.bounds.minX, frame.bounds.maxY - frame.bounds.minY);
  ctx.clip();
  for (const child of children) {
    if (skipped.has(child.id)) continue;
    drawEntry(ctx, child);
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Ghost previews (host presentation — engine owns the numbers)
// ---------------------------------------------------------------------------

function drawGhost(ctx: CanvasRenderingContext2D, model: RenderModelDto, preview: GhostPreview): void {
  switch (preview.kind) {
    case 'none':
      return;
    case 'draw':
      drawShapePreview(ctx, preview.shape, preview.origin, preview.cursor);
      return;
    case 'rubber':
      drawRubberPreview(ctx, preview.origin, preview.cursor);
      return;
    case 'freedraw':
      drawFreedrawPreview(ctx, preview.trail);
      return;
    case 'move': {
      ctx.save();
      ctx.globalAlpha = 0.75;
      for (const id of preview.affected) {
        const entry = findEntry(model, id);
        if (!entry) continue;
        ctx.save();
        ctx.translate(preview.dx, preview.dy);
        drawEntry(ctx, entry);
        ctx.restore();
      }
      ctx.restore();
      return;
    }
    case 'resize':
      drawResizePreview(ctx, preview.box);
      return;
    case 'rotate': {
      const entry = findEntry(model, preview.id);
      if (!entry) return;
      drawEntry(ctx, { ...entry, rotation: preview.rotation });
      return;
    }
  }
}

function drawShapePreview(
  ctx: CanvasRenderingContext2D,
  shape: string,
  origin: [number, number],
  cursor: [number, number],
): void {
  ctx.save();
  ctx.strokeStyle = PREVIEW_COLOR;
  ctx.fillStyle = PREVIEW_COLOR;
  ctx.globalAlpha = 0.8;
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 5]);
  if (shape === 'ellipse') {
    const cx = (origin[0] + cursor[0]) / 2;
    const cy = (origin[1] + cursor[1]) / 2;
    ctx.beginPath();
    ctx.ellipse(cx, cy, Math.abs(cursor[0] - origin[0]) / 2, Math.abs(cursor[1] - origin[1]) / 2, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (shape === 'line' || shape === 'arrow') {
    ctx.beginPath();
    ctx.moveTo(origin[0], origin[1]);
    ctx.lineTo(cursor[0], cursor[1]);
    ctx.stroke();
    if (shape === 'arrow') {
      ctx.setLineDash([]);
      drawArrowhead(ctx, origin, cursor, 2);
    }
  } else {
    // rectangle / frame / image: normalized box (commit math parity).
    const x = Math.min(origin[0], cursor[0]);
    const y = Math.min(origin[1], cursor[1]);
    ctx.strokeRect(x, y, Math.abs(cursor[0] - origin[0]), Math.abs(cursor[1] - origin[1]));
  }
  ctx.restore();
}

function drawRubberPreview(ctx: CanvasRenderingContext2D, origin: [number, number], cursor: [number, number]): void {
  const x = Math.min(origin[0], cursor[0]);
  const y = Math.min(origin[1], cursor[1]);
  const w = Math.abs(cursor[0] - origin[0]);
  const h = Math.abs(cursor[1] - origin[1]);
  ctx.save();
  ctx.fillStyle = RUBBER_FILL;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = PREVIEW_COLOR;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
}

function drawFreedrawPreview(ctx: CanvasRenderingContext2D, trail: [number, number][]): void {
  if (trail.length === 0) return;
  ctx.save();
  ctx.strokeStyle = PREVIEW_COLOR;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(trail[0][0], trail[0][1]);
  if (trail.length === 2) {
    ctx.lineTo(trail[1][0], trail[1][1]);
  } else {
    for (let i = 1; i < trail.length - 1; i++) {
      const curr = trail[i];
      const next = trail[i + 1];
      ctx.quadraticCurveTo(curr[0], curr[1], (curr[0] + next[0]) / 2, (curr[1] + next[1]) / 2);
    }
    const last = trail[trail.length - 1];
    ctx.lineTo(last[0], last[1]);
  }
  ctx.stroke();
  ctx.restore();
}

function drawResizePreview(
  ctx: CanvasRenderingContext2D,
  box: { x: number; y: number; width: number; height: number },
): void {
  // The box itself is engine-computed (previewResize); the host only outlines
  // it. Content repaints on commit — see the discovery doc §15.
  ctx.save();
  ctx.strokeStyle = PREVIEW_COLOR;
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 5]);
  ctx.strokeRect(box.x, box.y, box.width, box.height);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Overlays (drawn INSIDE the viewport transform — scene units)
// ---------------------------------------------------------------------------

function drawSelectionOverlay(
  ctx: CanvasRenderingContext2D,
  overlay: NonNullable<RenderModelDto['selection']>,
  zoom: number,
): void {
  const { bounds, handles, rotateHandle, rotation } = overlay;
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rotation);
  ctx.translate(-cx, -cy);
  ctx.strokeStyle = SELECTION_COLOR;
  ctx.lineWidth = 1 / zoom;
  ctx.strokeRect(bounds.minX, bounds.minY, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  for (const [x, y] of handles) {
    ctx.fillStyle = CANVAS_OVERLAY.handleFill;
    ctx.strokeStyle = SELECTION_COLOR;
    ctx.lineWidth = 1 / zoom;
    ctx.beginPath();
    ctx.arc(x, y, 4 / zoom, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.fillStyle = CANVAS_OVERLAY.handleFill;
  ctx.strokeStyle = SELECTION_COLOR;
  ctx.lineWidth = 1 / zoom;
  ctx.beginPath();
  ctx.arc(rotateHandle[0], rotateHandle[1], 5 / zoom, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawSnapGuides(ctx: CanvasRenderingContext2D, guides: SnapGuideDto[]): void {
  ctx.save();
  ctx.strokeStyle = SNAP_COLOR;
  ctx.lineWidth = 1;
  for (const guide of guides) {
    ctx.beginPath();
    ctx.moveTo(guide.startX, guide.startY);
    ctx.lineTo(guide.endX, guide.endY);
    ctx.stroke();
  }
  ctx.restore();
}

export type { ViewportDto };
