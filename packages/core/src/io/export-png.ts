import { Scene } from '../scene/scene';
import { Element } from '../scene/types';
import { getElementBounds } from '../shapes';
import type { Bounds } from '../shapes/geometry';
import { renderElement } from '../shapes';

/**
 * Options for PNG export.
 */
export interface PNGExportOptions {
  /** Background color (default: 'transparent'). Use '#ffffff' for white background. */
  background?: string;
  /** Padding around the scene content in pixels (default: 20). */
  padding?: number;
  /** Scale factor for higher resolution output (default: 2). */
  scale?: number;
}

/**
 * Compute the bounding box of all visible elements in the scene.
 * @param elements - Elements to compute bounds for
 * @returns Combined bounding box, or null if no elements
 */
function computeSceneBounds(elements: Element[]): Bounds | null {
  if (elements.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const el of elements) {
    const b = getElementBounds(el);
    if (b.minX < minX) minX = b.minX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.maxY > maxY) maxY = b.maxY;
  }

  return { minX, minY, maxX, maxY };
}

/**
 * Export the scene to a PNG Blob.
 * Renders visible (non-deleted, non-hidden) elements to an offscreen canvas.
 * Requires browser environment (Canvas API).
 *
 * @param scene - Scene to export
 * @param options - Export options
 * @returns Promise resolving to a PNG Blob
 */
export async function exportSceneToPNG(
  scene: Scene,
  options: PNGExportOptions & { createCanvas?: () => HTMLCanvasElement } = {},
): Promise<Blob> {
  const { background = 'transparent', padding = 20, scale = 2, createCanvas } = options;

  // Match canvas: hidden elements are never rendered on screen.
  const elements = scene.getAllElements().filter((el) => !el.hidden);
  const bounds = computeSceneBounds(elements);

  if (!bounds) {
    throw new Error('No elements to export');
  }

  const width = (bounds.maxX - bounds.minX) + padding * 2;
  const height = (bounds.maxY - bounds.minY) + padding * 2;

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('Invalid scene bounds for PNG export');
  }

  // Pixel cap: 10k world × scale 2 ≈ 1.6GB canvas. Clamp to 4096px max dimension.
  const MAX_DIMENSION = 4096;
  const requestedW = Math.round(width * scale);
  const requestedH = Math.round(height * scale);
  const downscale = Math.min(1, MAX_DIMENSION / Math.max(requestedW, requestedH));
  const effectiveScale = scale * downscale;

  // Create offscreen canvas (injectable factory for headless/offscreen use).
  const canvas = createCanvas ? createCanvas() : document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * effectiveScale));
  canvas.height = Math.max(1, Math.round(height * effectiveScale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get canvas context');

  // Scale for higher resolution
  ctx.scale(effectiveScale, effectiveScale);

  // Draw background
  if (background !== 'transparent') {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);
  }

  // Translate so scene content starts at (padding, padding)
  ctx.translate(padding - bounds.minX, padding - bounds.minY);

  // Render all elements
  const viewport = { scrollX: 0, scrollY: 0, zoom: 1 };
  for (const el of elements) {
    renderElement(ctx, el, viewport);
  }

  // Convert to blob
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Failed to create PNG blob'));
      },
      'image/png',
    );
  });
}
