import { describe, expect, test } from 'bun:test';
import { INTERACTION_TAB_ID, resolveDockTab } from './DockTabs';

describe('dock tabs', () => {
  test('keeps the active tab while it exists', () => {
    const tabs = [
      { id: 'inspector', label: 'Inspector' },
      { id: INTERACTION_TAB_ID, label: 'Interaction' },
    ];
    expect(resolveDockTab(tabs, 'interaction')).toBe('interaction');
    expect(resolveDockTab(tabs, null)).toBe('inspector');
  });

  test('falls back to the first tab when the list shrinks', () => {
    const tabs = [{ id: 'inspector', label: 'Inspector' }];
    expect(resolveDockTab(tabs, 'interaction')).toBe('inspector');
    expect(resolveDockTab([], 'inspector')).toBe('');
  });
});
