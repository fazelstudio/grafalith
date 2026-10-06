/** Shared project types crossing the desktop storage boundary. */

export interface ProjectSummary {
  id: string;
  name: string;
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

/** Normalizes Tauri rejections and malformed payloads into one error shape. */
export function parseProjectError(raw: unknown): ProjectError {
  const text =
    typeof raw === 'string' ? raw : raw instanceof Error ? raw.message : '';
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
  return { ...FALLBACK_ERROR };
}

/** Type guard for summary payloads arriving over the IPC boundary. */
export function isProjectSummary(value: unknown): value is ProjectSummary {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.createdAtMs === 'number' &&
    typeof value.updatedAtMs === 'number' &&
    (value.deletedAtMs === undefined || typeof value.deletedAtMs === 'number') &&
    (value.favoriteAtMs === undefined || typeof value.favoriteAtMs === 'number') &&
    typeof value.schemaVersion === 'number' &&
    typeof value.documentExists === 'boolean'
  );
}
