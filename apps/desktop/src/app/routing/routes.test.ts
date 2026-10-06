import { describe, expect, test } from 'bun:test';
import { editorPath, parseEditorProjectId, primaryNav, routeRegistry } from './routes';

describe('route registry', () => {
  test('ids and paths are unique with title metadata', () => {
    const ids = routeRegistry.all().map((route) => route.id);
    const paths = routeRegistry.all().map((route) => route.path);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(paths).size).toBe(paths.length);
    for (const route of routeRegistry.all()) {
      expect(route.titleKey.length).toBeGreaterThan(0);
      expect(route.navigationKey.length).toBeGreaterThan(0);
    }
  });

  test('unknown or empty hashes fall back to home', () => {
    expect(routeRegistry.fromPath('').id).toBe('home');
    expect(routeRegistry.fromPath('#/missing').id).toBe('home');
    expect(routeRegistry.fromPath('#/editor').id).toBe('editor');
    expect(routeRegistry.fromPath('#/settings/appearance').id).toBe('settings-appearance');
    expect(routeRegistry.fromPath('#/trash').id).toBe('trash');
  });

  test('project-scoped editor paths round-trip through the parser', () => {
    expect(parseEditorProjectId(editorPath('p-abc123'))).toBe('p-abc123');
    expect(parseEditorProjectId('#/editor')).toBeNull();
    expect(parseEditorProjectId('#/editor/')).toBeNull();
    expect(parseEditorProjectId('#/')).toBeNull();
    expect(routeRegistry.fromPath(editorPath('p-abc123')).id).toBe('editor');
  });

  test('primary navigation resolves to registered routes', () => {
    expect(primaryNav.length).toBeGreaterThan(0);
    for (const item of primaryNav) {
      expect(routeRegistry.get(item.id)?.path).toBe(item.path);
    }
  });

  test('settings sub-routes share the settings layout', () => {
    expect(routeRegistry.get('settings')?.layout).toBe('settings');
    expect(routeRegistry.get('settings-appearance')?.layout).toBe('settings');
    expect(routeRegistry.get('settings-general')?.layout).toBe('settings');
    expect(routeRegistry.get('settings-editor')?.layout).toBe('settings');
    expect(routeRegistry.get('settings-shortcuts')?.layout).toBe('settings');
    expect(routeRegistry.fromPath('#/settings/editor').id).toBe('settings-editor');
    expect(routeRegistry.fromPath('#/settings/shortcuts').id).toBe('settings-shortcuts');
  });
});
