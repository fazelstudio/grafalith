import { invoke } from '@tauri-apps/api/core';
import {
  isProjectSummary,
  normalizeProjectKind,
  parseProjectError,
  type ProjectError,
  type ProjectKind,
  type ProjectOpenResult,
  type ProjectSummary,
  type TrashedProjectSummary,
} from './types';

function parseSummary(raw: string): ProjectSummary {
  const parsed: unknown = JSON.parse(raw);
  if (!isProjectSummary(parsed)) {
    throw parseProjectError(
      JSON.stringify({
        code: 'unreadable',
        messageKey: 'projects.errors.unreadable',
        recoverable: false,
      }),
    );
  }
  // Payloads written before kinds existed carry no kind; normalize keeps
  // every summary on the current union instead of threading optionals.
  return { ...parsed, kind: normalizeProjectKind(parsed.kind) };
}

function parseOpen(raw: string): ProjectOpenResult {
  const parsed: unknown = JSON.parse(raw);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('summary' in parsed) ||
    !('sceneJson' in parsed)
  ) {
    throw parseProjectError(
      JSON.stringify({
        code: 'unreadable',
        messageKey: 'projects.errors.unreadable',
        recoverable: false,
      }),
    );
  }
  const { summary, sceneJson } = parsed as {
    summary: unknown;
    sceneJson: unknown;
  };
  if (!isProjectSummary(summary) || typeof sceneJson !== 'string') {
    throw parseProjectError(
      JSON.stringify({
        code: 'unreadable',
        messageKey: 'projects.errors.unreadable',
        recoverable: false,
      }),
    );
  }
  return { summary: { ...summary, kind: normalizeProjectKind(summary.kind) }, sceneJson };
}

/** True inside the Tauri webview; false for plain browser dev/preview. */
export function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as Record<string, unknown>;
  return '__TAURI__' in w || '__TAURI_INTERNALS__' in w;
}

async function call<T>(command: string, args: Record<string, unknown>, parse: (raw: string) => T): Promise<T> {
  try {
    const raw = await invoke<string>(command, args);
    return parse(raw);
  } catch (raw) {
    throw parseProjectError(raw);
  }
}

/** File-backed project store; every op runs locally with no network use. */
export const tauriProjectStore = {
  async list(): Promise<ProjectSummary[]> {
    return call('project_list', {}, (raw) => {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(isProjectSummary);
    });
  },

  async listTrash(): Promise<TrashedProjectSummary[]> {
    return call('project_trash_list', {}, (raw) => {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (entry): entry is TrashedProjectSummary =>
          isProjectSummary(entry) && typeof entry.deletedAtMs === 'number',
      );
    });
  },

  async purgeExpired(): Promise<void> {
    await call('project_purge_expired', {}, () => undefined);
  },

  async create(name: string, sceneJson: string, kind?: ProjectKind): Promise<ProjectSummary> {
    return call('project_create', { name, sceneJson, kind: normalizeProjectKind(kind) }, parseSummary);
  },

  async open(id: string): Promise<ProjectOpenResult> {
    return call('project_open', { id }, parseOpen);
  },

  async preview(id: string): Promise<ProjectOpenResult> {
    return call('project_preview', { id }, parseOpen);
  },

  async rename(id: string, name: string): Promise<ProjectSummary> {
    return call('project_rename', { id, name }, parseSummary);
  },

  async duplicate(id: string): Promise<ProjectSummary> {
    return call('project_duplicate', { id }, parseSummary);
  },

  async remove(id: string): Promise<void> {
    await call('project_delete', { id }, () => undefined);
  },

  async restore(id: string): Promise<ProjectSummary> {
    return call('project_restore', { id }, parseSummary);
  },

  async deletePermanently(id: string): Promise<void> {
    await call('project_delete_permanently', { id }, () => undefined);
  },

  async save(id: string, sceneJson: string): Promise<ProjectSummary> {
    return call('project_save', { id, sceneJson }, parseSummary);
  },

  async favorite(id: string): Promise<ProjectSummary> {
    return call('project_favorite', { id }, parseSummary);
  },

  async unfavorite(id: string): Promise<ProjectSummary> {
    return call('project_unfavorite', { id }, parseSummary);
  },
};

export type { ProjectError };
