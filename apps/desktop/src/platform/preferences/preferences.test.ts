import { describe, expect, test } from 'bun:test';
import { isLocale } from '../../app/i18n/locales';
import { loadLocale, loadThemeMode, saveLocale, saveThemeMode } from './preferences';

describe('preferences', () => {
  test('theme defaults to system and locale to english without storage', () => {
    expect(loadThemeMode()).toBe('system');
    expect(loadLocale()).toBe('en');
  });

  test('saving preferences never throws without storage', () => {
    expect(() => saveThemeMode('dark')).not.toThrow();
    expect(() => saveLocale('id')).not.toThrow();
  });

  test('unknown persisted locales are rejected', () => {
    expect(isLocale('en')).toBe(true);
    expect(isLocale('id')).toBe(true);
    expect(isLocale('fr')).toBe(false);
    expect(isLocale(null)).toBe(false);
  });
});
