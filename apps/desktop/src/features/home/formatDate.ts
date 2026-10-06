import type { Locale } from '../../app/i18n/resources';

/** Locale-aware short date for project metadata lines. */
export function formatProjectDate(ms: number, locale: Locale): string {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(ms));
  } catch {
    return new Date(ms).toLocaleDateString();
  }
}
