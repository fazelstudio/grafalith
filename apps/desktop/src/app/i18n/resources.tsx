import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import en from './en';
import id from './id';
import { DEFAULT_LOCALE, type Locale } from './locales';
import { preferenceService } from '../../platform/preferences/preferenceService';

export type { Locale } from './locales';
export { DEFAULT_LOCALE, LOCALES } from './locales';

const resources = { en, id } as const;

export type LocaleKey = string;

type NestedValue = string | { [key: string]: NestedValue };

function lookup(dict: NestedValue, key: string): string | undefined {
  const parts = key.split('.');
  let current: NestedValue | undefined = dict;
  for (const part of parts) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, NestedValue>)[part];
  }
  return typeof current === 'string' ? current : undefined;
}

/** Collect every leaf key (`a.b.c`) of a nested locale dictionary. */
export function collectKeys(dict: NestedValue, prefix = ''): string[] {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(dict)) {
    const full = prefix === '' ? key : `${prefix}.${key}`;
    if (typeof value === 'string') {
      keys.push(full);
    } else {
      keys.push(...collectKeys(value, full));
    }
  }
  return keys.sort();
}

/** Canonical production key set, defined by English resources. */
export function canonicalKeys(): string[] {
  return collectKeys(en as unknown as NestedValue);
}

/** Keys present in English but missing from the given locale. */
export function missingKeys(locale: Locale): string[] {
  if (locale === 'en') return [];
  const have = new Set(collectKeys(resources[locale] as unknown as NestedValue));
  return canonicalKeys().filter((key) => !have.has(key));
}

/** Keys in the given locale that have no English counterpart. */
export function extraKeys(locale: Locale): string[] {
  if (locale === 'en') return [];
  const canonical = new Set(canonicalKeys());
  return collectKeys(resources[locale] as unknown as NestedValue).filter((key) => !canonical.has(key));
}

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    params[name] !== undefined ? String(params[name]) : match,
  );
}

function translate(locale: Locale, key: string, params?: Record<string, string | number>): string {
  const direct = lookup(resources[locale] as unknown as NestedValue, key);
  if (direct !== undefined) return interpolate(direct, params);
  const fallback = lookup(en as unknown as NestedValue, key);
  if (fallback !== undefined) {
    if (import.meta.env.DEV) {
      console.warn(`[i18n] missing "${key}" for locale "${locale}", fell back to English`);
    }
    return interpolate(fallback, params);
  }
  if (import.meta.env.DEV) {
    console.warn(`[i18n] unknown key "${key}"`);
  }
  return key;
}

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  /** Localized string with English fallback and `{name}` interpolation. */
  t: (key: string, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue>({
  locale: DEFAULT_LOCALE,
  setLocale: () => undefined,
  t: (key) => key,
});

/** Locale provider with persisted selection and English fallback. */
export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => preferenceService.getLocale());

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    preferenceService.setLocale(next);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const t = useCallback(
    (key: string, params?: Record<string, string | number>) => translate(locale, key, params),
    [locale],
  );

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** Access the current locale and translator. */
export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}
