/** Shared project types crossing the desktop storage boundary. */

/**
 * Editor family a project belongs to; stored in project metadata.
 * Mirrored by `PROJECT_KINDS` in `apps/desktop/src-tauri/src/projects.rs` —
 * extend both together; the kind registry
 * (`features/projects/projectKinds.ts`) owns everything else per family,
 * including creation-menu order.
 */
export type ProjectKind = 'design' | 'whiteboard' | 'slides';

/** Fallback kind for payloads written before kinds existed. */
export const DEFAULT_PROJECT_KIND: ProjectKind = 'design';

/** Type guard for kind values arriving over the IPC boundary. */
export function isProjectKind(value: unknown): value is ProjectKind {
  return value === 'design' || value === 'whiteboard' || value === 'slides';
}

/** Normalizes an unknown kind to a valid one; unknown values become design. */
export function normalizeProjectKind(value: unknown): ProjectKind {
  return isProjectKind(value) ? value : DEFAULT_PROJECT_KIND;
}

/** Display unit for fixed-canvas dimensions (CorelDRAW-style). */
export type CanvasUnit = 'px' | 'mm' | 'cm' | 'm' | 'in' | 'pt';

/** Canvas configuration stored in project metadata. */
export interface ProjectCanvas {
  /** `infinite` workboard or `fixed` page (engine `bounded`). */
  mode: 'infinite' | 'fixed';
  /** Page width in scene units (px at 96 DPI); ignored when infinite. */
  width: number;
  /** Page height in scene units (px at 96 DPI); ignored when infinite. */
  height: number;
  /** Display unit the dimensions were entered in. */
  unit: CanvasUnit;
}

/** Default canvas: unbounded workboard, matching the engine default. */
export const DEFAULT_PROJECT_CANVAS: ProjectCanvas = { mode: 'infinite', width: 0, height: 0, unit: 'px' };

/** Type guard for unit values arriving over the IPC boundary. */
export function isCanvasUnit(value: unknown): value is CanvasUnit {
  return value === 'px' || value === 'mm' || value === 'cm' || value === 'm' || value === 'in' || value === 'pt';
}

/** Normalizes stored canvas config; anything invalid becomes infinite. */
export function normalizeProjectCanvas(value: unknown): ProjectCanvas {
  if (typeof value !== 'object' || value === null) return { ...DEFAULT_PROJECT_CANVAS };
  const record = value as Record<string, unknown>;
  if (record['mode'] !== 'fixed') return { ...DEFAULT_PROJECT_CANVAS };
  const width = record['width'];
  const height = record['height'];
  if (typeof width !== 'number' || typeof height !== 'number' || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { ...DEFAULT_PROJECT_CANVAS };
  }
  const unit = record['unit'];
  return { mode: 'fixed', width, height, unit: isCanvasUnit(unit) ? unit : 'px' };
}

export interface ProjectSummary {
  id: string;
  name: string;
  /** Editor family; absent in payloads written before kinds existed. */
  kind: ProjectKind;
  /** Canvas configuration; absent in payloads written before it existed. */
  canvas: ProjectCanvas;
  createdAtMs: number;
  updatedAtMs: number;
  lastOpenedAtMs?: number;
  deletedAtMs?: number;
  schemaVersion: number;
  /** False when the metadata survived but the scene payload is gone. */
  documentExists: boolean;
  /** Backend identifier consumed by the offline affordance. */
  storage: string;
  /** Time the project was favorited; absent for unfavorited projects. */
  favoriteAtMs?: number;
}

/** Summary for a project in Trash with the time its retention period began. */
export type TrashedProjectSummary = ProjectSummary & { deletedAtMs: number };

export interface ProjectOpenResult {
  summary: ProjectSummary;
  sceneJson: string;
}

/** Typed storage failure; `messageKey` resolves through locale resources. */
export interface ProjectError {
  code: string;
  messageKey: string;
  details?: string;
  recoverable: boolean;
}

const FALLBACK_ERROR: ProjectError = {
  code: 'storage-unavailable',
  messageKey: 'projects.errors.storageUnavailable',
  recoverable: true,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function errorText(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  if (raw instanceof Error) return raw.message;
  if (!isRecord(raw)) return '';
  if (typeof raw.message === 'string') return raw.message;
  if (typeof raw.error === 'string') return raw.error;
  if (typeof raw.data === 'string') return raw.data;
  return '';
}

/** Normalizes Tauri rejections and malformed payloads into one error shape. */
export function parseProjectError(raw: unknown): ProjectError {
  const text = errorText(raw);
  if (text !== '') {
    try {
      const parsed: unknown = JSON.parse(text);
      if (isRecord(parsed) && typeof parsed.code === 'string') {
        return {
          code: parsed.code,
          messageKey:
            typeof parsed.messageKey === 'string'
              ? parsed.messageKey
              : FALLBACK_ERROR.messageKey,
          details:
            typeof parsed.details === 'string' ? parsed.details : undefined,
          recoverable:
            typeof parsed.recoverable === 'boolean'
              ? parsed.recoverable
              : true,
        };
      }
    } catch {
      // Fall through to the generic envelope below.
    }
  }
  if (isRecord(raw) && typeof raw.code === 'string') {
    return {
      code: raw.code,
      messageKey:
        typeof raw.messageKey === 'string'
          ? raw.messageKey
          : FALLBACK_ERROR.messageKey,
      details: typeof raw.details === 'string' ? raw.details : undefined,
      recoverable:
        typeof raw.recoverable === 'boolean' ? raw.recoverable : true,
    };
  }
  if (text !== '') {
    return {
      ...FALLBACK_ERROR,
      details: text,
    };
  }
  return { ...FALLBACK_ERROR };
}

/** Type guard for summary payloads arriving over the IPC boundary. */
export function isProjectSummary(value: unknown): value is ProjectSummary {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    (value.kind === undefined || isProjectKind(value.kind)) &&
    typeof value.createdAtMs === 'number' &&
    typeof value.updatedAtMs === 'number' &&
    (value.deletedAtMs === undefined || typeof value.deletedAtMs === 'number') &&
    (value.favoriteAtMs === undefined || typeof value.favoriteAtMs === 'number') &&
    typeof value.schemaVersion === 'number' &&
    typeof value.documentExists === 'boolean'
  );
}
