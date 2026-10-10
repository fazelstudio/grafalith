// Dev hot-reload: change detection reloads through the host.
import { afterEach, describe, expect, test } from 'bun:test';
import { resetExtensionState } from './extensionContributions';
import { DesktopExtensionHost } from './extensionHost';
import { resetExtensionStatuses } from './extensionStatus';
import { resetOutputChannels } from './outputChannel';
import { connectDevReload, DevReloadWatcher, MemoryReloadSource } from './devReloadWatcher';

afterEach(() => {
  resetExtensionState();
  resetExtensionStatuses();
  resetOutputChannels();
});

function manifest() {
  return {
    formatVersion: 1,
    id: 'tool',
    publisher: 'acme',
    name: 'Tool',
    version: '1.0.0',
    engines: { grafalith: '^0.1.0' },
    activationEvents: ['onStartup'],
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('dev reload watcher', () => {
  test('revision change reloads; unreadable ticks skip', async () => {
    const source = new MemoryReloadSource();
    const reloaded: string[] = [];
    const watcher = new DevReloadWatcher(
      source,
      async (packageId) => {
        reloaded.push(packageId);
        return true;
      },
      () => undefined,
      { intervalMs: 5 },
    );
    source.touch('acme.tool', 'v1');
    watcher.watch('acme.tool');
    await delay(20);
    expect(reloaded).toEqual([]);
    source.touch('acme.tool', 'v2');
    await delay(30);
    expect(reloaded).toEqual(['acme.tool']);
    watcher.unwatch('acme.tool');
    source.touch('acme.tool', 'v3');
    await delay(30);
    expect(reloaded).toEqual(['acme.tool']);
    watcher.disposeAll();
  });

  test('failed reload toasts and stays armed for the next change', async () => {
    const source = new MemoryReloadSource();
    const toasts: string[] = [];
    let calls = 0;
    const watcher = new DevReloadWatcher(
      source,
      async () => {
        calls += 1;
        return calls > 1;
      },
      (message) => void toasts.push(message),
      { intervalMs: 5 },
    );
    source.touch('acme.tool', 'v1');
    watcher.watch('acme.tool');
    await delay(15);
    source.touch('acme.tool', 'v2');
    await delay(30);
    expect(calls).toBe(1);
    expect(toasts.length).toBe(1);
    expect(watcher.watched()).toEqual(['acme.tool']);
    source.touch('acme.tool', 'v3');
    await delay(30);
    expect(calls).toBe(2);
    expect(toasts.length).toBe(1);
    watcher.disposeAll();
  });

  test('host connection reloads the real extension on change', async () => {
    const host = new DesktopExtensionHost('0.1.0');
    let activations = 0;
    host.install(manifest(), {
      activate: () => void (activations += 1),
    });
    await host.activateByTrigger({ kind: 'startup' });
    expect(activations).toBe(1);
    const source = new MemoryReloadSource();
    source.touch('acme.tool', 'v1');
    const connection = connectDevReload(host, source, { intervalMs: 5 });
    connection.arm('acme.tool');
    await delay(15);
    source.touch('acme.tool', 'v2');
    await delay(40);
    expect(activations).toBe(2);
    expect(host.statusOf('acme.tool')).toBe('ACTIVE');
    connection.dispose();
    await host.disposeAll();
  });
});
