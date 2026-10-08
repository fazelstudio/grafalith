import { describe, expect, test } from 'bun:test';
import { ExtensionDialogQueue, extensionDialogQueue } from './extensionDialogs';

describe('extension dialog queue', () => {
  test('ask resolves with the answer', async () => {
    const queue = new ExtensionDialogQueue();
    const pending = queue.ask<string>({ kind: 'input', prompt: 'Name?' });
    expect(queue.peek()?.kind).toBe('input');
    queue.answer('acme');
    await expect(pending).resolves.toBe('acme');
    expect(queue.peek()).toBeNull();
  });

  test('cancel resolves undefined', async () => {
    const queue = new ExtensionDialogQueue();
    const pending = queue.ask<string>({ kind: 'input', prompt: 'Name?' });
    queue.cancel();
    await expect(pending).resolves.toBeUndefined();
  });

  test('a second ask cancels the first', async () => {
    const queue = new ExtensionDialogQueue();
    const first = queue.ask<string>({ kind: 'input', prompt: 'First' });
    const second = queue.ask<{ confirmed: boolean }>({ kind: 'confirm', title: 'T', body: 'B' });
    await expect(first).resolves.toBeUndefined();
    queue.answer({ confirmed: true });
    await expect(second).resolves.toEqual({ confirmed: true });
  });

  test('shared singleton starts empty', () => {
    expect(extensionDialogQueue.peek()).toBeNull();
  });
});
