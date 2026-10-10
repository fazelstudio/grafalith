// Extension Manager: list, filters, and per-id command dispatch.
import { afterEach, describe, expect, test } from 'bun:test';
import { resetExtensionState } from './extensionContributions';
import { getExtensionHost, resetExtensionHost } from './extensionHost';
import {
  disableExtension,
  enableExtension,
  executeManagerCommand,
  filterExtensions,
  listExtensions,
  onOpenExtensionManager,
  showExtensionOutput,
} from './extensionManager';
import { resetExtensionStatuses } from './extensionStatus';
import { getOutputChannels, resetOutputChannels } from './outputChannel';

afterEach(async () => {
  resetExtensionState();
  resetExtensionStatuses();
  resetOutputChannels();
  await resetExtensionHost();
});

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    formatVersion: 1,
    id: 'tool',
    publisher: 'acme',
    name: 'Tool',
    version: '1.0.0',
    engines: { grafalith: '^0.1.0' },
    activationEvents: ['onStartup'],
    ...overrides,
  };
}

describe('extension manager', () => {
  test('list reflects live statuses and filters slice rows', async () => {
    const host = getExtensionHost();
    host.install(manifest({ id: 'good' }), { activate: () => undefined });
    host.install(manifest({ id: 'bad', dependencies: { 'acme.ghost': '*' } }), {
      activate: () => undefined,
    });
    await host.activateByTrigger({ kind: 'startup' });
    const rows = listExtensions();
    expect(rows.map((row) => row.packageId).sort()).toEqual(['acme.bad', 'acme.good']);
    expect(filterExtensions(rows, 'all')).toHaveLength(2);
    expect(filterExtensions(rows, 'active').map((row) => row.packageId)).toEqual(['acme.good']);
    expect(filterExtensions(rows, 'failed').map((row) => row.packageId)).toEqual(['acme.bad']);
  });

  test('manager commands open, filter, enable, disable, and show output', async () => {
    const host = getExtensionHost();
    host.install(manifest({ id: 'tool' }), { activate: () => undefined });
    await host.activateByTrigger({ kind: 'startup' });
    const opened: string[] = [];
    const subscription = onOpenExtensionManager((filter) => void opened.push(filter));
    expect(await executeManagerCommand('grafalith.extensions.manager.showActive')).toEqual({ ok: true });
    expect(await executeManagerCommand('grafalith.extensions.manager.showFailed')).toEqual({ ok: true });
    expect(opened).toEqual(['active', 'failed']);
    subscription.dispose();

    expect(await executeManagerCommand('grafalith.extensions.disable:acme.tool')).toEqual({ ok: true });
    expect(host.statusOf('acme.tool')).toBe('DISABLED');
    expect(await disableExtension('acme.tool')).toBe(true);
    expect(await enableExtension('acme.tool')).toBe(true);
    expect(host.statusOf('acme.tool')).toBe('ACTIVE');

    expect(await executeManagerCommand('grafalith.extensions.showOutput:acme.tool')).toEqual({ ok: true });
    expect(getOutputChannels().visibleChannel()).toBe('acme.tool');
    showExtensionOutput('acme.tool');
    expect(await executeManagerCommand('grafalith.extensions.output.showSystem')).toEqual({ ok: true });
    // Legacy three-part aliases keep working.
    expect(await executeManagerCommand('grafalith.extensions.showActive')).toEqual({ ok: true });
    expect(await executeManagerCommand('grafalith.output.showSystem')).toEqual({ ok: true });
    expect(await executeManagerCommand('grafalith.extensions.bogus')).toEqual({
      ok: false,
      reason: 'unknown-command: grafalith.extensions.bogus',
    });
  });
});
