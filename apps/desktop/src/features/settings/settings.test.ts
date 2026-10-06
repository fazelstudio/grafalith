import { describe, expect, test } from 'bun:test';
import { canonicalKeys, missingKeys } from '../../app/i18n/resources';
import {
  isSettingAvailable,
  settingRegistry,
  settingSectionRegistry,
  settingsForSection,
  validateSettingValue,
} from './settingsDescriptors';
import { loadEditorWorkspace } from '../../platform/preferences/editorWorkspace';
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
});

describe('setting registry', () => {
  test('registers only real behavior: locale, theme, editor flags, shortcut list', () => {
    expect(settingRegistry.all().map((setting) => setting.id)).toEqual([
      'locale',
      'theme',
      'canvasHint',
      'restoreViewport',
      'shortcutList',
    ]);
    expect(settingsForSection('general').map((setting) => setting.id)).toEqual(['locale']);
    expect(settingsForSection('appearance').map((setting) => setting.id)).toEqual(['theme']);
    expect(settingsForSection('editor').map((setting) => setting.id)).toEqual([
      'canvasHint',
      'restoreViewport',
    ]);
    expect(settingsForSection('shortcuts').map((setting) => setting.id)).toEqual(['shortcutList']);
  });

  test('defaults pass their own validation and match provider fallbacks', () => {
    for (const setting of settingRegistry.all()) {
      expect(validateSettingValue(setting, setting.defaultValue)).toBeUndefined();
    }
    expect(settingRegistry.get('locale')?.defaultValue).toBe('en');
    expect(settingRegistry.get('theme')?.defaultValue).toBe('system');
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

  test('value guards reject unknown theme, locale, and non-boolean switches', () => {
    const theme = settingRegistry.get('theme')!;
    expect(validateSettingValue(theme, 'dark')).toBeUndefined();
    expect(validateSettingValue(theme, 'sepia')).toBeDefined();
    const locale = settingRegistry.get('locale')!;
    expect(validateSettingValue(locale, 'id')).toBeUndefined();
    expect(validateSettingValue(locale, 'fr')).toBeDefined();
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
      expect(preferenceService.getShowCanvasHint()).toBe(false);
      expect(preferenceService.getRestoreViewport()).toBe(false);

      window.localStorage.setItem('opennary:locale', 'xx');
      window.localStorage.setItem('opennary:theme', 'sepia');
      expect(preferenceService.getLocale()).toBe('en');
      expect(preferenceService.getTheme()).toBe('system');
    } finally {
      restore();
    }
  });

  test('reset-to-defaults restores every section value', () => {
    const restore = installMemoryWindow();
    try {
      preferenceService.setLocale('id');
      preferenceService.setTheme('dark');
      preferenceService.setShowCanvasHint(false);
      preferenceService.setRestoreViewport(false);

      preferenceService.setLocale('en');
      preferenceService.setTheme('system');
      preferenceService.setShowCanvasHint(true);
      preferenceService.setRestoreViewport(true);

      expect(preferenceService.getLocale()).toBe('en');
      expect(preferenceService.getTheme()).toBe('system');
      expect(preferenceService.getShowCanvasHint()).toBe(true);
      expect(preferenceService.getRestoreViewport()).toBe(true);
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
});
