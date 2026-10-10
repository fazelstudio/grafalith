import {
  PROJECT_FORMAT_VERSION,
  validateScenePayload,
} from './documentEnvelope';
import { persistenceConfig } from './persistenceConfig';
import {
  DEFAULT_PROJECT_KIND,
  normalizeProjectKind,
  parseProjectError,
  type ProjectError,
  type ProjectKind,
  type ProjectOpenResult,
  type ProjectSummary,
  type TrashedProjectSummary,
} from './types';

/** Browser-runtime index/document split mirroring the Tauri file layout. */
const INDEX_KEY = 'grafalith:projects:index:v1';
const docKey = (id: string): string => `grafalith:projects:doc:${id}`;

interface StoredMeta {
  id: string;
  name: string;
  /** Editor family; entries written before kinds existed have no value. */
  kind?: ProjectKind;
  createdAtMs: number;
  updatedAtMs: number;
  lastOpenedAtMs?: number;
  deletedAtMs?: number;
  schemaVersion: number;
  formatVersion: number;
  favoriteAtMs?: number;
}

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function backingStorage(): KeyValueStorage {
  if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  throw parseProjectError(
    JSON.stringify({
      code: 'storage-unavailable',
      messageKey: 'projects.errors.storageUnavailable',
      recoverable: true,
    }),
  );
}

function readIndex(storage: KeyValueStorage): StoredMeta[] {
  const raw = storage.getItem(INDEX_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is StoredMeta =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as StoredMeta).id === 'string' &&
        typeof (entry as StoredMeta).name === 'string' &&
        ((entry as StoredMeta).deletedAtMs === undefined ||
          typeof (entry as StoredMeta).deletedAtMs === 'number'),
    );
  } catch {
    return [];
  }
}

function writeIndex(storage: KeyValueStorage, metas: StoredMeta[]): void {
  storage.setItem(INDEX_KEY, JSON.stringify(metas));
}

function checkScene(sceneJson: string): number {
  return validateScenePayload(sceneJson);
}

function cleanName(name: string): string {
  const trimmed = name.trim();
  if (trimmed === '') {
    throw parseProjectError(
      JSON.stringify({
        code: 'invalid-name',
        messageKey: 'projects.errors.invalidName',
        recoverable: false,
      }),
    );
  }
  if ([...trimmed].length > persistenceConfig.maxNameLength) {
    throw parseProjectError(
      JSON.stringify({
        code: 'invalid-name',
        messageKey: 'projects.errors.nameTooLong',
        details: String(persistenceConfig.maxNameLength),
        recoverable: false,
      }),
    );
  }
  return trimmed;
}

function toSummary(meta: StoredMeta, documentExists: boolean): ProjectSummary {
  return {
    id: meta.id,
    name: meta.name,
    kind: normalizeProjectKind(meta.kind),
    createdAtMs: meta.createdAtMs,
    updatedAtMs: meta.updatedAtMs,
    lastOpenedAtMs: meta.lastOpenedAtMs,
    deletedAtMs: meta.deletedAtMs,
    schemaVersion: meta.schemaVersion,
    documentExists,
    storage: 'local',
    favoriteAtMs: meta.favoriteAtMs,
  };
}

function sortMetas(metas: StoredMeta[]): StoredMeta[] {
  return [...metas].sort((a, b) => {
    const aFav = a.favoriteAtMs;
    const bFav = b.favoriteAtMs;
    if (aFav !== undefined && bFav !== undefined) {
      if (bFav !== aFav) return bFav - aFav;
    } else if (aFav !== undefined || bFav !== undefined) {
      return aFav !== undefined ? -1 : 1;
    }
    return (b.lastOpenedAtMs ?? b.updatedAtMs) - (a.lastOpenedAtMs ?? a.updatedAtMs);
  });
}

function makeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `p-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  }
  return `p-${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffffff).toString(36)}`;
}

function pruneExpired(storage: KeyValueStorage, metas: StoredMeta[], now: number): StoredMeta[] {
  const retained = metas.filter((meta) => {
    if (
      meta.deletedAtMs === undefined ||
      now - meta.deletedAtMs < persistenceConfig.trashRetentionMs
    ) {
      return true;
    }
    storage.removeItem(docKey(meta.id));
    return false;
  });
  if (retained.length !== metas.length) writeIndex(storage, retained);
  return retained;
}

function missingProject(id: string): ProjectError {
  return parseProjectError(
    JSON.stringify({
      code: 'not-found',
      messageKey: 'projects.errors.missing',
      details: id,
      recoverable: false,
    }),
  );
}

/** Browser-runtime project store with the same contract as the file backend. */
export function createLocalProjectStore(storage: KeyValueStorage = backingStorage()) {
  return {
    async list(): Promise<ProjectSummary[]> {
      const metas = sortMetas(pruneExpired(storage, readIndex(storage), Date.now()));
      return metas
        .filter((meta) => meta.deletedAtMs === undefined)
        .map((meta) => toSummary(meta, storage.getItem(docKey(meta.id)) !== null));
    },

    async listTrash(): Promise<TrashedProjectSummary[]> {
      const metas = pruneExpired(storage, readIndex(storage), Date.now());
      return metas
        .filter((meta): meta is StoredMeta & { deletedAtMs: number } => meta.deletedAtMs !== undefined)
        .sort((a, b) => b.deletedAtMs - a.deletedAtMs)
        .map((meta) => ({
          ...toSummary(meta, storage.getItem(docKey(meta.id)) !== null),
          deletedAtMs: meta.deletedAtMs,
        }));
    },

    async purgeExpired(): Promise<void> {
      pruneExpired(storage, readIndex(storage), Date.now());
    },

    async create(name: string, sceneJson: string, kind: ProjectKind = DEFAULT_PROJECT_KIND): Promise<ProjectSummary> {
      const clean = cleanName(name);
      const version = checkScene(sceneJson);
      const now = Date.now();
      const meta: StoredMeta = {
        id: makeId(),
        name: clean,
        kind: normalizeProjectKind(kind),
        createdAtMs: now,
        updatedAtMs: now,
        lastOpenedAtMs: now,
        schemaVersion: version,
        formatVersion: PROJECT_FORMAT_VERSION,
      };
      storage.setItem(docKey(meta.id), sceneJson);
      writeIndex(storage, [...readIndex(storage), meta]);
      return toSummary(meta, true);
    },

    async open(id: string): Promise<ProjectOpenResult> {
      const metas = readIndex(storage);
      const meta = metas.find((entry) => entry.id === id);
      if (!meta || meta.deletedAtMs !== undefined) throw missingProject(id);
      const sceneJson = storage.getItem(docKey(id));
      if (sceneJson === null) {
        throw parseProjectError(
          JSON.stringify({
            code: 'missing-document',
            messageKey: 'projects.errors.missing',
            details: meta.name,
            recoverable: false,
          }),
        );
      }
      checkScene(sceneJson);
      const next: StoredMeta = { ...meta, lastOpenedAtMs: Date.now() };
      writeIndex(
        storage,
        metas.map((entry) => (entry.id === id ? next : entry)),
      );
      return { summary: toSummary(next, true), sceneJson };
    },

    async preview(id: string): Promise<ProjectOpenResult> {
      const metas = readIndex(storage);
      const meta = metas.find((entry) => entry.id === id);
      if (!meta || meta.deletedAtMs !== undefined) throw missingProject(id);
      const sceneJson = storage.getItem(docKey(id));
      if (sceneJson === null) {
        throw parseProjectError(
          JSON.stringify({
            code: 'missing-document',
            messageKey: 'projects.errors.missing',
            details: meta.name,
            recoverable: false,
          }),
        );
      }
      checkScene(sceneJson);
      return { summary: toSummary(meta, true), sceneJson };
    },

    async rename(id: string, name: string): Promise<ProjectSummary> {
      const clean = cleanName(name);
      const metas = readIndex(storage);
      const meta = metas.find((entry) => entry.id === id);
      if (!meta || meta.deletedAtMs !== undefined) throw missingProject(id);
      const next: StoredMeta = { ...meta, name: clean, updatedAtMs: Date.now() };
      writeIndex(
        storage,
        metas.map((entry) => (entry.id === id ? next : entry)),
      );
      return toSummary(next, storage.getItem(docKey(id)) !== null);
    },

    async duplicate(id: string): Promise<ProjectSummary> {
      const metas = readIndex(storage);
      const source = metas.find((entry) => entry.id === id);
      if (!source || source.deletedAtMs !== undefined) throw missingProject(id);
      const sceneJson = storage.getItem(docKey(id));
      if (sceneJson === null) {
        throw parseProjectError(
          JSON.stringify({
            code: 'missing-document',
            messageKey: 'projects.errors.missing',
            details: source.name,
            recoverable: false,
          }),
        );
      }
      checkScene(sceneJson);
      const now = Date.now();
      const meta: StoredMeta = {
        id: makeId(),
        name: `${source.name} copy`.slice(0, persistenceConfig.maxNameLength),
        kind: normalizeProjectKind(source.kind),
        createdAtMs: now,
        updatedAtMs: now,
        lastOpenedAtMs: now,
        schemaVersion: source.schemaVersion,
        formatVersion: PROJECT_FORMAT_VERSION,
      };
      storage.setItem(docKey(meta.id), sceneJson);
      writeIndex(storage, [...metas, meta]);
      return toSummary(meta, true);
    },

    async remove(id: string): Promise<void> {
      const metas = readIndex(storage);
      const source = metas.find((entry) => entry.id === id);
      if (!source || source.deletedAtMs !== undefined) throw missingProject(id);
      writeIndex(
        storage,
        metas.map((entry) =>
          entry.id === id ? { ...entry, deletedAtMs: Date.now() } : entry,
        ),
      );
    },

    async restore(id: string): Promise<ProjectSummary> {
      const metas = pruneExpired(storage, readIndex(storage), Date.now());
      const source = metas.find((entry) => entry.id === id);
      if (!source || source.deletedAtMs === undefined) throw missingProject(id);
      const restored: StoredMeta = { ...source, deletedAtMs: undefined };
      writeIndex(storage, metas.map((entry) => (entry.id === id ? restored : entry)));
      return toSummary(restored, storage.getItem(docKey(id)) !== null);
    },

    async deletePermanently(id: string): Promise<void> {
      const metas = readIndex(storage);
      if (!metas.some((entry) => entry.id === id && entry.deletedAtMs !== undefined)) {
        throw missingProject(id);
      }
      storage.removeItem(docKey(id));
      writeIndex(storage, metas.filter((entry) => entry.id !== id));
    },

    async save(id: string, sceneJson: string): Promise<ProjectSummary> {
      const version = checkScene(sceneJson);
      const metas = readIndex(storage);
      const meta = metas.find((entry) => entry.id === id);
      if (!meta || meta.deletedAtMs !== undefined) throw missingProject(id);
      storage.setItem(docKey(id), sceneJson);
      const next: StoredMeta = {
        ...meta,
        schemaVersion: version,
        updatedAtMs: Date.now(),
      };
      writeIndex(
        storage,
        metas.map((entry) => (entry.id === id ? next : entry)),
      );
      return toSummary(next, true);
    },

    async favorite(id: string): Promise<ProjectSummary> {
      const metas = readIndex(storage);
      const meta = metas.find((entry) => entry.id === id);
      if (!meta || meta.deletedAtMs !== undefined) throw missingProject(id);
      const next: StoredMeta = { ...meta, favoriteAtMs: Date.now() };
      writeIndex(
        storage,
        metas.map((entry) => (entry.id === id ? next : entry)),
      );
      return toSummary(next, storage.getItem(docKey(id)) !== null);
    },

    async unfavorite(id: string): Promise<ProjectSummary> {
      const metas = readIndex(storage);
      const meta = metas.find((entry) => entry.id === id);
      if (!meta || meta.deletedAtMs !== undefined) throw missingProject(id);
      const next: StoredMeta = { ...meta, favoriteAtMs: undefined };
      writeIndex(
        storage,
        metas.map((entry) => (entry.id === id ? next : entry)),
      );
      return toSummary(next, storage.getItem(docKey(id)) !== null);
    },
  };
}

/** Default browser store bound to `localStorage`. */
export function getLocalProjectStore() {
  return createLocalProjectStore();
}
