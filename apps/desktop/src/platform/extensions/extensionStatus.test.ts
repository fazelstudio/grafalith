// Extension status machine: transitions, failure persistence, reset.
import { afterEach, describe, expect, test } from 'bun:test';
import {
  getExtensionStatuses,
  isActiveStatus,
  isFailureStatus,
  resetExtensionStatuses,
} from './extensionStatus';

afterEach(() => {
  resetExtensionStatuses();
});

describe('extension status store', () => {
  test('unseen extensions start DISCOVERED', () => {
    expect(getExtensionStatuses().get('acme.new')).toBe('DISCOVERED');
  });

  test('failure states are classified', () => {
    expect(isFailureStatus('ACTIVATION_FAILED')).toBe(true);
    expect(isFailureStatus('INVALID_MANIFEST')).toBe(true);
    expect(isFailureStatus('CIRCULAR_DEPENDENCY')).toBe(true);
    expect(isFailureStatus('ACTIVE')).toBe(false);
    expect(isFailureStatus('DISABLED')).toBe(false);
    expect(isActiveStatus('ACTIVE')).toBe(true);
    expect(isActiveStatus('DISABLED')).toBe(false);
  });

  test('status changes notify listeners with reasons', () => {
    const seen: string[] = [];
    const subscription = getExtensionStatuses().onDidChange((id, status) => {
      seen.push(`${id}:${status}`);
    });
    getExtensionStatuses().set('acme.bad', 'ACTIVATION_FAILED', 'boom');
    expect(seen).toEqual(['acme.bad:ACTIVATION_FAILED']);
    expect(getExtensionStatuses().reason('acme.bad')).toBe('boom');
    subscription.dispose();
    getExtensionStatuses().set('acme.bad', 'ACTIVE');
    expect(seen).toEqual(['acme.bad:ACTIVATION_FAILED']);
  });

  test('disabled extensions stay skipped until re-enabled', () => {
    const store = getExtensionStatuses();
    store.set('acme.tool', 'DISABLED');
    expect(store.isDisabled('acme.tool')).toBe(true);
    store.set('acme.tool', 'VALID');
    expect(store.isDisabled('acme.tool')).toBe(false);
  });
});
