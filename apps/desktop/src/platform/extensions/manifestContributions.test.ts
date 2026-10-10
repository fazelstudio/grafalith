// Manifest contributions: declarative `contributes` → runtime stores.
import { afterEach, describe, expect, test } from 'bun:test';
import {
  extensionEditorToolsFor,
  extensionMenuRowsFor,
  extensionViewsFor,
  resetExtensionState,
} from './extensionContributions';
import { homeWidgets, projectTemplates, resetHomeContributions } from './homeContributions';
import {
  manifestCatalogFor,
  registerManifestContributions,
  resetManifestCatalog,
  unregisterManifestContributions,
} from './manifestContributions';

afterEach(() => {
  resetExtensionState();
  resetHomeContributions();
  resetManifestCatalog();
});

function manifest() {
  return {
    formatVersion: 1,
    id: 'pack',
    publisher: 'acme',
    name: 'Pack',
    version: '1.0.0',
    engines: { grafalith: '^0.1.0' },
    contributes: {
      commands: [{ command: 'acme.pack.run', title: 'Run' }],
      menus: { 'canvas.context': [{ command: 'acme.pack.run', group: '9_pack' }] },
      activityBarItems: [{ id: 'acme.rail', title: 'Rail' }],
      statusBarItems: [{ id: 'acme.clock', title: 'Clock' }],
      editorTools: { design: [{ id: 'acme.pen', title: 'Pen', command: 'acme.pack.run' }] },
      homeWidgets: [{ id: 'acme.recent', title: 'Recent' }],
      projectTemplates: [{ id: 'acme.poster', title: 'Poster', kind: 'design' as const }],
    },
  };
}

describe('manifest contributions', () => {
  test('declarative surfaces land in runtime stores', () => {
    expect(registerManifestContributions('acme.pack', manifest())).toEqual([]);
    expect(extensionMenuRowsFor('canvas.context').map((row) => row.commandId)).toContain('acme.pack.run');
    expect(extensionViewsFor('activity').map((view) => view.id)).toEqual(['acme.rail']);
    expect(extensionViewsFor('status').map((view) => view.id)).toEqual(['acme.clock']);
    expect(extensionEditorToolsFor('design').map((tool) => tool.id)).toEqual(['acme.pen']);
    expect(homeWidgets().map((widget) => widget.id)).toEqual(['acme.recent']);
    expect(projectTemplates('design').map((template) => template.id)).toEqual(['acme.poster']);
    expect(manifestCatalogFor('acme.pack')?.commands?.map((command) => command.command)).toEqual([
      'acme.pack.run',
    ]);
  });

  test('one colliding entry skips alone; the package stays usable', () => {
    registerManifestContributions('acme.first', manifest());
    const problems = registerManifestContributions('acme.second', {
      ...manifest(),
      id: 'other',
      contributes: {
        ...manifest().contributes,
        activityBarItems: [{ id: 'acme.rail', title: 'Rail clone' }],
        statusBarItems: [{ id: 'acme.fresh', title: 'Fresh' }],
      },
    });
    expect(problems.length).toBe(4);
    expect(problems.some((problem) => problem.includes('acme.rail'))).toBe(true);
    expect(extensionViewsFor('status').map((view) => view.id)).toContain('acme.fresh');
    expect(extensionMenuRowsFor('canvas.context').map((row) => row.commandId)).toContain('acme.pack.run');
  });

  test('unregister removes exactly the owning package', () => {
    registerManifestContributions('acme.pack', manifest());
    registerManifestContributions('acme.other', {
      ...manifest(),
      id: 'other',
      contributes: {
        menus: { 'canvas.context': [{ command: 'acme.other.run' }] },
        statusBarItems: [{ id: 'acme.other.clock', title: 'Other' }],
      },
    });
    unregisterManifestContributions('acme.pack');
    expect(extensionMenuRowsFor('canvas.context').map((row) => row.commandId)).toEqual([
      'acme.other.run',
    ]);
    expect(extensionViewsFor('status').map((view) => view.id)).toEqual(['acme.other.clock']);
    expect(extensionEditorToolsFor('design')).toEqual([]);
    expect(homeWidgets()).toEqual([]);
    expect(manifestCatalogFor('acme.pack')).toBeUndefined();
  });

  test('packages without contributes register nothing', () => {
    const { id: _id, contributes: _contributes, ...rest } = manifest();
    void _id;
    void _contributes;
    expect(registerManifestContributions('acme.bare', rest as never)).toEqual([]);
    expect(extensionMenuRowsFor('canvas.context')).toEqual([]);
  });
});
