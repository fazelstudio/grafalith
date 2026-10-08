import {
  loadEditorWorkspace as loadWorkspace,
  normalizeAutosaveDelayMs,
  saveEditorWorkspace as saveWorkspace,
  type EditorWorkspace,
} from './editorWorkspace';
import {
  loadLocale as loadStoredLocale,
  saveLocale as saveStoredLocale,
} from './preferences';
import type { Locale } from '../../app/i18n/locales';
import type { ThemeMode } from '../../app/theme/tokens';
import type { HomeViewMode } from './editorWorkspace';
import { loadThemeMode as loadStoredTheme, saveThemeMode as saveStoredTheme } from './preferences';

function updateWorkspace(patch: Partial<EditorWorkspace>): EditorWorkspace {
  const next = { ...loadWorkspace(), ...patch };
  saveWorkspace(next);
  return next;
}

/**
 * PreferenceService: typed access to user settings persisted independently
 * from project documents. Theme, locale, and editor workspace each live
 * under their own storage key — never inside a project file and never in
 * one giant blob — so wiping a project cannot lose settings and changing
 * settings cannot dirty a document.
 */
export const preferenceService = {
  getTheme(): ThemeMode {
    return loadStoredTheme();
  },
  setTheme(mode: ThemeMode): void {
    saveStoredTheme(mode);
  },
  getLocale(): Locale {
    return loadStoredLocale();
  },
  setLocale(locale: Locale): void {
    saveStoredLocale(locale);
  },
  getWorkspace(): EditorWorkspace {
    return loadWorkspace();
  },
  setWorkspace(workspace: EditorWorkspace): void {
    saveWorkspace(workspace);
  },
  /** Whether the empty-canvas getting-started hint may show. */
  getShowCanvasHint(): boolean {
    return !loadWorkspace().hintDismissed;
  },
  setShowCanvasHint(show: boolean): void {
    updateWorkspace({ hintDismissed: !show });
  },
  /** Whether reopening a project restores its last canvas position. */
  getRestoreViewport(): boolean {
    return loadWorkspace().restoreViewport;
  },
  setRestoreViewport(restore: boolean): void {
    updateWorkspace({ restoreViewport: restore });
  },
  getHomeViewMode(): HomeViewMode {
    return loadWorkspace().homeViewMode;
  },
  setHomeViewMode(mode: HomeViewMode): void {
    updateWorkspace({ homeViewMode: mode });
  },
  /** Whether engine changes trigger a debounced automatic save. */
  getAutosaveEnabled(): boolean {
    return loadWorkspace().autosaveEnabled;
  },
  setAutosaveEnabled(enabled: boolean): void {
    updateWorkspace({ autosaveEnabled: enabled });
  },
  /** Debounce between the last engine change and the next autosave. */
  getAutosaveDelayMs(): number {
    return loadWorkspace().autosaveDelayMs;
  },
  setAutosaveDelayMs(delayMs: number): void {
    updateWorkspace({ autosaveDelayMs: normalizeAutosaveDelayMs(delayMs) });
  },
};

export type { EditorWorkspace, Locale, ThemeMode };
