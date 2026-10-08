import { afterEach, describe, expect, test } from 'bun:test';
import { createExtensionContext } from './extensionContext';
import { extensionStatusText, resetExtensionState } from './extensionContributions';
import { extensionDialogQueue } from './extensionDialogs';

afterEach(() => {
  resetExtensionState();
  extensionDialogQueue.cancel();
});

function context() {
  const notifications: { message: string; options?: { level?: string; action?: { label: string; commandId: string } } }[] = [];
  const ctx = createExtensionContext({
    packageId: 'acme.sticker',
    notify: (message, options) => void notifications.push({ message, options }),
    executeHostCommand: async (id) => ({ ok: true, value: `ran:${id}` }),
  });
  return { ctx, notifications };
}

describe('extension context', () => {
  test('commands register through the host store', async () => {
    const { ctx } = context();
    ctx.commands.registerCommand('acme.ping', () => 'pong');
    expect(ctx.commands.canExecute('acme.ping')).toBe(true);
    expect(await ctx.commands.executeCommand('acme.ping')).toBe('pong');
    expect(ctx.commands.getCommands()).toContain('acme.ping');
  });

  test('notifications carry level and primary action', () => {
    const { ctx, notifications } = context();
    ctx.window.showNotification('Installed', {
      level: 'success',
      actions: [{ label: 'Open', command: 'acme.open' }],
    });
    expect(notifications).toEqual([
      { message: 'Installed', options: { level: 'success', action: { label: 'Open', commandId: 'acme.open' } } },
    ]);
  });

  test('status items write through the shared store', () => {
    const { ctx } = context();
    const item = ctx.window.createStatusBarItem('acme.clock');
    item.text = '12:00';
    expect(extensionStatusText('acme.clock', 'Clock')).toBe('12:00');
    item.command = 'acme.open';
    item.hide();
    item.show();
    item.dispose();
    expect(extensionStatusText('acme.clock', 'Clock')).toBe('Clock');
  });

  test('config persists per extension with change events', () => {
    const { ctx } = context();
    expect(ctx.workspace.config.get('enabled', true)).toBe(true);
    let changed = '';
    const subscription = ctx.workspace.config.onDidChange((key) => void (changed = key));
    ctx.workspace.config.set('enabled', false);
    expect(ctx.workspace.config.get('enabled', true)).toBe(false);
    expect(changed).toBe('enabled');
    subscription.dispose();
  });

  test('memento and workspace events round-trip', async () => {
    const { ctx } = context();
    await ctx.workspace.memento.update('last', 7);
    expect(ctx.workspace.memento.get('last', 0)).toBe(7);
    const seen: string[][] = [];
    const subscription = ctx.workspace.events.onDidChangeSelection.on((ids) => void seen.push([...ids]));
    ctx.workspace.events.onDidChangeSelection.fire(['a']);
    expect(seen).toEqual([['a']]);
    subscription.dispose();
  });

  test('dialogs resolve through the shared queue', async () => {
    const { ctx } = context();
    const pending = ctx.window.showInputBox('Name?', 'acme');
    extensionDialogQueue.answer('sticker');
    await expect(pending).resolves.toBe('sticker');
  });
});
