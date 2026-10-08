import { describe, expect, test } from 'bun:test';
import { createStartupQueue } from './startupQueue';

describe('startup queue', () => {
  test('critical work runs before extensions', async () => {
    const queue = createStartupQueue();
    const order: string[] = [];
    queue.enqueue({ id: 'extension.a', priority: 'normal', tag: 'extension', run: () => void order.push('extension.a') });
    queue.enqueue({ id: 'project.open', priority: 'high', tag: 'project', run: () => void order.push('project.open') });
    queue.enqueue({ id: 'theme.apply', priority: 'critical', tag: 'boot', run: () => void order.push('theme.apply') });
    const result = await queue.drain();
    expect(order).toEqual(['theme.apply', 'project.open', 'extension.a']);
    expect(result.failed).toEqual([]);
  });

  test('paused extension tag skips until resumed', async () => {
    const queue = createStartupQueue();
    const order: string[] = [];
    queue.enqueue({ id: 'project.open', priority: 'high', tag: 'project', run: () => void order.push('project.open') });
    queue.enqueue({ id: 'extension.a', priority: 'normal', tag: 'extension', run: () => void order.push('extension.a') });
    queue.pause('extension');
    await queue.drain();
    expect(order).toEqual(['project.open']);
    queue.resume('extension');
    await queue.drain();
    expect(order).toEqual(['project.open', 'extension.a']);
  });

  test('failures are collected without stopping the queue', async () => {
    const queue = createStartupQueue();
    queue.enqueue({
      id: 'broken',
      priority: 'low',
      tag: 'maintenance',
      run: () => {
        throw new Error('boom');
      },
    });
    queue.enqueue({ id: 'next', priority: 'low', tag: 'maintenance', run: () => undefined });
    const result = await queue.drain();
    expect(result.failed).toEqual([{ id: 'broken', message: 'boom' }]);
    expect(result.completed).toEqual(['next']);
  });

  test('duplicate task ids are rejected', () => {
    const queue = createStartupQueue();
    queue.enqueue({ id: 'a', priority: 'high', tag: 'project', run: () => undefined });
    expect(() => queue.enqueue({ id: 'a', priority: 'high', tag: 'project', run: () => undefined })).toThrow(
      /duplicate startup task/,
    );
  });
});
