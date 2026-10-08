import { afterEach, describe, expect, test } from 'bun:test';
import {
  executeExtensionCommand,
  hasExtensionCommand,
  installedExtensions,
  extensionCommandIds,
  extensionMenuRowsFor,
  extensionViewsFor,
  registerExtensionCommand,
  registerExtensionMenuRows,
  registerExtensionViews,
  resetExtensionState,
  satisfiesEngines,
  setExtensionActive,
  trackInstalledExtension,
  validateExtensionForHost,
} from './extensionContributions';
import { DesktopExtensionHost } from './extensionHost';
import { buildStoredZip } from './onryArchive';

afterEach(() => {
  resetExtensionState();
});

function manifest() {
  return {
    formatVersion: 1,
    id: 'sticker',
    publisher: 'acme',
    name: 'Sticker Pack',
    version: '1.0.0',
    engines: { opennary: '^0.1.0' },
    activationEvents: ['onStartup'],
    contributes: {
      commands: [{ command: 'acme.sticker.create', title: 'Create sticker' }],
      menus: { 'canvas.context': [{ command: 'acme.sticker.create' }] },
    },
  };
}

describe('extension contributions', () => {
  test('engines ranges gate installation', () => {
    expect(satisfiesEngines('*', '0.1.0')).toBe(true);
    expect(satisfiesEngines('^0.1.0', '0.1.9')).toBe(true);
    expect(satisfiesEngines('^0.1.0', '0.2.0')).toBe(false);
  });

  test('host validation catches unknown surfaces', () => {
    const problems = validateExtensionForHost(
      {
        ...manifest(),
        contributes: {
          commands: [{ command: 'acme.sticker.create', title: 'Create', icon: 'nope' }],
          menus: { 'nowhere.menu': [{ command: 'acme.sticker.create' }] },
        },
      },
      '0.1.0',
    );
    expect(problems.length).toBe(2);
  });

  test('command handlers execute and report', async () => {
    registerExtensionCommand('acme.ping', () => 'pong');
    expect(hasExtensionCommand('acme.ping')).toBe(true);
    expect(extensionCommandIds()).toEqual(['acme.ping']);
    expect(await executeExtensionCommand('acme.ping')).toEqual({ ok: true, value: 'pong' });
    expect(await executeExtensionCommand('missing')).toEqual({ ok: false, reason: 'unknown-command' });
    expect(() => registerExtensionCommand('acme.ping', () => undefined)).toThrow(/already registered/);
  });

  test('menu rows and views register per location', () => {
    registerExtensionMenuRows([{ location: 'canvas.context', commandId: 'undo', group: 9, order: 0 }]);
    expect(extensionMenuRowsFor('canvas.context').map((row) => row.commandId)).toEqual(['undo']);
    expect(() =>
      registerExtensionMenuRows([{ location: 'nowhere.menu' as never, commandId: 'undo', group: 0, order: 0 }]),
    ).toThrow(/unknown menu location/);
    registerExtensionViews([{ surface: 'status', id: 'acme.clock', title: 'Clock' }]);
    expect(extensionViewsFor('status').map((view) => view.id)).toEqual(['acme.clock']);
  });

  test('installed extensions track active state', () => {
    trackInstalledExtension('acme.sticker', manifest());
    setExtensionActive('acme.sticker', true);
    expect(installedExtensions()).toEqual([
      { packageId: 'acme.sticker', manifest: manifest(), active: true },
    ]);
  });
});

describe('desktop extension host', () => {
  test('install validates before staging', () => {
    const host = new DesktopExtensionHost('0.1.0');
    expect(host.install({ formatVersion: 99 }, {}).errors.length).toBeGreaterThan(0);
    expect(host.install(manifest(), {}).errors).toEqual([]);
    expect(host.install(manifest(), {}).errors).toEqual(['extension already installed: acme.sticker']);
    expect(host.installed()).toEqual(['acme.sticker']);
  });

  test('startup activation runs once and enqueues on the extension tag', async () => {
    const host = new DesktopExtensionHost('0.1.0');
    let calls = 0;
    host.install(manifest(), {
      activate: (ctx) => {
        calls += 1;
        ctx.commands.registerCommand('acme.sticker.create', () => 'created');
      },
    });
    host.enqueueStartupActivation();
    const drained = await host.drainStartupQueue();
    expect(drained.completed).toEqual(['extensions.activate']);
    expect(calls).toBe(1);
    expect(await host.executeCommand('acme.sticker.create')).toEqual({ ok: true, value: 'created' });
    await host.disposeAll();
    expect(host.installed()).toEqual([]);
  });

  test('lazy onCommand activation fires on first execute', async () => {
    const host = new DesktopExtensionHost('0.1.0');
    host.install(
      { ...manifest(), activationEvents: ['onCommand:acme.lazy.run'] },
      {
      activate: (ctx) => {
        ctx.commands.registerCommand('acme.lazy.run', () => 'lazy');
      },
      },
    );
    expect(await host.executeCommand('acme.lazy.run')).toEqual({ ok: true, value: 'lazy' });
    await host.disposeAll();
  });

  test('project entry pauses extension activation', async () => {
    const host = new DesktopExtensionHost('0.1.0');
    let activated = false;
    host.install(manifest(), {
      activate: () => void (activated = true),
    });
    host.enqueueStartupActivation();
    host.pauseExtensions();
    await host.drainStartupQueue();
    expect(activated).toBe(false);
    host.resumeExtensions();
    await host.drainStartupQueue();
    expect(activated).toBe(true);
    await host.disposeAll();
  });

  test('installFromBytes extracts, validates, and stages the entry', async () => {
    const host = new DesktopExtensionHost('0.1.0');
    const bytes = buildStoredZip({
      'opennary.extension.json': JSON.stringify(manifest()),
      'index.js': 'activate',
    });
    const result = await host.installFromBytes(bytes, async (files, main) => {
      expect(main).toBe('index.js');
      expect(files.has('index.js')).toBe(true);
      return {
        activate: (ctx) => {
          ctx.commands.registerCommand('acme.sticker.create', () => 'created');
        },
      };
    });
    expect(result.errors).toEqual([]);
    expect(result.packageId).toBe('acme.sticker');
    host.enqueueStartupActivation();
    await host.drainStartupQueue();
    expect(await host.executeCommand('acme.sticker.create')).toEqual({ ok: true, value: 'created' });
    await host.disposeAll();
  });

  test('installFromBytes rejects corrupt archives', async () => {
    const host = new DesktopExtensionHost('0.1.0');
    const result = await host.installFromBytes(new Uint8Array([9, 9, 9]), async () => ({}));
    expect(result.errors.length).toBeGreaterThan(0);
    await host.disposeAll();
  });
});
