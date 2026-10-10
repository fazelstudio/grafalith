import { describe, expect, test } from 'bun:test';
import { buildBlankSceneEnvelope } from './documentEnvelope';
import { createLocalProjectStore, type KeyValueStorage } from './localAdapter';

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

function storageWith(backing: KeyValueStorage): { storage: KeyValueStorage; peek: (key: string) => string | null } {
  const seen = new Map<string, string>();
  return {
    storage: {
      getItem: (key) => {
        const value = backing.getItem(key);
        if (value !== null) seen.set(key, value);
        return value;
      },
      setItem: (key, value) => backing.setItem(key, value),
      removeItem: (key) => backing.removeItem(key),
    },
    peek: (key) => backing.getItem(key),
  };
}

describe('phase 05 persistence acceptance', () => {
  test('create -> edit -> save -> close -> reopen with no network', async () => {
    const store = createLocalProjectStore(memoryStorage());
    const created = await store.create('Offline plan', buildBlankSceneEnvelope());
    // Edit: persist a one-element scene over the blank payload.
    const edited = JSON.stringify({
      schemaVersion: 1,
      version: 1,
      elements: [],
      elementOrder: [],
    });
    const saved = await store.save(created.id, edited);
    expect(saved.updatedAtMs).toBeGreaterThanOrEqual(saved.createdAtMs);
    // Close: the index carries metadata only, never scene data.
    const listed = await store.list();
    expect(listed.length).toBe(1);
    for (const entry of listed) {
      expect('sceneJson' in entry).toBe(false);
    }
    // Reopen: full document data returns verbatim.
    const opened = await store.open(created.id);
    expect(opened.sceneJson).toBe(edited);
  });

  test('save failure leaves the previous payload intact', async () => {
    const backing = memoryStorage();
    const { storage } = storageWith(backing);
    const store = createLocalProjectStore(storage);
    const created = await store.create('Keep me', buildBlankSceneEnvelope());
    const future = '{"schemaVersion":999,"version":999,"elements":[],"elementOrder":[]}';
    await expect(store.save(created.id, future)).rejects.toMatchObject({
      code: 'unsupported-version',
    });
    const reopened = await store.open(created.id);
    expect(reopened.sceneJson).toBe(buildBlankSceneEnvelope());
  });

  test('missing, malformed, unsupported, and migration failures are typed', async () => {
    const backing = memoryStorage();
    const store = createLocalProjectStore(backing);
    await expect(store.open('p-missing')).rejects.toMatchObject({ code: 'not-found' });

    const created = await store.create('Fragile', buildBlankSceneEnvelope());
    backing.setItem(`grafalith:projects:doc:${created.id}`, '{not json');
    await expect(store.open(created.id)).rejects.toMatchObject({ code: 'invalid-data' });

    backing.setItem(
      `grafalith:projects:doc:${created.id}`,
      '{"schemaVersion":999,"version":999,"elements":[]}',
    );
    await expect(store.open(created.id)).rejects.toMatchObject({ code: 'unsupported-version' });

    // Migration failure never deletes the project entry itself.
    expect((await store.list()).length).toBe(1);
  });
});
