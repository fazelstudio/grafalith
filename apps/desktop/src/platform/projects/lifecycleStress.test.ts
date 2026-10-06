import { describe, expect, test } from 'bun:test';
import { buildBlankSceneEnvelope } from './documentEnvelope';
import { createLocalProjectStore, type KeyValueStorage } from './localAdapter';
import {
  clearRecoverySnapshot,
  hasRecoverySnapshot,
  saveRecoverySnapshot,
} from './recovery';

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

function installMemoryWindow(data: Map<string, string>): () => void {
  const globals = globalThis as Record<string, unknown>;
  const previous = globals['window'];
  globals['window'] = {
    localStorage: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        data.set(key, value);
      },
      removeItem: (key: string) => {
        data.delete(key);
      },
    },
  };
  return () => {
    if (previous === undefined) delete globals['window'];
    else globals['window'] = previous;
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
    const residue = keys().filter((key) => key !== 'opennary:projects:index:v1');
    expect(residue).toEqual(baseline.filter((key) => key !== 'opennary:projects:index:v1'));
    expect(keys().filter((key) => key.startsWith('opennary:projects:doc:'))).toEqual([]);
  });

  test('recovery snapshots stage and clear without leaking keys', () => {
    const data = new Map<string, string>();
    const restore = installMemoryWindow(data);
    try {
      expect(hasRecoverySnapshot('p-1')).toBe(false);
      for (let i = 0; i < 10; i++) {
        saveRecoverySnapshot({
          projectId: `p-${i}`,
          sceneJson: buildBlankSceneEnvelope(),
          savedAtMs: Date.now(),
          schemaVersion: 1,
          reason: 'dirty',
        });
      }
      expect(data.size).toBe(10);
      for (let i = 0; i < 10; i++) {
        clearRecoverySnapshot(`p-${i}`);
      }
      expect(data.size).toBe(0);
      expect(hasRecoverySnapshot('p-1')).toBe(false);
    } finally {
      restore();
    }
  });
});
