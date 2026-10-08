import { describe, expect, test } from 'bun:test';
import {
  appCommandRegistry,
  appCommandsForSurface,
  canExecuteAppCommand,
  executeAppCommand,
  searchAppCommands,
} from './appCommands';

describe('app command registry', () => {
  test('every id is namespaced and unique', () => {
    const ids = appCommandRegistry.all().map((command) => command.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toContain('.');
  });

  test('menu and palette surfaces stay populated', () => {
    expect(appCommandsForSurface('menu').length).toBeGreaterThan(0);
    expect(appCommandsForSurface('palette').length).toBeGreaterThan(0);
  });

  test('disabled commands never invoke callbacks', async () => {
    const result = await executeAppCommand('project.save', {
      saveProject: undefined,
    });
    expect(result.status).toBe('disabled');
  });

  test('save executes through the injected host callback', async () => {
    let calls = 0;
    const result = await executeAppCommand('project.save', {
      saveProject: () => {
        calls += 1;
      },
    });
    expect(result).toEqual({ status: 'ok' });
    expect(calls).toBe(1);
  });

  test('panel toggle degrades without a host', () => {
    expect(canExecuteAppCommand('panel.toggleLayers', {}).executable).toBe(false);
    expect(
      canExecuteAppCommand('panel.toggleLayers', { togglePanel: () => undefined }).executable,
    ).toBe(true);
  });

  test('unknown ids report notApplicable', async () => {
    expect(await executeAppCommand('missing.command', {})).toEqual({
      status: 'notApplicable',
      reason: 'unknown-command',
    });
  });

  test('search covers labels and namespaces', () => {
    expect(searchAppCommands('save').map((command) => command.id)).toContain('project.save');
    expect(searchAppCommands('panel').length).toBeGreaterThan(0);
  });

  test('project CRUD routes through injected store callbacks', async () => {
    const calls: string[] = [];
    const base = {
      openProject: (id: string) => void calls.push(`open:${id}`),
      refreshHome: () => void calls.push('refresh'),
      createProject: async (name: string, kind: string) => {
        calls.push(`create:${name}:${kind}`);
        return { id: 'new-id' };
      },
      renameProject: async (id: string, name: string) => void calls.push(`rename:${id}:${name}`),
      deleteProject: async (id: string) => void calls.push(`delete:${id}`),
      toggleFavorite: async (id: string) => void calls.push(`favorite:${id}`),
    };
    expect(await executeAppCommand('project.create', { ...base, targetName: 'N', targetKind: 'design' })).toEqual({ status: 'ok' });
    expect(await executeAppCommand('project.open', { ...base, targetProjectId: 'p1' })).toEqual({ status: 'ok' });
    expect(await executeAppCommand('project.rename', { ...base, targetProjectId: 'p1', targetName: 'R' })).toEqual({ status: 'ok' });
    expect(await executeAppCommand('project.delete', { ...base, targetProjectId: 'p1' })).toEqual({ status: 'ok' });
    expect(await executeAppCommand('project.toggleFavorite', { ...base, targetProjectId: 'p1' })).toEqual({ status: 'ok' });
    expect(calls).toEqual([
      'create:N:design',
      'open:new-id',
      'refresh',
      'open:p1',
      'rename:p1:R',
      'refresh',
      'delete:p1',
      'refresh',
      'favorite:p1',
      'refresh',
    ]);
  });

  test('project commands stay disabled without targets', async () => {
    expect(await executeAppCommand('project.open', { openProject: () => undefined })).toEqual({
      status: 'disabled',
      reason: 'unavailable',
    });
    expect(await executeAppCommand('project.create', { createProject: async () => undefined })).toEqual({
      status: 'disabled',
      reason: 'unavailable',
    });
  });

  test('settings section opens through navigation', async () => {
    const paths: string[] = [];
    const result = await executeAppCommand('settings.openSection', {
      navigate: (path: string) => void paths.push(path),
      targetName: 'editor',
    });
    expect(result).toEqual({ status: 'ok' });
    expect(paths).toEqual(['#/settings/editor']);
  });
});
