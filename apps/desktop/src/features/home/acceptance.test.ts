import { describe, expect, test } from 'bun:test';
import { createLocalProjectStore, type KeyValueStorage } from '../../platform/projects/localAdapter';
import { setProjectStoreForTesting } from '../../platform/projects/projectService';
import { filterProjects } from '../projects/search';
import { projectTemplateRegistry } from '../projects/templateRegistry';
import { deriveHomeListState } from './homeState';

function memoryStorage(): KeyValueStorage {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

describe('phase 02 acceptance flow', () => {
  test('launch -> home -> create -> search -> open -> rename -> duplicate -> delete', async () => {
    const store = createLocalProjectStore(memoryStorage());
    setProjectStoreForTesting(store);
    try {
      // Launch with no projects: the list state is empty without scene data.
      const initial = await store.list();
      expect(deriveHomeListState(initial, '', initial).kind).toBe('empty');

      // Home -> Create Project from the default template registry entry.
      const template = projectTemplateRegistry.get('blank')!;
      const created = await store.create('Site plan', template.buildScene());
      const listed = await store.list();
      expect(deriveHomeListState(listed, '', listed).kind).toBe('populated');
      for (const entry of listed) {
        expect('sceneJson' in entry).toBe(false);
      }

      // Home -> Search -> Open Project.
      const matches = filterProjects(listed, 'site');
      expect(matches.length).toBe(1);
      expect(filterProjects(listed, 'nope')).toEqual([]);
      const opened = await store.open(matches[0].id);
      expect(JSON.parse(opened.sceneJson)).toEqual(
        expect.objectContaining({ elements: [], elementOrder: [] }),
      );

      // Rename keeps the identity stable.
      const renamed = await store.rename(created.id, 'Site plan v2');
      expect(renamed.id).toBe(created.id);

      // Duplicate and Trash flows preserve project content for restoration.
      const copy = await store.duplicate(created.id);
      expect(copy.id).not.toBe(created.id);
      await store.remove(created.id);
      expect((await store.list()).map((entry) => entry.id)).not.toContain(created.id);
      expect((await store.listTrash()).map((entry) => entry.id)).toContain(created.id);
      await store.restore(created.id);
      expect((await store.list()).map((entry) => entry.id)).toContain(created.id);
      await store.remove(created.id);
      await store.deletePermanently(created.id);
      expect((await store.list()).length).toBe(1);
      await store.remove(copy.id);
      expect(await store.list()).toEqual([]);
      await store.deletePermanently(copy.id);
      expect(deriveHomeListState(await store.list(), '', []).kind).toBe('empty');

      // Favorite and unfavorite flows.
      const favCreated = await store.create('Fav project', template.buildScene());
      const favListed = await store.list();
      expect(favListed[0].favoriteAtMs).toBeUndefined();
      const favored = await store.favorite(favCreated.id);
      expect(favored.favoriteAtMs).toBeDefined();
      const afterFav = await store.list();
      expect(afterFav[0].id).toBe(favCreated.id);
      const unfavored = await store.unfavorite(favCreated.id);
      expect(unfavored.favoriteAtMs).toBeUndefined();
      expect((await store.list()).map((entry) => entry.id)).toContain(favCreated.id);
    } finally {
      setProjectStoreForTesting(null);
    }
  });
});
