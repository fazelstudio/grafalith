import { panelRegistry } from '../../registries/panels';
import { toolRegistry } from '../../registries/tools';
import type { ViewportState } from '../../render/coords';

const WORKSPACE_KEY = 'opennary:editor-workspace';

/** Persisted editor chrome: tool, open panels, hint, viewports, and restore flag. */
export interface EditorWorkspace {
  activeTool: string;
  openPanels: string[];
  hintDismissed: boolean;
  viewports: Record<string, ViewportState>;
  /** Whether reopening a project restores its last canvas position. */
  restoreViewport: boolean;
}

function defaultWorkspace(): EditorWorkspace {
  return {
    activeTool: 'select',
    openPanels: panelRegistry.all().filter((panel) => panel.defaultOpen).map((panel) => panel.id),
    hintDismissed: false,
    viewports: {},
    restoreViewport: true,
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
  const hintDismissed = record['hintDismissed'] === true;
  const restoreViewport = record['restoreViewport'] === undefined ? true : record['restoreViewport'] === true;
  const viewports: Record<string, ViewportState> = {};
  if (typeof record['viewports'] === 'object' && record['viewports'] !== null) {
    for (const [projectId, viewport] of Object.entries(
      record['viewports'] as Record<string, unknown>,
    )) {
      if (isViewport(viewport)) viewports[projectId] = viewport;
    }
  }
  return { activeTool, openPanels, hintDismissed, viewports, restoreViewport };
}

/** Persist the whole workspace object after a caller-side mutation. */
export function saveEditorWorkspace(workspace: EditorWorkspace): void {
  writeStorage(JSON.stringify(workspace));
}

export const editorWorkspaceKey = WORKSPACE_KEY;
