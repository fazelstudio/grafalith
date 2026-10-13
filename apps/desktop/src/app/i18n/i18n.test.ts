import { describe, expect, test } from 'bun:test';
import { canonicalKeys, extraKeys, missingKeys } from './resources';
import { LOCALES } from './resources';
import {
  activityRegistry,
  appCommandRegistry,
  commandRegistry,
  menuRegistry,
  panelRegistry,
  toolRegistry,
} from '../../registries';
import { projectTemplateRegistry } from '../../features/projects/templateRegistry';
import { canvasPresetRegistry } from '../../features/projects/canvasPresets';
import { projectKindRegistry } from '../../features/projects/projectKinds';
import {
  settingRegistry,
  settingSectionRegistry,
} from '../../features/settings/settingsDescriptors';
import { allInspectorSections } from '../../features/editor/inspector/descriptors';
import { resolveIcon } from '../../ui/iconRegistry';
import { routeRegistry } from '../routing/routes';

describe('locale key sets', () => {
  test('english defines a non-empty canonical key set', () => {
    expect(canonicalKeys().length).toBeGreaterThan(0);
  });

  test('every locale mirrors the canonical key set', () => {
    for (const locale of LOCALES) {
      expect(missingKeys(locale)).toEqual([]);
      expect(extraKeys(locale)).toEqual([]);
    }
  });

  test('registry label keys resolve against the canonical set', () => {
    const canonical = new Set(canonicalKeys());
    for (const tool of toolRegistry.all()) {
      expect(canonical.has(tool.labelKey)).toBe(true);
      if (tool.descriptionKey) {
        expect(canonical.has(tool.descriptionKey)).toBe(true);
      }
    }
    for (const panel of panelRegistry.all()) {
      expect(canonical.has(panel.labelKey)).toBe(true);
      expect(canonical.has(panel.toggleKey)).toBe(true);
    }
    for (const command of commandRegistry.all()) {
      expect(canonical.has(command.labelKey)).toBe(true);
      if (command.descriptionKey) {
        expect(canonical.has(command.descriptionKey)).toBe(true);
      }
    }
    for (const command of appCommandRegistry.all()) {
      expect(canonical.has(command.labelKey)).toBe(true);
      if (command.descriptionKey) {
        expect(canonical.has(command.descriptionKey)).toBe(true);
      }
    }
    for (const row of menuRegistry.all()) {
      expect(canonical.has(row.labelKey)).toBe(true);
    }
    for (const activity of activityRegistry.all()) {
      expect(canonical.has(activity.labelKey)).toBe(true);
    }
    for (const setting of settingRegistry.all()) {
      expect(canonical.has(setting.labelKey)).toBe(true);
      if (setting.descriptionKey) {
        expect(canonical.has(setting.descriptionKey)).toBe(true);
      }
    }
    for (const section of settingSectionRegistry.all()) {
      expect(canonical.has(section.labelKey)).toBe(true);
    }
    for (const preset of canvasPresetRegistry.all()) {
      expect(canonical.has(preset.labelKey)).toBe(true);
    }
    for (const section of allInspectorSections()) {
      expect(canonical.has(section.titleKey)).toBe(true);
      for (const field of section.fields) {
        expect(canonical.has(field.labelKey)).toBe(true);
        if (field.placeholderKey) {
          expect(canonical.has(field.placeholderKey)).toBe(true);
        }
        for (const option of field.options ?? []) {
          expect(canonical.has(option.labelKey)).toBe(true);
        }
      }
    }
    for (const template of projectTemplateRegistry.all()) {
      expect(canonical.has(template.labelKey)).toBe(true);
      expect(canonical.has(template.descriptionKey)).toBe(true);
    }
    for (const kind of projectKindRegistry.all()) {
      expect(canonical.has(kind.labelKey)).toBe(true);
      expect(canonical.has(kind.hintKey)).toBe(true);
      expect(kind.icon === '').toBe(false);
      expect(resolveIcon(kind.icon)).toBeDefined();
    }
    for (const route of routeRegistry.all()) {
      expect(canonical.has(route.titleKey)).toBe(true);
      expect(canonical.has(route.navigationKey)).toBe(true);
    }
  });
});
