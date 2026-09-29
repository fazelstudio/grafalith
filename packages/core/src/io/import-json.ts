import { Scene } from '../scene/scene';
import { Element } from '../scene/types';
import { defaultShapeRegistry } from '../shapes/registry';

/** Validate that a parsed object has the shape of a valid Element. */
function isValidElement(obj: unknown): obj is Element {
  if (typeof obj !== 'object' || obj === null) return false;
  const el = obj as Record<string, unknown>;

  // Required base fields (finite numbers — NaN/Infinity would poison grid/canvas)
  if (typeof el.id !== 'string' || el.id.length === 0) return false;
  if (typeof el.type !== 'string') return false;
  if (typeof el.x !== 'number' || !Number.isFinite(el.x)) return false;
  if (typeof el.y !== 'number' || !Number.isFinite(el.y)) return false;
  if (typeof el.width !== 'number' || !Number.isFinite(el.width)) return false;
  if (typeof el.height !== 'number' || !Number.isFinite(el.height)) return false;
  if (typeof el.rotation !== 'number' || !Number.isFinite(el.rotation)) return false;
  if (typeof el.strokeColor !== 'string') return false;
  if (typeof el.opacity !== 'number' || !Number.isFinite(el.opacity)) return false;
  if (typeof el.version !== 'number' || !Number.isFinite(el.version)) return false;
  if (typeof el.versionNonce !== 'number' || !Number.isFinite(el.versionNonce)) return false;
  if (typeof el.isDeleted !== 'boolean') return false;
  if (!Array.isArray(el.groupIds) || !el.groupIds.every((g) => typeof g === 'string')) return false;
  if (typeof el.locked !== 'boolean') return false;
  if (typeof el.strokeWidth !== 'undefined' && (typeof el.strokeWidth !== 'number' || !Number.isFinite(el.strokeWidth))) return false;
  if (typeof el.seed !== 'undefined' && (typeof el.seed !== 'number' || !Number.isFinite(el.seed))) return false;
  // hidden and frameId are optional for backward compatibility with v1 exports
  if (el.hidden !== undefined && typeof el.hidden !== 'boolean') return false;
  if (el.frameId !== undefined && el.frameId !== null && typeof el.frameId !== 'string') return false;

  // Validate backgroundColor (FillStyle)
  const bg = el.backgroundColor;
  if (typeof bg !== 'object' || bg === null) return false;
  const bgRecord = bg as Record<string, unknown>;
  if (bgRecord.type === 'solid') {
    if (typeof bgRecord.color !== 'string') return false;
  } else if (bgRecord.type === 'gradient') {
    if (typeof bgRecord.gradientType !== 'string') return false;
    if (typeof bgRecord.angle !== 'number' || !Number.isFinite(bgRecord.angle)) return false;
    if (!Array.isArray(bgRecord.stops)) return false;
    for (const s of bgRecord.stops as unknown[]) {
      const stop = s as Record<string, unknown>;
      if (typeof stop.offset !== 'number' || !Number.isFinite(stop.offset)) return false;
      if (typeof stop.color !== 'string') return false;
    }
  } else {
    return false;
  }

  // Per-type required fields (corrupt typed data must not partially load).
  switch (el.type) {
    case 'text':
      if (typeof el.text !== 'string') return false;
      if (typeof el.fontSize !== 'number' || !Number.isFinite(el.fontSize)) return false;
      if (typeof el.fontFamily !== 'string') return false;
      break;
    case 'line':
    case 'arrow':
    case 'freedraw':
      if (!Array.isArray(el.points)) return false;
      break;
    case 'image':
      if (typeof el.assetId !== 'string') return false;
      if (typeof el.naturalWidth !== 'number' || !Number.isFinite(el.naturalWidth)) return false;
      if (typeof el.naturalHeight !== 'number' || !Number.isFinite(el.naturalHeight)) return false;
      break;
    case 'path':
      if (!Array.isArray(el.segments)) return false;
      break;
    case 'instance':
      if (typeof el.componentId !== 'string') return false;
      break;
    case 'frame':
      if (typeof el.name !== 'string') return false;
      break;
    default:
      break;
  }
  if (el.type === 'freedraw') {
    const pts = el.points as unknown[];
    const pressures = el.pressures as unknown;
    if (Array.isArray(pressures) && pressures.length !== pts.length) return false;
  }

  // Validate against registered shape definitions.
  // Built-in types have known field requirements; custom types are validated
  // by their ShapeDefinition registration (any type in the registry is accepted).
  if (!defaultShapeRegistry.has(el.type)) {
    return false;
  }

  return true;
}

/** Migrate a parsed scene envelope to the current schema (v1). Pure. */
function migrateScene(data: Record<string, unknown>): { elements: unknown[]; elementOrder?: string[] } {
  const schemaVersion = (data.schemaVersion as number | undefined) ?? (data.version as number | undefined) ?? 1;
  if (schemaVersion !== 1) {
    throw new Error(`Unsupported scene version: ${schemaVersion}`);
  }
  if (!Array.isArray(data.elements)) {
    throw new Error('Invalid scene format: "elements" must be an array');
  }
  const elementOrder = Array.isArray(data.elementOrder)
    ? (data.elementOrder as unknown[]).filter((id): id is string => typeof id === 'string')
    : undefined;
  return { elements: data.elements, elementOrder };
}

/** Result of an import (surfaced instead of silently dropping data). */
export interface ImportResult {
  imported: number;
  skipped: number;
}

/**
 * Import a scene from JSON string.
 * Validates the data format and rejects malformed JSON.
 * Import is a single atomic replacement (no per-element history spam):
 * callers that need undoability should snapshot beforehand.
 * @param json - JSON string to import
 * @param targetScene - Scene to import into (replaces all elements)
 * @param history - Optional HistoryManager to batch the import into one entry
 * @returns counts of imported vs skipped elements
 * @throws Error if JSON is malformed or data validation fails
 */
export function importSceneFromJSON(json: string, targetScene: Scene, history?: { startBatch(): void; endBatch(): void }): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Invalid JSON: could not parse');
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Invalid scene format: root must be an object');
  }

  const data = parsed as Record<string, unknown>;
  const { elements, elementOrder } = migrateScene(data);

  // Validate first (no partial clear on corrupt input).
  const valid: Element[] = [];
  let skipCount = 0;
  for (const obj of elements) {
    if (isValidElement(obj)) {
      const el = obj as unknown as Record<string, unknown>;
      if (el.hidden === undefined) el.hidden = false;
      if (el.frameId === undefined) el.frameId = null;
      valid.push(obj as Element);
    } else {
      skipCount++;
    }
  }

  if (valid.length === 0 && elements.length > 0) {
    throw new Error('No valid elements found in scene data');
  }

  // Referential repair pass: null/prune dangling references.
  const idSet = new Set(valid.map((el) => el.id));
  for (const el of valid) {
    const rec = el as unknown as Record<string, unknown>;
    if (typeof rec.frameId === 'string' && !idSet.has(rec.frameId as string)) rec.frameId = null;
    if (Array.isArray(rec.groupIds)) {
      rec.groupIds = (rec.groupIds as unknown[]).filter((g) => typeof g === 'string');
    }
    if (el.type === 'arrow') {
      const arrow = el as unknown as Record<string, unknown>;
      for (const key of ['startBinding', 'endBinding'] as const) {
        const binding = arrow[key] as Record<string, unknown> | null;
        if (binding && typeof binding.elementId === 'string' && !idSet.has(binding.elementId)) {
          arrow[key] = null;
        }
      }
    }
    if (el.type === 'text') {
      const text = el as unknown as Record<string, unknown>;
      if (typeof text.containerId === 'string' && !idSet.has(text.containerId as string)) {
        text.containerId = null;
      }
    }
  }

  // Clear existing elements (tombstones for undo via history if batched).
  history?.startBatch();
  try {
    const existingElements = targetScene.getAllElements();
    for (const el of existingElements) {
      targetScene.deleteElement(el.id);
    }

    // Import elements
    for (const obj of valid) {
      targetScene.upsertElement(obj);
    }

    // Restore z-order exactly when the envelope carries it.
    if (elementOrder && elementOrder.length > 0) {
      const validIds = new Set(valid.map((el) => el.id));
      const restored = elementOrder.filter((id) => validIds.has(id));
      // Append any valid ids missing from the stored order (forward-compat).
      for (const el of valid) {
        if (!restored.includes(el.id)) restored.push(el.id);
      }
      targetScene.setElementOrder(restored);
    }
  } finally {
    history?.endBatch();
  }

  return { imported: valid.length, skipped: skipCount };
}
