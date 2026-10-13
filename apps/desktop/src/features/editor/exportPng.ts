import { drawRenderModel, NO_PREVIEW } from '../../render/drawModel';
import {
  lastResultData,
  parseBatchResult,
  type Engine,
  type RenderModelDto,
} from '../../hooks/useEngine';
import type { ProjectCanvas } from '../../platform/projects/types';

/** Default raster scale (matches the engine plan default). */
export const PNG_EXPORT_SCALE = 2;
/** Pixel clamp mirroring the engine plan (see `PngExportOptions` parity). */
export const PNG_MAX_DIMENSION_PX = 4096;

export interface PngExportRect {
  /** Scene-space left edge of the exported area. */
  minX: number;
  /** Scene-space top edge of the exported area. */
  minY: number;
  /** Export width in scene units. */
  width: number;
  /** Export height in scene units. */
  height: number;
  /** Raster scale applied to both axes. */
  scale: number;
  /** Canvas background (`transparent` leaves alpha untouched). */
  background: string;
}

interface PngPlan {
  contentBounds: { minX: number; minY: number; maxX: number; maxY: number };
  canvasWidthPx: number;
  canvasHeightPx: number;
  effectiveScale: number;
  background: string;
}

/** Resolves the exported scene rect: exact page for fixed canvas, engine content bounds otherwise. */
export async function planExportRect(engine: Engine, canvas: ProjectCanvas): Promise<PngExportRect> {
  if (canvas.mode === 'fixed') {
    const scale = Math.min(PNG_EXPORT_SCALE, PNG_MAX_DIMENSION_PX / Math.max(canvas.width, canvas.height));
    return { minX: 0, minY: 0, width: canvas.width, height: canvas.height, scale, background: 'transparent' };
  }
  const raw = await engine.sendBatch([{ op: 'planPngExport' }]);
  const data = lastResultData(parseBatchResult(raw), 'planPngExport') as PngPlan | undefined;
  if (!data) throw new Error('PNG plan unavailable');
  return {
    minX: data.contentBounds.minX,
    minY: data.contentBounds.minY,
    width: Math.max(1, data.canvasWidthPx / data.effectiveScale),
    height: Math.max(1, data.canvasHeightPx / data.effectiveScale),
    scale: data.effectiveScale,
    background: data.background,
  };
}

/** Renders one export rect to a PNG blob without touching the live session. */
export async function renderExportBlob(rect: PngExportRect, model: RenderModelDto): Promise<Blob> {
  const widthPx = Math.max(1, Math.round(rect.width * rect.scale));
  const heightPx = Math.max(1, Math.round(rect.height * rect.scale));
  const canvas = document.createElement('canvas');
  canvas.width = widthPx;
  canvas.height = heightPx;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (rect.background !== 'transparent') {
    ctx.fillStyle = rect.background;
    ctx.fillRect(0, 0, widthPx, heightPx);
  }
  // Selection and guides never export: the committed picture only.
  drawRenderModel(ctx, { ...model, selection: null, snapGuides: [] }, widthPx, heightPx, NO_PREVIEW, null, null, false);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('PNG encoding failed');
  return blob;
}

/** Queries the export model for one rect through a one-shot viewport override. */
export async function queryExportModel(engine: Engine, rect: PngExportRect): Promise<RenderModelDto> {
  const widthPx = Math.max(1, Math.round(rect.width * rect.scale));
  const heightPx = Math.max(1, Math.round(rect.height * rect.scale));
  const raw = await engine.sendBatch([
    {
      op: 'renderModel',
      canvasWidth: widthPx,
      canvasHeight: heightPx,
      showGrid: false,
      readyImages: [],
      viewport: { scrollX: -rect.minX, scrollY: -rect.minY, zoom: rect.scale },
    },
  ]);
  const model = lastResultData(parseBatchResult(raw), 'renderModel') as RenderModelDto | undefined;
  if (!model) throw new Error('Export model unavailable');
  return model;
}

/** Full PNG export: plan, render offscreen, and encode (the caller downloads). */
export async function exportPngImage(engine: Engine, canvas: ProjectCanvas): Promise<Blob> {
  const rect = await planExportRect(engine, canvas);
  const model = await queryExportModel(engine, rect);
  return renderExportBlob(rect, model);
}

/** File-safe export name for a project. */
export function pngFileName(projectName: string): string {
  const clean = projectName.replace(/[\\/:"*?<>|]/g, '-').trim() || 'grafalith';
  return `${clean}.png`;
}
