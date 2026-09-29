import { Scene } from '../scene/scene';
import type { ImageElement, CropRegion } from '../scene/types';
import { Viewport, screenToScene } from '../render/viewport';

/** Crop handle types for the 8 resize points of the crop region. */
export type CropHandle =
  | 'crop-top-left' | 'crop-top-center' | 'crop-top-right'
  | 'crop-middle-left' | 'crop-middle-right'
  | 'crop-bottom-left' | 'crop-bottom-center' | 'crop-bottom-right';

/** State for an active crop operation. */
interface CropState {
  elementId: string;
  /** Original crop region at crop start (null = no crop = full image). */
  originalCrop: CropRegion | null;
  /** Current crop region being dragged (in natural pixel coordinates). */
  currentCrop: CropRegion;
  /** Which handle is being dragged. */
  activeHandle: CropHandle | null;
  /** Natural dimensions of the image (for clamping). */
  naturalWidth: number;
  naturalHeight: number;
}

/**
 * Handles crop mode for ImageElements.
 * Manages entering/exiting crop mode, drag interaction, and committing.
 */
export class CropHandler {
  private scene: Scene;
  private viewport: Viewport;
  private state: CropState | null = null;
  private onPreview: (element: ImageElement) => void;

  /**
   * @param scene - Scene to commit crop changes to
   * @param viewport - Current viewport for coordinate conversion
   * @param onPreview - Callback to request preview render during crop drag
   */
  constructor(scene: Scene, viewport: Viewport, onPreview: (element: ImageElement) => void) {
    this.scene = scene;
    this.viewport = viewport;
    this.onPreview = onPreview;
  }

  /** Update viewport state. */
  setViewport(viewport: Viewport): void {
    this.viewport = viewport;
  }

  /** Check if crop mode is active. */
  isCropping(): boolean {
    return this.state !== null;
  }

  /** Get the element being cropped, or null. */
  getCroppingElementId(): string | null {
    return this.state?.elementId ?? null;
  }

  /** Get the current crop region (for rendering the crop overlay). */
  getCurrentCrop(): CropRegion | null {
    return this.state?.currentCrop ?? null;
  }

  /**
   * Enter crop mode for an ImageElement.
   * @param elementId - The ImageElement to crop
   */
  startCrop(elementId: string): void {
    const el = this.scene.getElement(elementId);
    if (!el || el.type !== 'image') return;

    const img = el as ImageElement;
    this.state = {
      elementId,
      originalCrop: img.crop ? { ...img.crop } : null,
      currentCrop: img.crop ? { ...img.crop } : {
        x: 0,
        y: 0,
        width: img.naturalWidth,
        height: img.naturalHeight,
      },
      activeHandle: null,
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
    };
  }

  /**
   * Exit crop mode and commit the crop to the scene.
   * @param commit - If true, apply the crop; if false, revert to original.
   */
  endCrop(commit: boolean): void {
    if (!this.state) return;

    if (commit) {
      const el = this.scene.getElement(this.state.elementId);
      if (el && el.type === 'image') {
        const img = el as ImageElement;
        const crop = this.state.currentCrop;

        // Only set crop if it covers less than the full image
        const isFullImage =
          crop.x === 0 &&
          crop.y === 0 &&
          crop.width === img.naturalWidth &&
          crop.height === img.naturalHeight;

        this.scene.upsertElement({
          ...img,
          crop: isFullImage ? null : crop,
        });
      }
    }

    this.state = null;
  }

  /**
   * Start dragging a crop handle.
   * Screen coordinates are accepted for API symmetry with updateHandleDrag
   * (the drag start position is the handle itself, so no conversion needed).
   */
  startHandleDrag(handle: CropHandle, _screenX: number, _screenY: number): void {
    if (!this.state) return;
    this.state.activeHandle = handle;
  }

  /**
   * Update crop region during handle drag.
   * Converts screen coordinates to natural image coordinates.
   */
  updateHandleDrag(screenX: number, screenY: number): void {
    if (!this.state || !this.state.activeHandle) return;

    const el = this.scene.getElement(this.state.elementId);
    if (!el || el.type !== 'image') return;
    const img = el as ImageElement;

    const scenePoint = screenToScene([screenX, screenY], this.viewport);

    // Convert scene point to natural image coordinates
    // The element's position in scene is (img.x, img.y), size is (img.width, img.height)
    // Natural coordinates: ((sceneX - img.x) / img.width * naturalWidth, ...)
    const natX = ((scenePoint[0] - img.x) / img.width) * img.naturalWidth;
    const natY = ((scenePoint[1] - img.y) / img.height) * img.naturalHeight;

    const crop = { ...this.state.currentCrop };
    const handle = this.state.activeHandle;

    // Update crop region based on which handle is being dragged
    if (handle.includes('left')) {
      const maxX = crop.x + crop.width;
      crop.x = Math.max(0, Math.min(natX, maxX - 10));
      crop.width = maxX - crop.x;
    }
    if (handle.includes('right')) {
      crop.width = Math.max(10, Math.min(natX - crop.x, this.state.naturalWidth - crop.x));
    }
    if (handle.includes('top')) {
      const maxY = crop.y + crop.height;
      crop.y = Math.max(0, Math.min(natY, maxY - 10));
      crop.height = maxY - crop.y;
    }
    if (handle.includes('bottom')) {
      crop.height = Math.max(10, Math.min(natY - crop.y, this.state.naturalHeight - crop.y));
    }

    // Clamp to natural bounds
    crop.x = Math.max(0, Math.min(crop.x, this.state.naturalWidth - 1));
    crop.y = Math.max(0, Math.min(crop.y, this.state.naturalHeight - 1));
    crop.width = Math.max(10, Math.min(crop.width, this.state.naturalWidth - crop.x));
    crop.height = Math.max(10, Math.min(crop.height, this.state.naturalHeight - crop.y));

    this.state.currentCrop = crop;

    // Trigger preview
    this.onPreview({ ...img, crop });
  }

  /**
   * Get the crop overlay positions in scene coordinates for rendering.
   * Returns the crop region corners mapped to scene space.
   */
  getCropOverlayBounds(): { x: number; y: number; width: number; height: number } | null {
    if (!this.state) return null;

    const el = this.scene.getElement(this.state.elementId);
    if (!el || el.type !== 'image') return null;
    const img = el as ImageElement;
    const crop = this.state.currentCrop;

    // Convert natural coordinates back to scene coordinates
    const scaleX = img.width / img.naturalWidth;
    const scaleY = img.height / img.naturalHeight;

    return {
      x: img.x + crop.x * scaleX,
      y: img.y + crop.y * scaleY,
      width: crop.width * scaleX,
      height: crop.height * scaleY,
    };
  }

  /**
   * Hit-test a scene point against crop handles.
   * Returns the handle type if hit, or null.
   */
  hitTestCropHandle(px: number, py: number, zoom: number): CropHandle | null {
    const overlay = this.getCropOverlayBounds();
    if (!overlay) return null;

    const hitRadius = 8 / zoom; // 8px hit area

    // Define handle positions
    const handles: Array<{ type: CropHandle; x: number; y: number }> = [
      { type: 'crop-top-left', x: overlay.x, y: overlay.y },
      { type: 'crop-top-center', x: overlay.x + overlay.width / 2, y: overlay.y },
      { type: 'crop-top-right', x: overlay.x + overlay.width, y: overlay.y },
      { type: 'crop-middle-left', x: overlay.x, y: overlay.y + overlay.height / 2 },
      { type: 'crop-middle-right', x: overlay.x + overlay.width, y: overlay.y + overlay.height / 2 },
      { type: 'crop-bottom-left', x: overlay.x, y: overlay.y + overlay.height },
      { type: 'crop-bottom-center', x: overlay.x + overlay.width / 2, y: overlay.y + overlay.height },
      { type: 'crop-bottom-right', x: overlay.x + overlay.width, y: overlay.y + overlay.height },
    ];

    for (const handle of handles) {
      const dx = px - handle.x;
      const dy = py - handle.y;
      if (Math.abs(dx) <= hitRadius && Math.abs(dy) <= hitRadius) {
        return handle.type;
      }
    }

    return null;
  }

  /**
   * Check if a point is inside the crop region (for clicking to start drag).
   */
  hitTestCropRegion(px: number, py: number): boolean {
    const overlay = this.getCropOverlayBounds();
    if (!overlay) return false;

    return (
      px >= overlay.x &&
      px <= overlay.x + overlay.width &&
      py >= overlay.y &&
      py <= overlay.y + overlay.height
    );
  }

  /** Clear crop session and stale references (mount/unmount safety). */
  destroy(): void {
    this.state = null;
  }
}
