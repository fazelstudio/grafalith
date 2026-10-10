// Context-key service and `when`-clause evaluation.
import { describe, expect, test } from 'bun:test';
import { ContextKeyService, evaluateWhen } from './contextKeys';

describe('context keys', () => {
  test('defaults describe Home with no selection', () => {
    const keys = new ContextKeyService();
    expect(keys.get('grafalith.context.screen', 'editor')).toBe('home');
    expect(keys.get('grafalith.context.selectedCount', 9)).toBe(0);
  });

  test('syncEditorState writes editor keys at once', () => {
    const keys = new ContextKeyService();
    keys.syncEditorState({
      screen: 'editor',
      editorType: 'diagram',
      hasActiveProject: true,
      selectedCount: 2,
      activeTool: 'arrow',
      layerSelected: true,
    });
    expect(keys.snapshot()['grafalith.context.editorType']).toBe('diagram');
    expect(keys.get('grafalith.context.hasActiveProject', false)).toBe(true);
  });

  test('when clauses gate visibility', () => {
    const values = {
      'grafalith.context.screen': 'editor',
      'grafalith.context.selectedCount': 2,
      'grafalith.context.editorType': 'design',
    };
    expect(evaluateWhen(undefined, values)).toBe(true);
    expect(evaluateWhen('grafalith.context.screen == editor', values)).toBe(true);
    expect(evaluateWhen('grafalith.context.screen == home', values)).toBe(false);
    expect(evaluateWhen('grafalith.context.screen == editor && grafalith.context.selectedCount != 0', values)).toBe(
      true,
    );
    expect(evaluateWhen('!grafalith.context.layerSelected', values)).toBe(true);
    expect(evaluateWhen('grafalith.context.editorType == diagram || grafalith.context.editorType == design', values)).toBe(
      true,
    );
  });
});
