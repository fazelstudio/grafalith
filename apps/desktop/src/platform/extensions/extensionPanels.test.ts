// Panel store: manager/output dialog state driven by manager commands.
import { describe, expect, test } from 'bun:test';
import { ExtensionPanelStore } from './extensionPanels';

describe('extension panel store', () => {
  test('manager opens with a filter and closes', () => {
    const store = new ExtensionPanelStore();
    expect(store.peek()).toBe(null);
    store.openManager('failed');
    expect(store.peek()).toEqual({ kind: 'manager', filter: 'failed' });
    store.close();
    expect(store.peek()).toBe(null);
  });

  test('output tracks its return path and returns to the manager', () => {
    const store = new ExtensionPanelStore();
    store.openOutput(true);
    expect(store.peek()).toEqual({ kind: 'output', fromManager: true });
    store.backToManager();
    expect(store.peek()).toEqual({ kind: 'manager', filter: 'all' });
  });

  test('subscribers fire on every transition', () => {
    const store = new ExtensionPanelStore();
    let calls = 0;
    const unsubscribe = store.subscribe(() => void (calls += 1));
    store.openManager();
    store.openOutput();
    store.close();
    store.close();
    expect(calls).toBe(3);
    unsubscribe();
    store.openManager();
    expect(calls).toBe(3);
  });
});
