// Canonical `grafalith.*` command ids.
import { describe, expect, test } from 'bun:test';
import { canonicalCommandIds, hasCommand, isCanonicalCommandId, resolveCanonicalCommand } from './canonicalIds';

describe('canonical commands', () => {
  test('ids follow the grafalith convention', () => {
    for (const id of canonicalCommandIds()) {
      expect(isCanonicalCommandId(id)).toBe(true);
    }
    expect(isCanonicalCommandId('undo')).toBe(false);
  });

  test('canonical ids resolve to legacy registry entries', () => {
    expect(resolveCanonicalCommand('grafalith.core.commandPalette.open')).toMatchObject({
      kind: 'engine',
      legacy: 'commandPalette',
    });
    expect(resolveCanonicalCommand('grafalith.home.project.open')).toMatchObject({ kind: 'app', legacy: 'project.open' });
    expect(resolveCanonicalCommand('grafalith.missing')).toBeUndefined();
  });

  test('legacy and canonical ids both exist', () => {
    expect(hasCommand('undo')).toBe(true);
    expect(hasCommand('grafalith.core.commandPalette.open')).toBe(true);
    expect(hasCommand('grafalith.missing.command')).toBe(false);
  });
});
