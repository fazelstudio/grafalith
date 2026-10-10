// Localized extension messages: stored-locale resolution with fallback.
import { afterEach, describe, expect, test } from 'bun:test';
import { formatExtensionMessage } from './extensionMessages';

/** Temporary in-memory `globalThis.localStorage` restored after each test. */
function installMemoryStorage(): void {
  const data = new Map<string, string>();
  (globalThis as Record<string, unknown>)['localStorage'] = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
}

afterEach(() => {
  installMemoryStorage();
});

describe('extension messages', () => {
  test('interpolates params in the stored locale', () => {
    installMemoryStorage();
    expect(formatExtensionMessage('notifications.extensions.disabled', { id: 'acme.tool' })).toBe(
      'Extension acme.tool disabled',
    );
    globalThis.localStorage?.setItem('grafalith:locale', 'id');
    expect(formatExtensionMessage('notifications.extensions.disabled', { id: 'acme.tool' })).toBe(
      'Ekstensi acme.tool dinonaktifkan',
    );
  });

  test('unknown locales and missing params fall back safely', () => {
    installMemoryStorage();
    globalThis.localStorage?.setItem('grafalith:locale', 'fr');
    expect(formatExtensionMessage('errors.boot.retry')).toBe('Retry');
    expect(formatExtensionMessage('notifications.extensions.toolFailed', { title: 'Pen' })).toBe(
      'Extension tool failed: Pen — {reason}',
    );
  });
});
