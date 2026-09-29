import { Scene } from './scene';

/**
 * Lock elements by setting locked = true.
 */
export function lockElements(scene: Scene, elementIds: string[]): void {
  for (const id of elementIds) {
    const el = scene.getElement(id);
    if (el && !el.isDeleted) {
      scene.upsertElement({
        ...el,
        locked: true,
        version: el.version + 1,
        versionNonce: Math.floor(Math.random() * 2_000_000_000),
      });
    }
  }
}

/**
 * Unlock elements by setting locked = false.
 */
export function unlockElements(scene: Scene, elementIds: string[]): void {
  for (const id of elementIds) {
    const el = scene.getElement(id);
    if (el && !el.isDeleted) {
      scene.upsertElement({
        ...el,
        locked: false,
        version: el.version + 1,
        versionNonce: Math.floor(Math.random() * 2_000_000_000),
      });
    }
  }
}

/**
 * Toggle lock state for elements.
 */
export function toggleLock(scene: Scene, elementIds: string[]): void {
  for (const id of elementIds) {
    const el = scene.getElement(id);
    if (el && !el.isDeleted) {
      scene.upsertElement({
        ...el,
        locked: !el.locked,
        version: el.version + 1,
        versionNonce: Math.floor(Math.random() * 2_000_000_000),
      });
    }
  }
}
