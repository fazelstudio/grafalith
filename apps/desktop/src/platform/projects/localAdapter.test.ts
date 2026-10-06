import { describe, expect, test } from 'bun:test';
import { createLocalProjectStore, type KeyValueStorage } from './localAdapter';
import { buildBlankScene } from '../../features/projects/templateRegistry';

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

describe('local project store', () => {
  test('create, list, and open round-trip without touching scene data', async () => {
    const store = createLocalProjectStore(memoryStorage());
    const created = await store.create('Plan', buildBlankScene());
    expect(created.name).toBe('Plan');
    const listed = await store.list();
    expect(listed.length).toBe(1);
    expect(listed[0].id).toBe(created.id);
    const opened = await store.open(created.id);
    expect(opened.sceneJson).toBe(buildBlankScene());
  });

  test('rename trims and duplicate keeps an independent payload', async () => {
    const store = createLocalProjectStore(memoryStorage());
    const created = await store.create('Original', buildBlankScene());
    const renamed = await store.rename(created.id, '  Renamed  ');
    expect(renamed.name).toBe('Renamed');
    const copy = await store.duplicate(created.id);
    expect(copy.id).not.toBe(created.id);
    expect(copy.name).toContain('Renamed');
    await store.remove(created.id);
    expect((await store.list()).length).toBe(1);
    expect((await store.listTrash()).map((entry) => entry.id)).toEqual([created.id]);
    await expect(store.open(created.id)).rejects.toMatchObject({ code: 'not-found' });
    await store.restore(created.id);
    expect((await store.list()).map((entry) => entry.id)).toContain(created.id);
    await store.remove(created.id);
    await store.deletePermanently(created.id);
    expect(await store.listTrash()).toEqual([]);
  });

  test('expired trash is permanently removed from the index and document storage', async () => {
    const storage = memoryStorage();
    const store = createLocalProjectStore(storage);
    const created = await store.create('Expired', buildBlankScene());
    await store.remove(created.id);

    const index = JSON.parse(storage.getItem('opennary:projects:index:v1') ?? '[]') as {
      id: string;
      deletedAtMs?: number;
    }[];
    index[0].deletedAtMs = Date.now() - 30 * 24 * 60 * 60 * 1000 - 1;
    storage.setItem('opennary:projects:index:v1', JSON.stringify(index));

    expect(await store.list()).toEqual([]);
    expect(storage.getItem(`opennary:projects:doc:${created.id}`)).toBeNull();
    expect(await store.listTrash()).toEqual([]);
  });

  test('blank names are rejected before any write', async () => {
    const store = createLocalProjectStore(memoryStorage());
    await expect(store.create('   ', buildBlankScene())).rejects.toMatchObject({
      code: 'invalid-name',
    });
    expect(await store.list()).toEqual([]);
  });

  test('project names are limited to 50 characters', async () => {
    const store = createLocalProjectStore(memoryStorage());
    const created = await store.create('a'.repeat(50), buildBlankScene());
    expect(created.name).toBe('a'.repeat(50));
    await expect(store.create('a'.repeat(51), buildBlankScene())).rejects.toMatchObject({
      code: 'invalid-name',
      details: '50',
    });
  });

  test('missing payloads report the missing code', async () => {
    const storage = memoryStorage();
    const store = createLocalProjectStore(storage);
    const created = await store.create('Ghost', buildBlankScene());
    storage.removeItem(`opennary:projects:doc:${created.id}`);
    await expect(store.open(created.id)).rejects.toMatchObject({
      code: 'missing-document',
    });
  });
});
