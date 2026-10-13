import type {
  DrawEntryDto,
  PaintDto,
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
  /**
   * Resize drag: box kinds repaint live inside the engine-computed box
   * while the selection overlay morphs onto it; point kinds
   * (line/arrow/freedraw/path) keep the dashed outline since their
   * vertices need the commit.
   */
  | {
      kind: 'resize';
      id: string;
      box: { x: number; y: number; width: number; height: number };
      fontSize: number | null;
    }
  /** Rotate drag: committed entry repainted at the preview angle. */
  | { kind: 'rotate'; id: string; rotation: number }
  /**
   * Fill drag: entries repainted with an uncommitted fill (inspector stop
   * drag). The engine is untouched until release commits once, so this
   * preview is the only live picture — painted at full opacity.
   */
  | { kind: 'fill'; ids: string[]; paint: PaintDto };

export const NO_PREVIEW: GhostPreview = { kind: 'none' };

/**
 * Uncommitted fill preview shared from the inspector to the canvas loop by
 * ref (never React state, so drags repaint without re-rendering). Cleared
 * on commit, cancel, or popover close so no stale preview can stick.
 */
export interface FillPreview {
  /** Entries repainted with the preview fill. */
  ids: string[];
  /** Uncommitted paint, same shape the committed entries carry. */
  paint: PaintDto;
}

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
  /** True when the selection is a single text element: corner handles show. */
  textSingleSelection = false,
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
    // The box travels with the gesture for every drag kind: shifted by the
    // move delta, morphed to the resize box, rotated to the preview angle.
    // Object and box stay one unit while dragging, for every element kind.
    if (preview.kind === 'move') {
      drawSelectionOverlay(
        ctx,
        model.selection,
        zoom,
        textSingleSelection,
        { dx: preview.dx, dy: preview.dy },
      );
    } else if (preview.kind === 'resize') {
      drawSelectionOverlay(
        ctx,
        overlayForResize(model.selection, preview.box),
        zoom,
        textSingleSelection,
        null,
      );
    } else if (preview.kind === 'rotate') {
      drawSelectionOverlay(
        ctx,
        { ...model.selection, rotation: preview.rotation },
        zoom,
        textSingleSelection,
        null,
      );
    } else {
      drawSelectionOverlay(ctx, model.selection, zoom, textSingleSelection, null);
    }
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
  } else if (preview.kind === 'resize') {
    skipped.add(preview.id);
  } else if (preview.kind === 'fill') {
    for (const id of preview.ids) skipped.add(id);
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

/** Kinds painted from bounds alone (safe to repaint inside a preview box). */
function isBoxKind(kind: string): boolean {
  return (
    kind === 'rectangle' ||
    kind === 'ellipse' ||
    kind === 'text' ||
    kind === 'frame' ||
    kind === 'image' ||
    kind === 'instance' ||
    kind === 'custom'
  );
}

/** Entry repainted inside a preview box (text with the preview font size). */
function resizedEntry(
  entry: DrawEntryDto,
  box: { x: number; y: number; width: number; height: number },
  fontSize: number | null,
): DrawEntryDto {
  const frame = { minX: box.x, minY: box.y, maxX: box.x + box.width, maxY: box.y + box.height };
  // The preview box is the unrotated frame; mirror it onto `bounds` too so
  // legacy readers stay coherent (paint reads `frame`, culling reads `bounds`).
  const bounds = { ...frame };
  if (entry.detail.type === 'text' && typeof fontSize === 'number' && Number.isFinite(fontSize)) {
    return { ...entry, bounds, frame, detail: { ...entry.detail, fontSize } };
  }
  return { ...entry, bounds, frame };
}

/**
 * Paint/chrome frame for an entry: unrotated box when the engine provides
 * it, `bounds` fallback for cached/legacy models. All shape extents paint
 * from here; `bounds` stays the rotation-aware AABB for culling only.
 */
function paintFrame(entry: DrawEntryDto): DrawEntryDto['bounds'] {
  return entry.frame ?? entry.bounds;
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
  // Gradient extents derive from the unrotated frame so the fill does not
  // pulse when the element rotates (the AABB grows at non-90° angles).
  const frame = paintFrame(entry);
  const { x0, y0, x1, y1, cx, cy, radius } = gradientGeometry(frame, paint.type === 'linear' ? paint.angle : 0);
  let gradient: CanvasGradient;
  if (paint.type === 'linear') {
    gradient = ctx.createLinearGradient(x0, y0, x1, y1);
  } else {
    gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  }
  for (const stop of paint.stops) {
    gradient.addColorStop(stop.offset, stop.color);
  }
  ctx.fillStyle = gradient;
  ctx.fill();
}

/**
 * Gradient endpoints over an unrotated frame: linear runs center ±
 * cos/sin(angle°) · max(w,h)/2 and radial spans center to max(w,h)/2,
 * exactly the engine contract hosts must rebuild. Centered on the frame —
 * endpoints around the scene origin would sample a clamped slice for any
 * shape away from origin, so stop edits would not show on the object.
 */
export function gradientGeometry(
  frame: { minX: number; minY: number; maxX: number; maxY: number },
  angleDeg: number,
): { cx: number; cy: number; x0: number; y0: number; x1: number; y1: number; radius: number } {
  const cx = (frame.minX + frame.maxX) / 2;
  const cy = (frame.minY + frame.maxY) / 2;
  const radius = Math.max(frame.maxX - frame.minX, frame.maxY - frame.minY) / 2;
  const safeAngle = Number.isFinite(angleDeg) ? angleDeg : 0;
  const angleRad = (safeAngle * Math.PI) / 180;
  const dx = Math.cos(angleRad) * radius;
  const dy = Math.sin(angleRad) * radius;
  return { cx, cy, x0: cx - dx, y0: cy - dy, x1: cx + dx, y1: cy + dy, radius };
}

function withRotation<T>(ctx: CanvasRenderingContext2D, entry: DrawEntryDto, body: () => T): T {
  // Rotate about the unrotated frame center (== AABB center for
  // center-rotated boxes). Using the AABB center with AABB dims would
  // double-apply the rotation and grow the shape at non-90° angles.
  const frame = paintFrame(entry);
  const cx = (frame.minX + frame.maxX) / 2;
  const cy = (frame.minY + frame.maxY) / 2;
  const { rotation } = entry;
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
    const frame = paintFrame(entry);
    const w = frame.maxX - frame.minX;
    const h = frame.maxY - frame.minY;
    ctx.beginPath();
    ctx.rect(frame.minX, frame.minY, w, h);
    fillPath(ctx, entry);
    ctx.beginPath();
    ctx.rect(frame.minX, frame.minY, w, h);
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
    const frame = paintFrame(entry);
    const cx = (frame.minX + frame.maxX) / 2;
    const cy = (frame.minY + frame.maxY) / 2;
    const rx = (frame.maxX - frame.minX) / 2;
    const ry = (frame.maxY - frame.minY) / 2;
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
    ctx.strokeStyle = entry.strokeColor;
    const n = points.length;
    if (entry.detail.end != null && n >= 2) {
      drawArrowMarker(ctx, points[n - 2], points[n - 1], entry.strokeWidth, entry.detail.end);
    }
    if (entry.detail.start != null && n >= 2) {
      drawArrowMarker(ctx, points[1], points[0], entry.strokeWidth, entry.detail.start);
    }
  });
}

/**
 * Head marker by wire style: triangle for `arrow`, a perpendicular tick
 * for `bar`, a filled disc for `dot`. Unknown non-null markers stay
 * visible as triangles rather than silently dropping the head.
 */
function drawArrowMarker(
  ctx: CanvasRenderingContext2D,
  from: [number, number],
  tip: [number, number],
  strokeWidth: number,
  marker: string,
): void {
  const scale = Math.max(1, strokeWidth / 2);
  if (marker === 'dot') {
    ctx.beginPath();
    ctx.arc(tip[0], tip[1], (ARROWHEAD_WIDTH * scale) / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  if (marker === 'bar') {
    const dx = tip[0] - from[0];
    const dy = tip[1] - from[1];
    const len = Math.hypot(dx, dy);
    if (len === 0) return;
    const half = (ARROWHEAD_WIDTH * scale) / 2;
    const nx = (-dy / len) * half;
    const ny = (dx / len) * half;
    ctx.lineWidth = strokeWidth;
    ctx.beginPath();
    ctx.moveTo(tip[0] - nx, tip[1] - ny);
    ctx.lineTo(tip[0] + nx, tip[1] + ny);
    ctx.stroke();
    return;
  }
  drawArrowhead(ctx, from, tip, strokeWidth);
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
    // Text is a foreground paint, not a filled shape. Keep this path
    // independent from the element background so a transparent fill cannot
    // make committed glyphs disappear.
    ctx.save();
    ctx.globalAlpha = normalizedOpacity(entry.opacity);
    ctx.globalCompositeOperation = 'source-over';
    const frame = paintFrame(entry);
    const w = frame.maxX - frame.minX;
    const h = frame.maxY - frame.minY;
    // Background follows the content-driven box, so it grows with new lines.
    ctx.beginPath();
    ctx.rect(frame.minX, frame.minY, w, h);
    fillPath(ctx, entry);
    // Box outline keeps its own color while reusing the entry stroke
    // width/style, leaving the stroke color free for the glyphs.
    const border = detail.borderColor?.trim() ?? '';
    if (border !== '' && border.toLowerCase() !== 'transparent') {
      ctx.strokeStyle = detail.borderColor as string;
      ctx.lineWidth = entry.strokeWidth;
      applyDash(ctx, entry);
      ctx.beginPath();
      ctx.rect(frame.minX, frame.minY, w, h);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.fillStyle = textPaintColor(ctx, entry.strokeColor);
    // Same stack as the overlay textarea: engine font first, system sans
    // as fallback so a missing handwriting font never renders blank.
    ctx.font = `${detail.fontSize}px ${detail.fontFamily}, sans-serif`;
    ctx.textBaseline = 'top';
    ctx.textAlign = detail.align;
    // Anchor follows the alignment like the overlay box does: centering
    // around the left edge would push centered text out of its own box.
    const anchorX =
      detail.align === 'center'
        ? (frame.minX + frame.maxX) / 2
        : detail.align === 'right'
          ? frame.maxX
          : frame.minX;
    const lines = detail.text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], anchorX, frame.minY + i * detail.fontSize * 1.25);
    }
    ctx.restore();
  });
}

function normalizedOpacity(opacity: number): number {
  return Number.isFinite(opacity) ? Math.max(0, Math.min(1, opacity / 100)) : 1;
}

function textPaintColor(ctx: CanvasRenderingContext2D, color: string): string {
  if (color.trim() !== '' && color.toLowerCase() !== 'transparent') {
    return color;
  }

  const parent = ctx.canvas.parentElement;
  if (parent && typeof window !== 'undefined') {
    const background = window.getComputedStyle(parent).backgroundColor;
    const match = background.match(
      /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/i,
    );
    if (match) {
      const luminance =
        (0.2126 * Number(match[1]) + 0.7152 * Number(match[2]) + 0.0722 * Number(match[3])) / 255;
      return luminance > 0.5 ? '#000000' : '#ffffff';
    }
  }
  return CANVAS_OVERLAY.fallbackFill;
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
  const frame = paintFrame(entry);
  const w = frame.maxX - frame.minX;
  const h = frame.maxY - frame.minY;
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = CANVAS_OVERLAY.placeholderStroke;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(frame.minX, frame.minY);
  ctx.lineTo(frame.maxX, frame.maxY);
  ctx.moveTo(frame.maxX, frame.minY);
  ctx.lineTo(frame.minX, frame.maxY);
  ctx.stroke();
  ctx.fillStyle = CANVAS_OVERLAY.placeholderStroke;
  ctx.font = '10px sans-serif';
  ctx.textBaseline = 'top';
  const label = entry.detail.type === 'image' && entry.detail.assetId
    ? `image: ${entry.detail.assetId}`
    : 'image (no asset store in desktop)';
  ctx.fillText(label, frame.minX + 4, frame.minY + 4, Math.max(w - 8, 0));
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
  ctx.fillText(entry.detail.name, paintFrame(entry).minX + 2, paintFrame(entry).minY - 2);
  ctx.restore();
}

function drawTypeLabel(ctx: CanvasRenderingContext2D, entry: DrawEntryDto): void {
  const name = entry.detail.type === 'custom' ? entry.detail.typeName : entry.kind;
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.fillStyle = CANVAS_OVERLAY.annotationMuted;
  ctx.font = '10px sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillText(name, paintFrame(entry).minX + 4, paintFrame(entry).minY + 4);
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
  // Clip to the unrotated frame; the AABB would over-clip at non-90° angles.
  const clipFrame = frame.frame ?? frame.bounds;
  ctx.rect(clipFrame.minX, clipFrame.minY, clipFrame.maxX - clipFrame.minX, clipFrame.maxY - clipFrame.minY);
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
    case 'resize': {
      const entry = findEntry(model, preview.id);
      if (entry && isBoxKind(entry.kind)) {
        // Live content: the entry repaints inside the preview box (text
        // with the preview font size), exactly as the commit will store it.
        ctx.save();
        ctx.globalAlpha = 0.75;
        drawEntry(ctx, resizedEntry(entry, preview.box, preview.fontSize));
        ctx.restore();
        return;
      }
      drawResizePreview(ctx, preview.box);
      return;
    }
    case 'rotate': {
      const entry = findEntry(model, preview.id);
      if (!entry) return;
      drawEntry(ctx, { ...entry, rotation: preview.rotation });
      return;
    }
    case 'fill': {
      // Uncommitted fill preview (inspector stop drag): repaint the affected
      // committed entries with the preview paint at full fidelity.
      for (const id of preview.ids) {
        const entry = findEntry(model, id);
        if (!entry) continue;
        drawEntry(ctx, { ...entry, paint: preview.paint });
      }
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

/**
 * Selection overlay morphed onto a resize preview box: corners and edges
 * follow the box, the rotate handle keeps its offset above the top edge,
 * and the rotation rides along (the draw applies it about the new center).
 */
function overlayForResize(
  overlay: NonNullable<RenderModelDto['selection']>,
  box: { x: number; y: number; width: number; height: number },
): NonNullable<RenderModelDto['selection']> {
  const handles: [number, number][] = [
    [box.x, box.y],
    [box.x + box.width / 2, box.y],
    [box.x + box.width, box.y],
    [box.x, box.y + box.height / 2],
    [box.x + box.width, box.y + box.height / 2],
    [box.x, box.y + box.height],
    [box.x + box.width / 2, box.y + box.height],
    [box.x + box.width, box.y + box.height],
  ];
  const overlayFrame = overlay.frame ?? overlay.bounds;
  return {
    bounds: { minX: box.x, minY: box.y, maxX: box.x + box.width, maxY: box.y + box.height },
    frame: { minX: box.x, minY: box.y, maxX: box.x + box.width, maxY: box.y + box.height },
    handles,
    rotateHandle: [
      box.x + box.width / 2,
      box.y + (overlay.rotateHandle[1] - overlayFrame.minY),
    ],
    rotation: overlay.rotation,
  };
}

function drawSelectionOverlay(
  ctx: CanvasRenderingContext2D,
  overlay: NonNullable<RenderModelDto['selection']>,
  zoom: number,
  textSingleSelection = false,
  shift: { dx: number; dy: number } | null = null,
): void {
  // Outline/handles derive from the unrotated frame; `bounds` is only the
  // AABB extents. Painting the AABB rotated would double-apply the rotation
  // (same enlargement bug as entries).
  const frame = overlay.frame ?? overlay.bounds;
  const { handles, rotateHandle, rotation } = overlay;
  const cx = (frame.minX + frame.maxX) / 2;
  const cy = (frame.minY + frame.maxY) / 2;
  ctx.save();
  // Scene-space shift first, so rotated boxes translate rigidly instead of
  // along their rotated axes.
  if (shift) ctx.translate(shift.dx, shift.dy);
  ctx.translate(cx, cy);
  ctx.rotate(rotation);
  ctx.translate(-cx, -cy);
  ctx.strokeStyle = SELECTION_COLOR;
  ctx.lineWidth = 1 / zoom;
  ctx.strokeRect(frame.minX, frame.minY, frame.maxX - frame.minX, frame.maxY - frame.minY);
  // Text boxes keep their content-driven height, but selected text still
  // exposes the four familiar corner handles for horizontal resizing.
  const visibleHandles = textSingleSelection
    ? [handles[0], handles[2], handles[5], handles[7]]
    : handles;
  for (const [x, y] of visibleHandles) {
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
