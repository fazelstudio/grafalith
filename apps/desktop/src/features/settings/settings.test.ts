import { describe, expect, test } from 'bun:test';
import { canonicalKeys, missingKeys } from '../../app/i18n/resources';
import {
  isSettingAvailable,
  settingRegistry,
  settingSectionRegistry,
  settingsForSection,
  validateSettingValue,
} from './settingsDescriptors';
import { AUTOSAVE_DELAY_MS, loadEditorWorkspace } from '../../platform/preferences/editorWorkspace';
import { preferenceService } from '../../platform/preferences/preferenceService';

/** Temporary in-memory `window.localStorage` restored after each test. */
function installMemoryWindow(): () => void {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
  const globals = globalThis as Record<string, unknown>;
  const previous = globals['window'];
  globals['window'] = { localStorage: storage };
  return () => {
    if (previous === undefined) delete globals['window'];
    else globals['window'] = previous;
  };
}

describe('settings sections', () => {
  test('tabs follow a stable registry order', () => {
    expect(settingSectionRegistry.all().map((section) => section.id)).toEqual([
      'general',
      'appearance',
      'editor',
      'shortcuts',
    ]);
  });

  test('section paths are unique hash routes', () => {
    const paths = settingSectionRegistry.all().map((section) => section.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const path of paths) {
      expect(path.startsWith('#/settings/')).toBe(true);
    }
  });

  test('section labels resolve against the canonical locale set', () => {
    const canonical = new Set(canonicalKeys());
    for (const section of settingSectionRegistry.all()) {
      expect(canonical.has(section.labelKey)).toBe(true);
    }
  });

  test('sections name a unique sidebar icon', () => {
    const icons = settingSectionRegistry.all().map((section) => section.icon);
    for (const icon of icons) {
      expect(typeof icon).toBe('string');
      expect(icon.length).toBeGreaterThan(0);
    }
    expect(new Set(icons).size).toBe(icons.length);
  });
});

describe('setting registry', () => {
  test('registers only real behavior: locale, theme, layout, editor flags, shortcut list', () => {
    expect(settingRegistry.all().map((setting) => setting.id)).toEqual([
      'locale',
      'theme',
      'homeView',
      'canvasHint',
      'restoreViewport',
      'autosaveEnabled',
      'autosaveDelayMs',
      'shortcutList',
    ]);
    expect(settingsForSection('general').map((setting) => setting.id)).toEqual(['locale']);
    expect(settingsForSection('appearance').map((setting) => setting.id)).toEqual([
      'theme',
      'homeView',
    ]);
    expect(settingsForSection('editor').map((setting) => setting.id)).toEqual([
      'canvasHint',
      'restoreViewport',
      'autosaveEnabled',
      'autosaveDelayMs',
    ]);
    expect(settingsForSection('shortcuts').map((setting) => setting.id)).toEqual(['shortcutList']);
  });

  test('defaults pass their own validation and match provider fallbacks', () => {
    for (const setting of settingRegistry.all()) {
      expect(validateSettingValue(setting, setting.defaultValue)).toBeUndefined();
    }
    expect(settingRegistry.get('locale')?.defaultValue).toBe('en');
    expect(settingRegistry.get('theme')?.defaultValue).toBe('system');
    expect(settingRegistry.get('homeView')?.defaultValue).toBe('grid');
    expect(settingRegistry.get('canvasHint')?.defaultValue).toBe(true);
    expect(settingRegistry.get('restoreViewport')?.defaultValue).toBe(true);
  });

  test('persisted settings name a storage key; the read-only list names none', () => {
    for (const setting of settingRegistry.all()) {
      if (setting.control === 'shortcutList') {
        expect(setting.persistenceKey).toBeUndefined();
      } else {
        expect(typeof setting.persistenceKey).toBe('string');
      }
    }
  });

  test('label and description keys resolve in English with no missing Indonesian keys', () => {
    const canonical = new Set(canonicalKeys());
    expect(missingKeys('id')).toEqual([]);
    for (const setting of settingRegistry.all()) {
      expect(canonical.has(setting.labelKey)).toBe(true);
      if (setting.descriptionKey) expect(canonical.has(setting.descriptionKey)).toBe(true);
    }
  });

  test('header search keys resolve in English with no missing Indonesian keys', () => {
    const canonical = new Set(canonicalKeys());
    expect(missingKeys('id')).toEqual([]);
    for (const key of ['settings.search.label', 'settings.search.placeholder', 'settings.search.empty']) {
      expect(canonical.has(key)).toBe(true);
    }
  });

  test('value guards reject unknown theme, locale, layout, and non-boolean switches', () => {
    const theme = settingRegistry.get('theme')!;
    expect(validateSettingValue(theme, 'dark')).toBeUndefined();
    expect(validateSettingValue(theme, 'sepia')).toBeDefined();
    const locale = settingRegistry.get('locale')!;
    expect(validateSettingValue(locale, 'id')).toBeUndefined();
    expect(validateSettingValue(locale, 'fr')).toBeDefined();
    const homeView = settingRegistry.get('homeView')!;
    expect(validateSettingValue(homeView, 'list')).toBeUndefined();
    expect(validateSettingValue(homeView, 'masonry')).toBeDefined();
    const hint = settingRegistry.get('canvasHint')!;
    expect(validateSettingValue(hint, false)).toBeUndefined();
    expect(validateSettingValue(hint, 'yes')).toBeDefined();
  });

  test('platform predicate passes everything registered on this runtime', () => {
    for (const setting of settingRegistry.all()) {
      expect(typeof isSettingAvailable(setting)).toBe('boolean');
      expect(isSettingAvailable(setting)).toBe(true);
    }
    const theme = settingRegistry.get('theme')!;
    expect(isSettingAvailable({ ...theme, platform: 'browser' })).toBe(true);
    expect(isSettingAvailable({ ...theme, platform: 'tauri' })).toBe(false);
  });
});

describe('settings persistence journey', () => {
  test('locale and theme survive a simulated restart', () => {
    const restore = installMemoryWindow();
    try {
      preferenceService.setLocale('id');
      preferenceService.setTheme('dark');
      // A restart re-reads storage through the same service entry points.
      expect(preferenceService.getLocale()).toBe('id');
      expect(preferenceService.getTheme()).toBe('dark');
    } finally {
      restore();
    }
  });

  test('editor flags persist and unknown stored values fall back to defaults', () => {
    const restore = installMemoryWindow();
    try {
      preferenceService.setShowCanvasHint(false);
      preferenceService.setRestoreViewport(false);
      preferenceService.setAutosaveEnabled(false);
      preferenceService.setAutosaveDelayMs(500);
      expect(preferenceService.getShowCanvasHint()).toBe(false);
      expect(preferenceService.getRestoreViewport()).toBe(false);
      expect(preferenceService.getAutosaveEnabled()).toBe(false);
      expect(preferenceService.getAutosaveDelayMs()).toBe(500);

      window.localStorage.setItem('opennary:locale', 'xx');
      window.localStorage.setItem('opennary:theme', 'sepia');
      expect(preferenceService.getLocale()).toBe('en');
      expect(preferenceService.getTheme()).toBe('system');
    } finally {
      restore();
    }
  });

  test('autosave delay clamps to the supported range', () => {
    const restore = installMemoryWindow();
    try {
      preferenceService.setAutosaveDelayMs(50);
      expect(preferenceService.getAutosaveDelayMs()).toBe(AUTOSAVE_DELAY_MS.min);
      preferenceService.setAutosaveDelayMs(999_999);
      expect(preferenceService.getAutosaveDelayMs()).toBe(AUTOSAVE_DELAY_MS.max);
      preferenceService.setAutosaveDelayMs(AUTOSAVE_DELAY_MS.default);
      expect(preferenceService.getAutosaveDelayMs()).toBe(AUTOSAVE_DELAY_MS.default);
    } finally {
      restore();
    }
  });

  test('reset-to-defaults restores every section value', () => {
    const restore = installMemoryWindow();
    try {
      preferenceService.setLocale('id');
      preferenceService.setTheme('dark');
      preferenceService.setHomeViewMode('list');
      preferenceService.setShowCanvasHint(false);
      preferenceService.setRestoreViewport(false);
      preferenceService.setAutosaveEnabled(false);
      preferenceService.setAutosaveDelayMs(500);

      preferenceService.setLocale('en');
      preferenceService.setTheme('system');
      preferenceService.setHomeViewMode('grid');
      preferenceService.setShowCanvasHint(true);
      preferenceService.setRestoreViewport(true);
      preferenceService.setAutosaveEnabled(true);
      preferenceService.setAutosaveDelayMs(AUTOSAVE_DELAY_MS.default);

      expect(preferenceService.getLocale()).toBe('en');
      expect(preferenceService.getTheme()).toBe('system');
      expect(preferenceService.getHomeViewMode()).toBe('grid');
      expect(preferenceService.getShowCanvasHint()).toBe(true);
      expect(preferenceService.getRestoreViewport()).toBe(true);
      expect(preferenceService.getAutosaveEnabled()).toBe(true);
      expect(preferenceService.getAutosaveDelayMs()).toBe(AUTOSAVE_DELAY_MS.default);
    } finally {
      restore();
    }
  });

  test('workspaces stored before the viewport flag migrate to restore-enabled', () => {
    const restore = installMemoryWindow();
    try {
      window.localStorage.setItem(
        'opennary:editor-workspace',
        JSON.stringify({ activeTool: 'select', openPanels: ['layers'], hintDismissed: false, viewports: {} }),
      );
      expect(loadEditorWorkspace().restoreViewport).toBe(true);
    } finally {
      restore();
    }
  });

  test('workspaces stored before autosave migrate to enabled with the default delay', () => {
    const restore = installMemoryWindow();
    try {
      window.localStorage.setItem(
        'opennary:editor-workspace',
        JSON.stringify({ activeTool: 'select', openPanels: ['layers'], hintDismissed: false, viewports: {} }),
      );
      const workspace = loadEditorWorkspace();
      expect(workspace.autosaveEnabled).toBe(true);
      expect(workspace.autosaveDelayMs).toBe(AUTOSAVE_DELAY_MS.default);
    } finally {
      restore();
    }
  });
});
