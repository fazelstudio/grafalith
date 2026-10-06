import { describe, expect, test, beforeEach } from 'bun:test';
import { buildBlankSceneEnvelope } from './documentEnvelope';
import {
  clearRecoverySnapshot,
  hasRecoverySnapshot,
  loadRecoverySnapshot,
  saveRecoverySnapshot,
} from './recovery';

interface MemoryStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

function installMemoryWindow(): Map<string, string> {
  const data = new Map<string, string>();
  const localStorage: MemoryStorage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
  (globalThis as unknown as { window: unknown }).window = { localStorage };
  return data;
}

describe('recovery snapshots', () => {
  beforeEach(() => {
    installMemoryWindow();
  });

  test('staged work round-trips per project', () => {
    saveRecoverySnapshot({
      projectId: 'p-1',
      sceneJson: buildBlankSceneEnvelope(),
      savedAtMs: 1,
      schemaVersion: 1,
      reason: 'dirty',
    });
    const loaded = loadRecoverySnapshot('p-1');
    expect(loaded?.projectId).toBe('p-1');
    expect(hasRecoverySnapshot('p-1')).toBe(true);
    expect(hasRecoverySnapshot('p-2')).toBe(false);
  });

  test('corrupt or foreign snapshots are ignored, never restored', () => {
    saveRecoverySnapshot({
      projectId: 'p-1',
      sceneJson: buildBlankSceneEnvelope(),
      savedAtMs: 1,
      schemaVersion: 1,
      reason: 'save-failed',
    });
    expect(loadRecoverySnapshot('p-2')).toBeNull();
    const w = (globalThis as unknown as { window: { localStorage: MemoryStorage } }).window;
    w.localStorage.setItem('opennary:projects:recovery:p-1', '{broken');
    expect(loadRecoverySnapshot('p-1')).toBeNull();
    w.localStorage.setItem(
      'opennary:projects:recovery:p-1',
      JSON.stringify({ projectId: 'p-1', sceneJson: '{broken', savedAtMs: 1, schemaVersion: 1 }),
    );
    expect(loadRecoverySnapshot('p-1')).toBeNull();
  });

  test('discard clears the pending offer', () => {
    saveRecoverySnapshot({
      projectId: 'p-1',
      sceneJson: buildBlankSceneEnvelope(),
      savedAtMs: 1,
      schemaVersion: 1,
      reason: 'dirty',
    });
    clearRecoverySnapshot('p-1');
    expect(loadRecoverySnapshot('p-1')).toBeNull();
  });
});
