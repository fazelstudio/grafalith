import { describe, it, expect, beforeEach } from 'bun:test';
import { CropHandler } from './crop-handler';
import { Scene } from '../scene/scene';
import { createImage } from '../scene/create-element';
import type { ImageElement } from '../scene/types';
import type { Viewport } from '../render/viewport';

describe('CropHandler', () => {
  let scene: Scene;
  let viewport: Viewport;
  let cropHandler: CropHandler;

  beforeEach(() => {
    scene = new Scene();
    viewport = { scrollX: 0, scrollY: 0, zoom: 1 };
    cropHandler = new CropHandler(scene, viewport, () => {
      // Preview callback intentionally unobserved in these tests.
    });
  });

  describe('startCrop / endCrop', () => {
    it('enters crop mode for ImageElement', () => {
      const img = createImage({
        id: 'img-1',
        x: 0,
        y: 0,
        width: 200,
        height: 150,
        naturalWidth: 800,
        naturalHeight: 600,
      });
      scene.upsertElement(img);

      cropHandler.startCrop('img-1');
      expect(cropHandler.isCropping()).toBe(true);
      expect(cropHandler.getCroppingElementId()).toBe('img-1');
    });

    it('does not enter crop mode for non-image element', () => {
      scene.upsertElement(createImage({ id: 'img-1' }));
      // Try cropping a non-existent non-image element
      cropHandler.startCrop('nonexistent');
      expect(cropHandler.isCropping()).toBe(false);
    });

    it('exits crop mode and commits crop (full image = null)', () => {
      const img = createImage({
        id: 'img-1',
        naturalWidth: 800,
        naturalHeight: 600,
      });
      scene.upsertElement(img);

      cropHandler.startCrop('img-1');
      cropHandler.endCrop(true);

      const updated = scene.getElement('img-1');
      expect(updated?.type).toBe('image');
      // Full-image crop is stored as null (no crop)
      expect((updated as ImageElement).crop).toBeNull();
    });

    it('exits crop mode without committing (revert)', () => {
      const img = createImage({
        id: 'img-1',
        naturalWidth: 800,
        naturalHeight: 600,
        crop: { x: 100, y: 50, width: 400, height: 300 },
      });
      scene.upsertElement(img);

      cropHandler.startCrop('img-1');
      // Modify crop
      cropHandler.startHandleDrag('crop-bottom-right', 0, 0);
      cropHandler.endCrop(false); // Revert

      const updated = scene.getElement('img-1');
      expect(updated?.type).toBe('image');
      expect((updated as ImageElement).crop).toEqual({ x: 100, y: 50, width: 400, height: 300 });
    });

    it('sets full-image crop when no crop exists initially', () => {
      const img = createImage({
        id: 'img-1',
        naturalWidth: 800,
        naturalHeight: 600,
        crop: null,
      });
      scene.upsertElement(img);

      cropHandler.startCrop('img-1');
      const currentCrop = cropHandler.getCurrentCrop();
      expect(currentCrop).toEqual({ x: 0, y: 0, width: 800, height: 600 });
    });

    it('preserves existing crop on start', () => {
      const img = createImage({
        id: 'img-1',
        naturalWidth: 800,
        naturalHeight: 600,
        crop: { x: 100, y: 50, width: 400, height: 300 },
      });
      scene.upsertElement(img);

      cropHandler.startCrop('img-1');
      const currentCrop = cropHandler.getCurrentCrop();
      expect(currentCrop).toEqual({ x: 100, y: 50, width: 400, height: 300 });
    });
  });

  describe('getCropOverlayBounds', () => {
    it('returns null when not cropping', () => {
      expect(cropHandler.getCropOverlayBounds()).toBeNull();
    });

    it('returns overlay bounds in scene coordinates', () => {
      const img = createImage({
        id: 'img-1',
        x: 100,
        y: 50,
        width: 400,
        height: 300,
        naturalWidth: 800,
        naturalHeight: 600,
      });
      scene.upsertElement(img);

      cropHandler.startCrop('img-1');
      const overlay = cropHandler.getCropOverlayBounds();
      expect(overlay).toBeDefined();
      // With full image crop: scale = 400/800 = 0.5, 300/600 = 0.5
      expect(overlay!.x).toBe(100);
      expect(overlay!.y).toBe(50);
      expect(overlay!.width).toBe(400);
      expect(overlay!.height).toBe(300);
    });
  });

  describe('hitTestCropHandle', () => {
    it('returns null when not cropping', () => {
      expect(cropHandler.hitTestCropHandle(0, 0, 1)).toBeNull();
    });
  });
});
