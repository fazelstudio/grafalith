import { ImageElement } from '../scene/types';
import { Viewport } from '../render/viewport';
import { Bounds, getRotatedBounds } from './geometry';
import type { AssetStore } from '../assets/asset-store';
import type { ShapeDefinition } from './registry';

/** Cache for loaded HTMLImageElement objects, keyed by assetId. */
const imageCache = new Map<string, HTMLImageElement>();

/** Pending load promises to avoid duplicate fetches. */
const pendingLoads = new Map<string, Promise<HTMLImageElement | null>>();

/** Object URLs created for Blob assets, keyed by assetId (for revocation). */
const objectUrlsByAssetId = new Map<string, string>();

/** The active asset store reference — set via setImageAssetStore(). */
let activeAssetStore: AssetStore | null = null;

/**
 * Set the asset store used by the image renderer.
 * Must be called before any image elements are rendered.
 */
export function setImageAssetStore(store: AssetStore): void {
  activeAssetStore = store;
}

/** Get the current image cache (for debugging/testing). */
export function getImageCache(): ReadonlyMap<string, HTMLImageElement> {
  return imageCache;
}

/** Clear the image cache, revoking any created object URLs. */
export function clearImageCache(): void {
  for (const url of objectUrlsByAssetId.values()) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // ignore revocation failures
    }
  }
  objectUrlsByAssetId.clear();
  imageCache.clear();
  pendingLoads.clear();
}

/** Revoke the cached image and object URL for a single asset (e.g. on delete). */
export function evictImageAsset(assetId: string): void {
  imageCache.delete(assetId);
  pendingLoads.delete(assetId);
  const url = objectUrlsByAssetId.get(assetId);
  if (url) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // ignore
    }
    objectUrlsByAssetId.delete(assetId);
  }
}

/**
 * Load an image from the asset store and cache it.
 * Returns the HTMLImageElement or null if loading fails.
 */
async function loadCachedImage(assetId: string): Promise<HTMLImageElement | null> {
  // Return from cache if available
  const cached = imageCache.get(assetId);
  if (cached) return cached;

  // Return existing pending load if in progress
  const pending = pendingLoads.get(assetId);
  if (pending) return pending;

  if (!activeAssetStore) return null;

  const loadPromise = (async (): Promise<HTMLImageElement | null> => {
    try {
      const data = await activeAssetStore!.getAsset(assetId);
      if (!data) return null;

      const img = new Image();
      const url = typeof data === 'string' ? data : URL.createObjectURL(data);
      if (typeof data !== 'string') {
        objectUrlsByAssetId.set(assetId, url);
      }

      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error(`Failed to load image: ${assetId}`));
        img.src = url;
      });

      // Revoke object URLs (but not data URLs or remote URLs)
      // NOTE: the <img> still references the URL while cached; revocation
      // happens in clearImageCache()/evictImageAsset() instead.

      imageCache.set(assetId, img);
      pendingLoads.delete(assetId);
      return img;
    } catch {
      pendingLoads.delete(assetId);
      return null;
    }
  })();

  pendingLoads.set(assetId, loadPromise);
  return loadPromise;
}

/**
 * Render an image element onto a canvas context.
 * Uses drawImage with optional source rectangle for crop support.
 * Images are loaded asynchronously from the AssetStore with caching.
 */
export function renderImage(
  ctx: CanvasRenderingContext2D,
  element: ImageElement,
  _viewport: Viewport,
): void {
  const img = imageCache.get(element.assetId);

  if (!img) {
    // Show placeholder while loading (rotation-aware like the image itself)
    ctx.save();
    if (element.rotation !== 0) {
      const cx = element.x + element.width / 2;
      const cy = element.y + element.height / 2;
      ctx.translate(cx, cy);
      ctx.rotate(element.rotation);
      ctx.translate(-cx, -cy);
    }
    ctx.fillStyle = '#e0e0e0';
    ctx.fillRect(element.x, element.y, element.width, element.height);
    ctx.strokeStyle = '#999';
    ctx.lineWidth = 1;
    ctx.strokeRect(element.x, element.y, element.width, element.height);

    // Draw loading indicator
    ctx.fillStyle = '#999';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Loading...', element.x + element.width / 2, element.y + element.height / 2);
    ctx.restore();

    // Trigger async load
    loadCachedImage(element.assetId);
    return;
  }

  ctx.save();

  // Apply rotation around the element center (consistent with other shapes).
  if (element.rotation !== 0) {
    const cx = element.x + element.width / 2;
    const cy = element.y + element.height / 2;
    ctx.translate(cx, cy);
    ctx.rotate(element.rotation);
    ctx.translate(-cx, -cy);
  }

  // Apply opacity
  ctx.globalAlpha = element.opacity / 100;

  // Compute source rectangle from crop or full image
  let sx = 0;
  let sy = 0;
  let sw = element.naturalWidth;
  let sh = element.naturalHeight;

  if (element.crop) {
    sx = element.crop.x;
    sy = element.crop.y;
    sw = element.crop.width;
    sh = element.crop.height;
  }

  // Draw the image (or cropped region) into the element bounds
  ctx.drawImage(img, sx, sy, sw, sh, element.x, element.y, element.width, element.height);

  ctx.restore();
}

/**
 * Hit-test a point against an image element.
 * Rotation-aware: inverse-rotates the point into local space first.
 */
export function hitTestImage(px: number, py: number, element: ImageElement): boolean {
  let testX = px;
  let testY = py;
  if (element.rotation !== 0) {
    const cx = element.x + element.width / 2;
    const cy = element.y + element.height / 2;
    const cos = Math.cos(-element.rotation);
    const sin = Math.sin(-element.rotation);
    const dx = px - cx;
    const dy = py - cy;
    testX = dx * cos - dy * sin + cx;
    testY = dx * sin + dy * cos + cy;
  }
  return (
    testX >= element.x &&
    testX <= element.x + element.width &&
    testY >= element.y &&
    testY <= element.y + element.height
  );
}

/**
 * Get the axis-aligned bounding box of an image element (rotation-aware).
 */
export function getImageBounds(element: ImageElement): Bounds {
  return getRotatedBounds(element.x, element.y, element.width, element.height, element.rotation);
}

/** Image shape definition for the registry. */
export const imageShapeDefinition: ShapeDefinition<ImageElement> = {
  type: 'image' as const,
  render: renderImage,
  hitTest: (point, element) => hitTestImage(point[0], point[1], element),
  getBounds: (element) => getImageBounds(element),
  getDefaultProps: () => ({
    type: 'image' as const,
    width: 200,
    height: 200,
    assetId: '',
    naturalWidth: 100,
    naturalHeight: 100,
    crop: null,
  }),
};
