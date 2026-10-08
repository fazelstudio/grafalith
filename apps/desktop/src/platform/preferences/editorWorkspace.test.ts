import { describe, expect, test } from 'bun:test';
import {
  EDITOR_DOCK_WIDTHS,
  loadEditorWorkspace,
  normalizeEditorDockWidth,
  saveEditorWorkspace,
} from './editorWorkspace';

describe('editor workspace preferences', () => {
  test('falls back to the select tool with both panels open', () => {
    const workspace = loadEditorWorkspace();
    expect(workspace.activeTool).toBe('select');
    expect(workspace.openPanels).toEqual(['layers', 'inspector']);
    expect(workspace.leftPanelWidth).toBe(264);
    expect(workspace.rightPanelWidth).toBe(264);
    expect(workspace.hintDismissed).toBe(false);
    expect(workspace.homeViewMode).toBe('grid');
  });

  test('saving never throws without storage', () => {
    expect(() =>
      saveEditorWorkspace({
        activeTool: 'rectangle',
        openPanels: ['layers'],
        leftPanelWidth: 200,
        rightPanelWidth: 300,
        hintDismissed: true,
        viewports: { abc: { scrollX: 1, scrollY: 2, zoom: 3 } },
        restoreViewport: true,
        homeViewMode: 'list',
      }),
    ).not.toThrow();
  });

  test('clamps persisted dock widths to the user-level resize bounds', () => {
    expect(normalizeEditorDockWidth(20)).toBe(EDITOR_DOCK_WIDTHS.min);
    expect(normalizeEditorDockWidth(9999)).toBe(EDITOR_DOCK_WIDTHS.max);
    expect(normalizeEditorDockWidth('invalid')).toBe(EDITOR_DOCK_WIDTHS.default);
  });
});
