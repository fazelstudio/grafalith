import { Scene } from '../scene/scene';
import { Element } from '../scene/types';

/**
 * Serialized scene format.
 * Elements array contains all non-deleted elements.
 * `schemaVersion` versions the envelope (migrations in import-json);
 * `version` is kept as a legacy alias (always 1) for old readers.
 */
export interface SerializedScene {
  /** Schema version for migrations. Current: 1. */
  schemaVersion: 1;
  /** Legacy alias of schemaVersion (always 1). */
  version: 1;
  /** Scene elements (non-deleted only). */
  elements: Element[];
  /** Z-order (element ids, including tombstone-filtered order). */
  elementOrder?: string[];
}

/**
 * Export a scene to JSON string.
 * Only includes non-deleted elements.
 * @param scene - Scene to export
 * @returns JSON string representation
 */
export function exportSceneToJSON(scene: Scene): string {
  const data: SerializedScene = {
    schemaVersion: 1,
    version: 1,
    elements: scene.getAllElements(),
    elementOrder: scene.getElementOrder(),
  };
  return JSON.stringify(data);
}
