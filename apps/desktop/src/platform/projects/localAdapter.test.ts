import { describe, expect, test } from 'bun:test';
import { createLocalProjectStore, type KeyValueStorage } from './localAdapter';
import { buildBlankScene } from '../../features/projects/templateRegistry';
import { persistenceConfig } from './persistenceConfig';

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

  test('preview reads the scene without changing the last-opened timestamp', async () => {
    const store = createLocalProjectStore(memoryStorage());
    const created = await store.create('Preview', buildBlankScene());
    const before = (await store.list())[0].lastOpenedAtMs;
    const preview = await store.preview(created.id);
    const after = (await store.list())[0].lastOpenedAtMs;
    expect(preview.sceneJson).toBe(buildBlankScene());
    expect(after).toBe(before);
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

    const index = JSON.parse(storage.getItem('grafalith:projects:index:v1') ?? '[]') as {
      id: string;
      deletedAtMs?: number;
    }[];
    index[0].deletedAtMs = Date.now() - persistenceConfig.trashRetentionMs - 1;
    storage.setItem('grafalith:projects:index:v1', JSON.stringify(index));

    expect(await store.list()).toEqual([]);
    expect(storage.getItem(`grafalith:projects:doc:${created.id}`)).toBeNull();
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
    storage.removeItem(`grafalith:projects:doc:${created.id}`);
    await expect(store.open(created.id)).rejects.toMatchObject({
      code: 'missing-document',
    });
  });

  test('project kinds default to design and survive duplication', async () => {
    const store = createLocalProjectStore(memoryStorage());
    const design = await store.create('Plan', buildBlankScene());
    expect(design.kind).toBe('design');
    const board = await store.create('Board', buildBlankScene(), 'whiteboard');
    expect(board.kind).toBe('whiteboard');
    const copy = await store.duplicate(board.id);
    expect(copy.kind).toBe('whiteboard');
    const kinds = (await store.list()).map((entry) => entry.kind).sort();
    expect(kinds).toEqual(['design', 'whiteboard', 'whiteboard']);
  });
});
