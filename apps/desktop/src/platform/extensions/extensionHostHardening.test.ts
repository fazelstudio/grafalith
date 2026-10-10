// Host hardening: one bad extension never breaks the phase or the app.
import { afterEach, describe, expect, test } from 'bun:test';
import { resetExtensionState } from './extensionContributions';
import { DesktopExtensionHost, resetExtensionHost } from './extensionHost';
import { resetExtensionStatuses } from './extensionStatus';
import { resetOutputChannels } from './outputChannel';

afterEach(async () => {
  resetExtensionState();
  resetExtensionStatuses();
  resetOutputChannels();
  await resetExtensionHost();
});

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    formatVersion: 1,
    id: 'sticker',
    publisher: 'acme',
    name: 'Sticker Pack',
    version: '1.0.0',
    engines: { grafalith: '^0.1.0' },
    activationEvents: ['onStartup'],
    ...overrides,
  };
}

describe('host failure isolation', () => {
  test('a throwing activate() fails alone; siblings still activate', async () => {
    const host = new DesktopExtensionHost('0.1.0');
    const toasts: string[] = [];
    host.setNotifier((message) => void toasts.push(message));
    const started: string[] = [];
    host.install(manifest({ id: 'bad' }), {
      activate: () => {
        throw new Error('boom');
      },
    });
    host.install(manifest({ id: 'good' }), {
      activate: () => void started.push('good'),
    });
    const active = await host.activateByTrigger({ kind: 'startup' });
    expect(active).toEqual(['acme.good']);
    expect(started).toEqual(['good']);
    expect(host.statusOf('acme.bad')).toBe('ACTIVATION_FAILED');
    expect(host.statusOf('acme.good')).toBe('ACTIVE');
    expect(toasts.some((toast) => toast.includes('acme.bad'))).toBe(true);
    await host.disposeAll();
  });

  test('missing and circular dependencies skip with statuses', async () => {
    const host = new DesktopExtensionHost('0.1.0');
    const toasts: string[] = [];
    host.setNotifier((message) => void toasts.push(message));
    host.install(manifest({ id: 'needy', dependencies: { 'acme.ghost': '*' } }), { activate: () => undefined });
    host.install(manifest({ id: 'cycle-a', dependencies: { 'acme.cycle-b': '*' } }), {
      activate: () => undefined,
    });
    host.install(manifest({ id: 'cycle-b', dependencies: { 'acme.cycle-a': '*' } }), {
      activate: () => undefined,
    });
    await host.activateByTrigger({ kind: 'startup' });
    expect(host.statusOf('acme.needy')).toBe('MISSING_DEPENDENCY');
    expect(host.statusOf('acme.cycle-a')).toBe('CIRCULAR_DEPENDENCY');
    expect(host.statusOf('acme.cycle-b')).toBe('CIRCULAR_DEPENDENCY');
    expect(toasts.length).toBeGreaterThan(0);
    await host.disposeAll();
  });

  test('incompatible engines refuse with a warning toast', async () => {
    const host = new DesktopExtensionHost('0.1.0');
    const levels: string[] = [];
    host.setNotifier((_message, options) => void levels.push(options?.level ?? 'info'));
    const result = host.install(manifest({ id: 'future', engines: { grafalith: '^9.9.9' } }), {
      activate: () => undefined,
    });
    expect(result.errors.length).toBeGreaterThan(0);
    expect(host.statusOf('acme.future')).toBe('INCOMPATIBLE_VERSION');
    expect(levels).toContain('warning');
    await host.disposeAll();
  });

  test('deactivate() errors never block the rest of teardown', async () => {
    const host = new DesktopExtensionHost('0.1.0');
    let secondStopped = false;
    host.install(manifest({ id: 'first', activationEvents: ['onEditor:design'] }), {
      activate: () => undefined,
      deactivate: () => {
        throw new Error('teardown boom');
      },
    });
    host.install(manifest({ id: 'second', activationEvents: ['onEditor:design'] }), {
      activate: () => undefined,
      deactivate: () => void (secondStopped = true),
    });
    await host.activateEditor('design');
    const stopped = await host.deactivateEditorScope();
    expect(stopped).toContain('acme.first');
    expect(stopped).toContain('acme.second');
    expect(secondStopped).toBe(true);
    await host.disposeAll();
  });

  test('disable/enable/reload work without restarting', async () => {
    const host = new DesktopExtensionHost('0.1.0');
    let calls = 0;
    host.install(manifest({ id: 'tool' }), {
      activate: () => void (calls += 1),
    });
    await host.activateByTrigger({ kind: 'startup' });
    expect(host.statusOf('acme.tool')).toBe('ACTIVE');
    expect(await host.disable('acme.tool')).toBe(true);
    expect(host.statusOf('acme.tool')).toBe('DISABLED');
    expect(await host.enable('acme.tool')).toBe(true);
    expect(host.statusOf('acme.tool')).toBe('ACTIVE');
    expect(calls).toBe(2);
    expect(await host.reload('acme.tool')).toBe(true);
    expect(calls).toBe(3);
    expect(await host.uninstall('acme.tool')).toBe(true);
    expect(host.installed()).toEqual([]);
    await host.disposeAll();
  });
});
