// Localized extension messages for non-React platform code.
//
// The extension host, watcher, and fatal dialog run outside the React
// tree, so they cannot use `useI18n`. They resolve through the single
// locale registry (`app/i18n/resources`) instead, keeping every
// user-facing string in `app/i18n` while system logs stay plain English
// at call sites.
import { isLocale, translateKey } from '../../app/i18n/resources';

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
// module runs before the provider mounts.
const LOCALE_STORAGE_KEY = 'grafalith:locale';

function storedLocale(): 'en' | 'id' {
  try {
    const stored = globalThis.localStorage?.getItem(LOCALE_STORAGE_KEY);
    return isLocale(stored) ? stored : 'en';
  } catch {
    return 'en';
  }
}

/**
 * Resolve a user-facing extension message in the stored locale with
 * English fallback. System logs and output channels never go through
 * here — they stay English at their call sites.
 */
export function formatExtensionMessage(key: ExtensionMessageKey, params: MessageParams = {}): string {
  return translateKey(storedLocale(), key, params);
}
