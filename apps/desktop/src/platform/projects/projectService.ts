import { createLocalProjectStore } from './localAdapter';
import { isTauriRuntime, tauriProjectStore } from './tauriAdapter';
import { persistenceConfig } from './persistenceConfig';
import type { ProjectOpenResult, ProjectSummary, TrashedProjectSummary } from './types';

/** Trash entries are permanently removed after this many days. */
export const TRASH_RETENTION_DAYS = persistenceConfig.trashRetentionDays;
export const TRASH_RETENTION_MS = persistenceConfig.trashRetentionMs;

/**
 * Desktop persistence boundary.
 *
 * - `ProjectStore` (this file): project index metadata + document payload
 *   persistence. Tauri owns privileged file/path ops in Rust; the browser
 *   fallback mirrors the same index/document split in localStorage.
 * - Document envelope + migration rules: `documentEnvelope.ts` (single
 *   version source shared by both backends).
 * - Ephemeral recovery snapshots: `recovery.ts` (never auto-overwrites).
 * - Preferences: `platform/preferences/preferenceService.ts` (independent
 *   keys, never inside project files).
 * - File-manager integration: `platform/files/fileService.ts` (explicitly
 *   unsupported until a backend exists).
 *
 * React screens and editor hooks use these services; they never parse OS
 * paths, touch project directories, or scatter raw Tauri `invoke` calls
 * for storage. Raw `invoke('project_*')` lives only in `tauriAdapter.ts`.
 */

/** Single store contract shared by the file backend and the browser store. */
export interface ProjectStore {
  list(): Promise<ProjectSummary[]>;
  listTrash(): Promise<TrashedProjectSummary[]>;
  purgeExpired(): Promise<void>;
  create(name: string, sceneJson: string): Promise<ProjectSummary>;
  open(id: string): Promise<ProjectOpenResult>;
  rename(id: string, name: string): Promise<ProjectSummary>;
  duplicate(id: string): Promise<ProjectSummary>;
  restore(id: string): Promise<ProjectSummary>;
  remove(id: string): Promise<void>;
  deletePermanently(id: string): Promise<void>;
  save(id: string, sceneJson: string): Promise<ProjectSummary>;
  favorite(id: string): Promise<ProjectSummary>;
  unfavorite(id: string): Promise<ProjectSummary>;
}

/**
 * Capability flags for operations supported by both desktop project stores.
 */
export const projectCapabilities = {
  supportsDuplicate: true,
  supportsDelete: true,
  supportsFavorite: true,
} as const;

let cached: ProjectStore | null = null;

/** Runtime-selected store; Tauri uses files, plain browsers use local data. */
export function getProjectStore(): ProjectStore {
  if (!cached) {
    cached = (isTauriRuntime() ? tauriProjectStore : createLocalProjectStore()) as ProjectStore;
  }
  return cached;
}

/** Test seam for injecting an isolated store without touching globals. */
export function setProjectStoreForTesting(store: ProjectStore | null): void {
  cached = store;
}

export type { ProjectOpenResult, ProjectSummary, TrashedProjectSummary };
