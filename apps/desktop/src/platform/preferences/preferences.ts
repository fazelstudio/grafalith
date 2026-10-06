import { DEFAULT_THEME_MODE, isThemeMode, type ThemeMode } from '../../app/theme/tokens';
import { DEFAULT_LOCALE, isLocale, type Locale } from '../../app/i18n/locales';

const THEME_KEY = 'opennary:theme';
const LOCALE_KEY = 'opennary:locale';

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private mode or unavailable storage: preferences stay in memory.
  }
}

/** Persisted theme preference; falls back to System on unknown values. */
export function loadThemeMode(): ThemeMode {
  const raw = readStorage(THEME_KEY);
  return isThemeMode(raw) ? raw : DEFAULT_THEME_MODE;
}

export function saveThemeMode(mode: ThemeMode): void {
  writeStorage(THEME_KEY, mode);
}

/** Persisted locale preference; falls back to English on unknown values. */
export function loadLocale(): Locale {
  const raw = readStorage(LOCALE_KEY);
  return isLocale(raw) ? raw : DEFAULT_LOCALE;
}

export function saveLocale(locale: Locale): void {
  writeStorage(LOCALE_KEY, locale);
}

export const preferenceKeys = { THEME_KEY, LOCALE_KEY };
