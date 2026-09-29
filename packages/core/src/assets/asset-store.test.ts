import { describe, it, expect } from 'bun:test';
import { InMemoryAssetStore } from './asset-store';
import { createImage } from '../scene/create-element';
import { hitTestImage, getImageBounds } from '../shapes/image';

describe('AssetStore', () => {
  describe('InMemoryAssetStore', () => {
    it('stores and retrieves a Blob asset', async () => {
      const store = new InMemoryAssetStore();
      const blob = new Blob(['test data'], { type: 'image/png' });
      await store.addAsset('asset-1', blob);

      const retrieved = await store.getAsset('asset-1');
      expect(retrieved).toBeDefined();
      expect(retrieved instanceof Blob).toBe(true);
    });

    it('stores and retrieves a string asset (data URL)', async () => {
      const store = new InMemoryAssetStore();
      const dataUrl = 'data:image/png;base64,iVBORw0KGgo=';
      await store.addAsset('asset-2', dataUrl);

      const retrieved = await store.getAsset('asset-2');
      expect(retrieved).toBe(dataUrl);
    });

    it('returns undefined for non-existent asset', async () => {
      const store = new InMemoryAssetStore();
      const retrieved = await store.getAsset('nonexistent');
      expect(retrieved).toBeUndefined();
    });

    it('checks asset existence with hasAsset', async () => {
      const store = new InMemoryAssetStore();
      expect(await store.hasAsset('asset-1')).toBe(false);

      await store.addAsset('asset-1', 'data');
      expect(await store.hasAsset('asset-1')).toBe(true);
    });

    it('removes an asset', async () => {
      const store = new InMemoryAssetStore();
      await store.addAsset('asset-1', 'data');
      expect(await store.hasAsset('asset-1')).toBe(true);

      await store.removeAsset('asset-1');
      expect(await store.hasAsset('asset-1')).toBe(false);
    });

    it('overwrites existing asset', async () => {
      const store = new InMemoryAssetStore();
      await store.addAsset('asset-1', 'data1');
      await store.addAsset('asset-1', 'data2');

      const retrieved = await store.getAsset('asset-1');
      expect(retrieved).toBe('data2');
    });

    it('reports correct size', async () => {
      const store = new InMemoryAssetStore();
      expect(store.size).toBe(0);

      await store.addAsset('a', 'data');
      await store.addAsset('b', 'data');
      expect(store.size).toBe(2);

      await store.removeAsset('a');
      expect(store.size).toBe(1);
    });

    it('clears all assets', async () => {
      const store = new InMemoryAssetStore();
      await store.addAsset('a', 'data');
      await store.addAsset('b', 'data');
      store.clear();
      expect(store.size).toBe(0);
    });
  });
});

describe('ImageElement', () => {
  describe('createImage', () => {
    it('creates an image element with defaults', () => {
      const img = createImage({ id: 'img-1' });
      expect(img.type).toBe('image');
      expect(img.id).toBe('img-1');
      expect(img.assetId).toBe('');
      expect(img.naturalWidth).toBe(100);
      expect(img.naturalHeight).toBe(100);
      expect(img.crop).toBeNull();
    });

    it('creates an image element with overrides', () => {
      const img = createImage({
        id: 'img-2',
        assetId: 'my-asset',
        naturalWidth: 800,
        naturalHeight: 600,
        width: 400,
        height: 300,
        crop: { x: 100, y: 50, width: 400, height: 300 },
      });
      expect(img.assetId).toBe('my-asset');
      expect(img.naturalWidth).toBe(800);
      expect(img.naturalHeight).toBe(600);
      expect(img.width).toBe(400);
      expect(img.height).toBe(300);
      expect(img.crop).toEqual({ x: 100, y: 50, width: 400, height: 300 });
    });
  });

  describe('hitTestImage', () => {
    const img = createImage({
      id: 'img-1',
      x: 50,
      y: 50,
      width: 200,
      height: 150,
    });

    it('point clearly inside', () => {
      expect(hitTestImage(100, 100, img)).toBe(true);
    });

    it('point clearly outside', () => {
      expect(hitTestImage(300, 300, img)).toBe(false);
    });

    it('point on edge', () => {
      expect(hitTestImage(50, 100, img)).toBe(true);
      expect(hitTestImage(250, 100, img)).toBe(true);
    });

    it('point on corner', () => {
      expect(hitTestImage(50, 50, img)).toBe(true);
      expect(hitTestImage(250, 200, img)).toBe(true);
    });
  });

  describe('getImageBounds', () => {
    it('returns correct bounds', () => {
      const img = createImage({
        id: 'img-1',
        x: 50,
        y: 50,
        width: 200,
        height: 150,
      });
      const bounds = getImageBounds(img);
      expect(bounds).toEqual({ minX: 50, minY: 50, maxX: 250, maxY: 200 });
    });
  });
});
