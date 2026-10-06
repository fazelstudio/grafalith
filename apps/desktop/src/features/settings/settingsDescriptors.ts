import { createRegistry, type Descriptor } from '../../registries';
import { DEFAULT_LOCALE, isLocale } from '../../app/i18n/locales';
import { DEFAULT_THEME_MODE, isThemeMode } from '../../app/theme/tokens';
import { isTauriRuntime } from '../../platform/projects/tauriAdapter';

/** Settings section; tab order follows `SETTING_SECTIONS`, not this union. */
export type SettingSection = 'general' | 'appearance' | 'editor' | 'shortcuts';

/** Control rendered for one setting; `shortcutList` is read-only. */
export type SettingControl = 'theme' | 'locale' | 'switch' | 'shortcutList';

/** Platform predicate: settings render only where they apply. */
export type SettingPlatform = 'all' | 'tauri' | 'browser';

/** Persisted value shape; every control maps to one of these. */
export type SettingValue = string | boolean;

/**
 * Descriptor for one user setting.
 *
 * Only settings backed by real implemented behavior are registered here:
 * locale and theme (independent persisted preferences), editor workspace
 * flags (canvas hint, viewport restore), and the read-only shortcut list.
 * Startup behavior and storage preferences are intentionally absent —
 * neither is implemented, and fake settings are worse than missing ones.
 */
export interface SettingDefinition extends Descriptor {
  section: SettingSection;
  descriptionKey?: string;
  defaultDescription?: string;
  control: SettingControl;
  /** Value applied by reset-to-defaults. */
  defaultValue: SettingValue;
  /** Storage key holding the value; absent for read-only controls. */
  persistenceKey?: string;
  /** Where the setting applies; absent means every platform. */
  platform?: SettingPlatform;
  /** Value guard; absent means any value of the control shape. */
  validate?: (value: unknown) => boolean;
}

/** Descriptor for one settings tab; tab order is registration order. */
export interface SettingSectionDefinition extends Descriptor {
  /** Hash path for the section, such as `#/settings/editor`. */
  path: string;
}

const SECTIONS: readonly SettingSectionDefinition[] = [
  {
    id: 'general',
    labelKey: 'settings.general.title',
    defaultLabel: 'General',
    path: '#/settings/general',
  },
  {
    id: 'appearance',
    labelKey: 'settings.appearance.title',
    defaultLabel: 'Appearance',
    path: '#/settings/appearance',
  },
  {
    id: 'editor',
    labelKey: 'settings.editor.title',
    defaultLabel: 'Editor',
    path: '#/settings/editor',
  },
  {
    id: 'shortcuts',
    labelKey: 'settings.shortcuts.title',
    defaultLabel: 'Shortcuts',
    path: '#/settings/shortcuts',
  },
];

/** Validated lookup over settings tabs in display order. */
export const settingSectionRegistry = createRegistry('setting-section', SECTIONS);

const SETTINGS: readonly SettingDefinition[] = [
  {
    id: 'locale',
    section: 'general',
    labelKey: 'settings.general.localeLabel',
    defaultLabel: 'Language',
    descriptionKey: 'settings.general.localeDescription',
    defaultDescription: 'Interface language. Applied without reload.',
    control: 'locale',
    defaultValue: DEFAULT_LOCALE,
    persistenceKey: 'opennary:locale',
    validate: isLocale,
  },
  {
    id: 'theme',
    section: 'appearance',
    labelKey: 'settings.appearance.themeLabel',
    defaultLabel: 'Theme',
    descriptionKey: 'settings.appearance.themeDescription',
    defaultDescription: 'Follow the system or choose a fixed theme.',
    control: 'theme',
    defaultValue: DEFAULT_THEME_MODE,
    persistenceKey: 'opennary:theme',
    validate: isThemeMode,
  },
  {
    id: 'canvasHint',
    section: 'editor',
    labelKey: 'settings.editor.canvasHintLabel',
    defaultLabel: 'Show canvas hint',
    descriptionKey: 'settings.editor.canvasHintDescription',
    defaultDescription: 'Show the getting-started hint on an empty canvas.',
    control: 'switch',
    defaultValue: true,
    persistenceKey: 'opennary:editor-workspace',
    validate: (value) => typeof value === 'boolean',
  },
  {
    id: 'restoreViewport',
    section: 'editor',
    labelKey: 'settings.editor.restoreViewportLabel',
    defaultLabel: 'Restore canvas position',
    descriptionKey: 'settings.editor.restoreViewportDescription',
    defaultDescription: 'Reopen each project at its last canvas position.',
    control: 'switch',
    defaultValue: true,
    persistenceKey: 'opennary:editor-workspace',
    validate: (value) => typeof value === 'boolean',
  },
  {
    id: 'shortcutList',
    section: 'shortcuts',
    labelKey: 'settings.shortcuts.title',
    defaultLabel: 'Shortcuts',
    descriptionKey: 'settings.shortcuts.fixedNote',
    defaultDescription: 'Shortcuts are fixed in this release.',
    control: 'shortcutList',
    defaultValue: '',
  },
];

/** Validated lookup over settings; screens render from this. */
export const settingRegistry = createRegistry('setting', SETTINGS, {
  validateItem: (setting) => {
    const keyed = setting.descriptionKey !== undefined;
    const described = setting.defaultDescription !== undefined;
    if (keyed !== described) {
      return `descriptionKey and defaultDescription must both be present or absent for id "${setting.id}"`;
    }
    if (
      setting.section !== 'general' &&
      setting.section !== 'appearance' &&
      setting.section !== 'editor' &&
      setting.section !== 'shortcuts'
    ) {
      return `unknown section "${setting.section}" for id "${setting.id}"`;
    }
    if (
      setting.platform !== undefined &&
      setting.platform !== 'all' &&
      setting.platform !== 'tauri' &&
      setting.platform !== 'browser'
    ) {
      return `unknown platform "${setting.platform}" for id "${setting.id}"`;
    }
    if (setting.validate && !setting.validate(setting.defaultValue)) {
      return `defaultValue fails validation for id "${setting.id}"`;
    }
    if (setting.control !== 'shortcutList' && setting.persistenceKey === undefined) {
      return `missing persistenceKey for id "${setting.id}"`;
    }
    return undefined;
  },
});

/** Settings for one tab in registration order. */
export function settingsForSection(section: SettingSection): readonly SettingDefinition[] {
  return settingRegistry.all().filter((setting) => setting.section === section);
}

/** Whether a setting applies on this runtime (platform predicate). */
export function isSettingAvailable(setting: SettingDefinition): boolean {
  if (setting.platform === undefined || setting.platform === 'all') return true;
  const tauri = isTauriRuntime();
  return setting.platform === 'tauri' ? tauri : !tauri;
}

/** Error message when a value fails the setting guard, or undefined when valid. */
export function validateSettingValue(setting: SettingDefinition, value: unknown): string | undefined {
  if (setting.validate && !setting.validate(value)) {
    return `invalid value for setting "${setting.id}"`;
  }
  return undefined;
}
