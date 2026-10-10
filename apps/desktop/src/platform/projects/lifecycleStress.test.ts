import { describe, expect, test } from 'bun:test';
import { buildBlankSceneEnvelope } from './documentEnvelope';
import { createLocalProjectStore, type KeyValueStorage } from './localAdapter';

function trackingStorage(): { storage: KeyValueStorage; keys: () => string[] } {
  const data = new Map<string, string>();
  return {
    storage: {
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => {
        data.set(key, value);
      },
      removeItem: (key) => {
        data.delete(key);
      },
    },
    keys: () => [...data.keys()].sort(),
  };
}

function editedScene(nonce: number): string {
  return JSON.stringify({
    schemaVersion: 1,
    version: 1,
    elements: [],
    elementOrder: [],
    nonce,
  });
}

describe('repeated project open/close', () => {
  test('25 create -> edit -> save -> reopen -> permanently delete cycles leave no residue', async () => {
    const { storage, keys } = trackingStorage();
    const store = createLocalProjectStore(storage);
    const baseline = keys();

    for (let i = 0; i < 25; i++) {
      const created = await store.create(`Cycle ${i}`, buildBlankSceneEnvelope());
      await store.save(created.id, editedScene(i));
      const opened = await store.open(created.id);
      expect(opened.sceneJson).toBe(editedScene(i));
      await store.remove(created.id);
      await store.deletePermanently(created.id);
    }

    expect(await store.list()).toEqual([]);
    // Only the project index key may remain; every document payload is gone.
    const residue = keys().filter((key) => key !== 'grafalith:projects:index:v1');
    expect(residue).toEqual(baseline.filter((key) => key !== 'grafalith:projects:index:v1'));
    expect(keys().filter((key) => key.startsWith('grafalith:projects:doc:'))).toEqual([]);
  });
});
