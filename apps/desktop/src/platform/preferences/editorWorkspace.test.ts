import { describe, expect, test } from 'bun:test';
import { loadEditorWorkspace, saveEditorWorkspace } from './editorWorkspace';

describe('editor workspace preferences', () => {
  test('falls back to the select tool with both panels open', () => {
    const workspace = loadEditorWorkspace();
    expect(workspace.activeTool).toBe('select');
    expect(workspace.openPanels).toEqual(['layers', 'inspector']);
    expect(workspace.hintDismissed).toBe(false);
  });

  test('saving never throws without storage', () => {
    expect(() =>
      saveEditorWorkspace({
        activeTool: 'rectangle',
        openPanels: ['layers'],
        hintDismissed: true,
        viewports: { abc: { scrollX: 1, scrollY: 2, zoom: 3 } },
      }),
    ).not.toThrow();
  });
});
