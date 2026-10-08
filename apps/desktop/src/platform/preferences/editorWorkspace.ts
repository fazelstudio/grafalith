import { panelRegistry } from '../../registries/panels';
import { toolRegistry } from '../../registries/tools';
import type { ViewportState } from '../../render/coords';
import { persistenceConfig } from '../projects/persistenceConfig';

const WORKSPACE_KEY = 'opennary:editor-workspace';

/** User-level editor dock sizing policy. */
export const EDITOR_DOCK_WIDTHS = {
  default: 264,
  min: 180,
  max: 420,
} as const;

/** Autosave debounce bounds shared with the persistence layer. */
export const AUTOSAVE_DELAY_MS = {
  default: persistenceConfig.autosaveDelayMs,
  min: persistenceConfig.autosaveDelayMinMs,
  max: persistenceConfig.autosaveDelayMaxMs,
} as const;

export type HomeViewMode = 'grid' | 'list';

/** Project list arrangements offered on the home page. */
export const HOME_VIEW_MODES: readonly HomeViewMode[] = ['grid', 'list'];
export const DEFAULT_HOME_VIEW_MODE: HomeViewMode = 'grid';

/** Type guard for persisted project list arrangements. */
export function isHomeViewMode(value: unknown): value is HomeViewMode {
  return value === 'grid' || value === 'list';
}

/** Persisted editor chrome: tool, open panels, hint, viewports, and restore flag. */
export interface EditorWorkspace {
  activeTool: string;
  openPanels: string[];
  leftPanelWidth: number;
  rightPanelWidth: number;
  hintDismissed: boolean;
  viewports: Record<string, ViewportState>;
  /** Whether reopening a project restores its last canvas position. */
  restoreViewport: boolean;
  homeViewMode: HomeViewMode;
  /** Whether engine changes trigger a debounced automatic save. */
  autosaveEnabled: boolean;
  /** Debounce between the last engine change and the next autosave. */
  autosaveDelayMs: number;
}

function defaultWorkspace(): EditorWorkspace {
  return {
    activeTool: 'select',
    openPanels: panelRegistry.all().filter((panel) => panel.defaultOpen).map((panel) => panel.id),
    leftPanelWidth: EDITOR_DOCK_WIDTHS.default,
    rightPanelWidth: EDITOR_DOCK_WIDTHS.default,
    hintDismissed: false,
    viewports: {},
    restoreViewport: true,
    homeViewMode: DEFAULT_HOME_VIEW_MODE,
    autosaveEnabled: persistenceConfig.autosaveEnabled,
    autosaveDelayMs: AUTOSAVE_DELAY_MS.default,
  };
}

function readStorage(): string | null {
  try {
    return window.localStorage.getItem(WORKSPACE_KEY);
  } catch {
    return null;
  }
}

function writeStorage(value: string): void {
  try {
    window.localStorage.setItem(WORKSPACE_KEY, value);
  } catch {
    // Private mode or unavailable storage: workspace stays in memory.
  }
}

function isViewport(value: unknown): value is ViewportState {
  if (typeof value !== 'object' || value === null) return false;
  const viewport = value as Record<string, unknown>;
  return (
    typeof viewport['scrollX'] === 'number' &&
    Number.isFinite(viewport['scrollX']) &&
    typeof viewport['scrollY'] === 'number' &&
    Number.isFinite(viewport['scrollY']) &&
    typeof viewport['zoom'] === 'number' &&
    Number.isFinite(viewport['zoom'])
  );
}

/** Normalize a persisted or measured dock width to the supported range. */
export function normalizeEditorDockWidth(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return EDITOR_DOCK_WIDTHS.default;
  return Math.min(EDITOR_DOCK_WIDTHS.max, Math.max(EDITOR_DOCK_WIDTHS.min, Math.round(value)));
}

/** Normalize a persisted autosave delay to the supported range. */
export function normalizeAutosaveDelayMs(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return AUTOSAVE_DELAY_MS.default;
  return Math.min(AUTOSAVE_DELAY_MS.max, Math.max(AUTOSAVE_DELAY_MS.min, Math.round(value)));
}

/** Load workspace preferences; unknown ids fall back to registry defaults. */
export function loadEditorWorkspace(): EditorWorkspace {
  const fallback = defaultWorkspace();
  const raw = readStorage();
  if (!raw) return fallback;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fallback;
  }
  if (typeof parsed !== 'object' || parsed === null) return fallback;
  const record = parsed as Record<string, unknown>;
  const activeTool =
    typeof record['activeTool'] === 'string' && toolRegistry.get(record['activeTool'])
      ? (record['activeTool'] as string)
      : fallback.activeTool;
  const openPanels = Array.isArray(record['openPanels'])
    ? (record['openPanels'] as unknown[]).filter(
        (id): id is string => typeof id === 'string' && panelRegistry.get(id) !== undefined,
      )
    : fallback.openPanels;
  const leftPanelWidth = normalizeEditorDockWidth(record['leftPanelWidth']);
  const rightPanelWidth = normalizeEditorDockWidth(record['rightPanelWidth']);
  const hintDismissed = record['hintDismissed'] === true;
  const restoreViewport = record['restoreViewport'] === undefined ? true : record['restoreViewport'] === true;
  const autosaveEnabled =
    record['autosaveEnabled'] === undefined ? true : record['autosaveEnabled'] === true;
  const autosaveDelayMs = normalizeAutosaveDelayMs(record['autosaveDelayMs']);
  const storedViewMode: unknown = record['homeViewMode'];
  const homeViewMode: HomeViewMode = isHomeViewMode(storedViewMode)
    ? storedViewMode
    : fallback.homeViewMode;
  const viewports: Record<string, ViewportState> = {};
  if (typeof record['viewports'] === 'object' && record['viewports'] !== null) {
    for (const [projectId, viewport] of Object.entries(
      record['viewports'] as Record<string, unknown>,
    )) {
      if (isViewport(viewport)) viewports[projectId] = viewport;
    }
  }
  return {
    activeTool,
    openPanels,
    leftPanelWidth,
    rightPanelWidth,
    hintDismissed,
    viewports,
    restoreViewport,
    homeViewMode,
    autosaveEnabled,
    autosaveDelayMs,
  };
}

/** Persist the whole workspace object after a caller-side mutation. */
export function saveEditorWorkspace(workspace: EditorWorkspace): void {
  writeStorage(JSON.stringify(workspace));
}

export const editorWorkspaceKey = WORKSPACE_KEY;
