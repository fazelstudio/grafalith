// Core bootstrap: Phase 1 services initialize or the app stops.
import { describe, expect, test } from 'bun:test';
import { bootstrapCore, bootstrapCoreSync, coreReady } from './coreBootstrap';

describe('core bootstrap', () => {
  test('sync variant collects per-service results', () => {
    const checks = bootstrapCoreSync([
      { name: 'good', init: () => undefined },
      {
        name: 'bad',
        init: () => {
          throw new Error('boom');
        },
      },
    ]);
    expect(checks).toEqual([
      { name: 'good', ok: true },
      { name: 'bad', ok: false, error: 'boom' },
    ]);
    expect(coreReady(checks)).toBe(false);
    expect(coreReady(checks.filter((service) => service.ok))).toBe(true);
  });

  test('async bootstrap initializes every Phase 1 service', async () => {
    const checks = await bootstrapCore();
    expect(checks.length).toBeGreaterThan(0);
    expect(checks.every((service) => service.ok)).toBe(true);
    expect(coreReady(checks)).toBe(true);
  });
});
