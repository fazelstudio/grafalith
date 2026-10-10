// Built-in lifecycle event bus.
import { describe, expect, test } from 'bun:test';
import { AppEventBus } from './appEvents';

describe('app events', () => {
  test('exact names deliver payloads', () => {
    const bus = new AppEventBus();
    const seen: unknown[] = [];
    const subscription = bus.on('grafalith.project.didOpen', (payload) => void seen.push(payload));
    bus.emit('grafalith.project.didOpen', { projectId: 'p1' });
    expect(seen).toEqual([{ projectId: 'p1' }]);
    expect(bus.count('grafalith.project.didOpen')).toBe(1);
    subscription.dispose();
    bus.emit('grafalith.project.didOpen', { projectId: 'p2' });
    expect(seen).toEqual([{ projectId: 'p1' }]);
  });

  test('settings family matches by prefix', () => {
    const bus = new AppEventBus();
    const seen: unknown[] = [];
    bus.on('grafalith.settings.didChange:', (payload) => void seen.push(payload));
    bus.emit('grafalith.settings.didChange:theme', { key: 'theme' });
    expect(seen).toEqual([{ key: 'theme' }]);
  });
});
