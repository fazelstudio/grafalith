// Localized extension messages for non-React platform code.
//
// The extension host, watcher, and fatal dialog run outside the React
// tree, so they cannot use `useI18n`. This resolver reads the same
// persisted locale and dictionaries instead, keeping every user-facing
// string in `app/i18n` while system logs stay plain English at call sites.
import enErrors from '../../app/i18n/en/errors';
import enExtensions from '../../app/i18n/en/extensions';
import enNotifications from '../../app/i18n/en/notifications';
import idErrors from '../../app/i18n/id/errors';
import idExtensions from '../../app/i18n/id/extensions';
import idNotifications from '../../app/i18n/id/notifications';

/** Message keys with `{placeholder}` params resolved outside React. */
export type ExtensionMessageKey =
  | 'notifications.extensions.manifestInvalid'
  | 'notifications.extensions.engineIncompatible'
  | 'notifications.extensions.archiveNoManifest'
  | 'notifications.extensions.archiveManifestInvalid'
  | 'notifications.extensions.entryMissing'
  | 'notifications.extensions.invalidEntry'
  | 'notifications.extensions.activationFailed'
  | 'notifications.extensions.activationTimeout'
  | 'notifications.extensions.permissionDenied'
  | 'notifications.extensions.missingDependency'
  | 'notifications.extensions.blockedDependency'
  | 'notifications.extensions.circularDependency'
  | 'notifications.extensions.dependencyIncompatible'
  | 'notifications.extensions.contributionsSkipped'
  | 'notifications.extensions.disabled'
  | 'notifications.extensions.reloaded'
  | 'notifications.extensions.uninstalled'
  | 'notifications.extensions.reloadFailed'
  | 'notifications.extensions.toolFailed'
  | 'errors.boot.title'
  | 'errors.boot.description'
  | 'errors.boot.retry'
  | 'extensions.error.title'
  | 'extensions.error.retry';

type MessageParams = Record<string, string | number>;

// Same persisted key the boot preferences use; read directly because this
// module must stay independent of the provider and preference service.
const LOCALE_STORAGE_KEY = 'grafalith:locale';

function storedLocale(): 'en' | 'id' {
  try {
    return globalThis.localStorage?.getItem(LOCALE_STORAGE_KEY) === 'id' ? 'id' : 'en';
  } catch {
    return 'en';
  }
}

const tables = {
  en: { notifications: enNotifications, errors: enErrors, extensions: enExtensions },
  id: { notifications: idNotifications, errors: idErrors, extensions: idExtensions },
} as const;

function lookup(key: ExtensionMessageKey, locale: 'en' | 'id'): string | undefined {
  const [category, ...rest] = key.split('.');
  let node: unknown =
    tables[locale][category as keyof (typeof tables)['en']];
  for (const part of rest) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : undefined;
}

function interpolate(template: string, params: MessageParams): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    params[name] === undefined ? match : String(params[name]),
  );
}

/**
 * Resolve a user-facing extension message in the stored locale with
 * English fallback. System logs and output channels never go through
 * here — they stay English at their call sites.
 */
export function formatExtensionMessage(key: ExtensionMessageKey, params: MessageParams = {}): string {
  const locale = storedLocale();
  const template = lookup(key, locale) ?? lookup(key, 'en') ?? key;
  return interpolate(template, params);
}
