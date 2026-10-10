// Dependency resolver: order, missing, blocked, cycles, version gates.
import { describe, expect, test } from 'bun:test';
import { resolveDependencies } from './dependencyResolver';

describe('dependency resolver', () => {
  test('orders dependents after dependencies', () => {
    const resolution = resolveDependencies([
      { packageId: 'acme.app', dependencies: { 'acme.lib': '*' } },
      { packageId: 'acme.lib' },
    ]);
    expect(resolution.ordered).toEqual(['acme.lib', 'acme.app']);
    expect(resolution.missing).toEqual([]);
    expect(resolution.cycles).toEqual([]);
  });

  test('missing dependencies skip the dependent only', () => {
    const resolution = resolveDependencies([{ packageId: 'acme.app', dependencies: { 'acme.ghost': '*' } }]);
    expect(resolution.ordered).toEqual([]);
    expect(resolution.missing).toEqual([{ packageId: 'acme.app', dependency: 'acme.ghost' }]);
  });

  test('failed dependencies block their dependents', () => {
    const resolution = resolveDependencies(
      [
        { packageId: 'acme.app', dependencies: { 'acme.lib': '*' } },
        { packageId: 'acme.lib' },
      ],
      new Map([['acme.lib', '1.0.0']]),
      new Set(['acme.lib']),
    );
    expect(resolution.blocked).toEqual([{ packageId: 'acme.app', dependency: 'acme.lib' }]);
    expect(resolution.ordered).not.toContain('acme.app');
  });

  test('circular chains are reported and excluded from order', () => {
    const resolution = resolveDependencies([
      { packageId: 'a', dependencies: { b: '*' } },
      { packageId: 'b', dependencies: { a: '*' } },
    ]);
    expect(resolution.cycles.length).toBe(1);
    expect(resolution.cycles[0][0]).toBe('a');
    expect(resolution.ordered).toEqual([]);
  });

  test('version ranges gate dependents', () => {
    const resolution = resolveDependencies(
      [{ packageId: 'acme.app', dependencies: { 'acme.lib': '^0.1.0' } }, { packageId: 'acme.lib' }],
      new Map([['acme.lib', '0.2.0']]),
    );
    expect(resolution.versionMismatch).toEqual([
      { packageId: 'acme.app', dependency: 'acme.lib', range: '^0.1.0', installed: '0.2.0' },
    ]);
    expect(resolution.ordered).toEqual(['acme.lib']);
  });
});
