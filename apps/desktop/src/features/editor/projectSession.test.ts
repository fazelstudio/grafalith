import { describe, expect, test } from 'bun:test';
import { stageFor } from './useProjectSession';

describe('project open pipeline stages', () => {
  test('resolve failures map to the reference stage', () => {
    expect(stageFor('not-found')).toBe('resolve');
    expect(stageFor('invalid-id')).toBe('resolve');
  });

  test('read failures map to the storage stage', () => {
    expect(stageFor('missing-document')).toBe('read');
    expect(stageFor('storage-unavailable')).toBe('read');
  });

  test('payload failures map to validation, version failures to migration', () => {
    expect(stageFor('invalid-data')).toBe('validate');
    expect(stageFor('unreadable')).toBe('validate');
    expect(stageFor('unsupported-version')).toBe('migrate');
  });

  test('unknown codes fall back to the read stage instead of crashing', () => {
    expect(stageFor('something-new')).toBe('read');
    expect(stageFor('')).toBe('read');
  });
});
