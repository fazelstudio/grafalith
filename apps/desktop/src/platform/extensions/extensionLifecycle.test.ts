// Phase-based activation: Home, project, editor kinds, priority, unload.
import { afterEach, describe, expect, test } from 'bun:test';
import { resetExtensionState } from './extensionContributions';
import { DesktopExtensionHost } from './extensionHost';

afterEach(async () => {
  resetExtensionState();
});

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    formatVersion: 1,
    id: 'sticker',
    publisher: 'acme',
    name: 'Sticker Pack',
    version: '1.0.0',
    engines: { grafalith: '^0.1.0' },
    ...overrides,
  };
}

describe('phase-based activation', () => {
  test('onHome and onEditor:diagram activate in their phases', async () => {
    const host = new DesktopExtensionHost('0.1.0');
    const started: string[] = [];
    host.install(manifest({ id: 'home-ext', activationEvents: ['onHome'] }), {
      activate: () => void started.push('home'),
    });
    host.install(manifest({ id: 'diagram-ext', activationEvents: ['onEditor:diagram'] }), {
      activate: () => void started.push('diagram'),
    });
    expect(await host.activateByTrigger({ kind: 'startup' })).toEqual([]);
    expect(await host.activateHome()).toEqual(['acme.home-ext']);
    expect(await host.activateEditor('design')).toEqual([]);
    expect(await host.activateEditor('diagram')).toEqual(['acme.diagram-ext']);
    expect(started).toEqual(['home', 'diagram']);
    await host.disposeAll();
  });

  test('high priority activates before normal extensions', async () => {
    const host = new DesktopExtensionHost('0.1.0');
    const started: string[] = [];
    host.install(manifest({ id: 'late', activationEvents: ['onStartup'] }), {
      activate: () => void started.push('late'),
    });
    host.install(manifest({ id: 'early', priority: 'high', activationEvents: ['onStartup'] }), {
      activate: () => void started.push('early'),
    });
    await host.activateByTrigger({ kind: 'startup' });
    expect(started).toEqual(['early', 'late']);
    await host.disposeAll();
  });

  test('editor-scoped extensions unload on return Home', async () => {
    const host = new DesktopExtensionHost('0.1.0');
    let deactivated = false;
    host.install(manifest({ id: 'scoped', activationEvents: ['onEditor:design'] }), {
      activate: () => undefined,
      deactivate: () => void (deactivated = true),
    });
    await host.activateEditor('design');
    expect(host.installed()).toEqual(['acme.scoped']);
    expect(await host.deactivateEditorScope()).toEqual(['acme.scoped']);
    expect(deactivated).toBe(true);
    // Home-scoped extensions are untouched by the editor unload.
    await host.disposeAll();
  });

  test('project and editor events fan out to active extensions', async () => {
    const host = new DesktopExtensionHost('0.1.0');
    const seen: string[] = [];
    host.install(manifest({ id: 'watcher', activationEvents: ['onStartup'] }), {
      activate: (ctx) => {
        ctx.workspace.events.onDidOpenProject.on(({ projectId }) => void seen.push(`open:${projectId}`));
        ctx.workspace.events.onDidCloseProject.on(({ projectId }) => void seen.push(`close:${projectId}`));
      },
    });
    await host.activateByTrigger({ kind: 'startup' });
    host.emitDocument('p1');
    host.emitProjectClosed('p1');
    expect(seen).toEqual(['open:p1', 'close:p1']);
    await host.disposeAll();
  });
});
