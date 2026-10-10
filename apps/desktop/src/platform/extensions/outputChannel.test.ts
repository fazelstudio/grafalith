// Output channels: per-extension logs, system channel, visibility.
import { describe, expect, test } from 'bun:test';
import { OutputChannelService, SYSTEM_OUTPUT_CHANNEL } from './outputChannel';

describe('output channels', () => {
  test('channels buffer lines and fan out appends', () => {
    const service = new OutputChannelService();
    const channel = service.channel('acme.tool');
    const seen: string[] = [];
    const subscription = channel.onDidAppend((line) => void seen.push(line));
    channel.appendLine('hello');
    channel.appendLine('world');
    expect(channel.lines()).toEqual(['hello', 'world']);
    expect(seen).toEqual(['hello', 'world']);
    subscription.dispose();
    channel.appendLine('again');
    expect(seen).toEqual(['hello', 'world']);
    service.disposeAll();
  });

  test('system channel is addressable by constant', () => {
    const service = new OutputChannelService();
    service.system().appendLine('[discovery] scan');
    expect(service.channel(SYSTEM_OUTPUT_CHANNEL).lines()).toEqual(['[discovery] scan']);
    expect(service.names()).toContain(SYSTEM_OUTPUT_CHANNEL);
    service.disposeAll();
  });

  test('show/hide switches the visible channel', () => {
    const service = new OutputChannelService();
    const seen: (string | null)[] = [];
    service.onDidChangeVisible((name) => void seen.push(name));
    service.channel('acme.a').show();
    service.channel('acme.b').show();
    expect(service.visibleChannel()).toBe('acme.b');
    service.channel('acme.b').hide();
    expect(service.visibleChannel()).toBe(null);
    expect(seen).toEqual(['acme.a', 'acme.b', null]);
    service.disposeAll();
  });

  test('clear and remove drop logs without throwing', () => {
    const service = new OutputChannelService();
    const channel = service.channel('acme.tool');
    channel.appendLine('x');
    channel.clear();
    expect(channel.lines()).toEqual([]);
    service.remove('acme.tool');
    expect(service.names()).not.toContain('acme.tool');
    service.disposeAll();
  });
});
