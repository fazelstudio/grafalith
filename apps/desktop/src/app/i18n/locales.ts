export type Locale = 'en' | 'id';
export const LOCALES: readonly Locale[] = ['en', 'id'];
export const DEFAULT_LOCALE: Locale = 'en';

/** Locale selection entry; the settings UI renders this list directly. */
export interface LocaleMeta {
  code: Locale;
  nameKey: string;
}

/**
 * Single registry for available locales. Adding a locale means appending
 * one entry here plus one resource directory beside `en` and `id`.
 */
export const LOCALE_LIST: readonly LocaleMeta[] = [
  { code: 'en', nameKey: 'settings.general.localeNames.en' },
  { code: 'id', nameKey: 'settings.general.localeNames.id' },
];

/** Type guard for persisted locale values. */
export function isLocale(value: unknown): value is Locale {
  return value === 'en' || value === 'id';
}
