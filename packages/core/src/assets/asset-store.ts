/**
 * Interface for storing and retrieving binary assets (images, etc.).
 * Implementations can be in-memory (default), IndexedDB, S3/CDN, etc.
 *
 * The store is intentionally async to support remote backends.
 * The default in-memory implementation is synchronous under the hood
 * but uses the async interface for consistency.
 */
export interface AssetStore {
  /** Store an asset by id. Data can be a Blob or a string (data URL / remote URL). */
  addAsset(id: string, data: Blob | string): Promise<void>;
  /** Retrieve an asset by id. Returns undefined if not found. */
  getAsset(id: string): Promise<Blob | string | undefined>;
  /** Remove an asset by id. No-op if not found. */
  removeAsset(id: string): Promise<void>;
  /** Check if an asset exists. */
  hasAsset(id: string): Promise<boolean>;
}

/**
 * Default in-memory AssetStore implementation.
 * Suitable for v1; replace with IndexedDB/CDN for persistence.
 */
export class InMemoryAssetStore implements AssetStore {
  private assets = new Map<string, Blob | string>();

  async addAsset(id: string, data: Blob | string): Promise<void> {
    this.assets.set(id, data);
  }

  async getAsset(id: string): Promise<Blob | string | undefined> {
    return this.assets.get(id);
  }

  async removeAsset(id: string): Promise<void> {
    this.assets.delete(id);
  }

  async hasAsset(id: string): Promise<boolean> {
    return this.assets.has(id);
  }

  /** Get the number of stored assets (for debugging/testing). */
  get size(): number {
    return this.assets.size;
  }

  /** Clear all assets. */
  clear(): void {
    this.assets.clear();
  }
}
