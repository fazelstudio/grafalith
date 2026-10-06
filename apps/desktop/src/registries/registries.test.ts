import { describe, expect, test } from 'bun:test';
import type { Engine } from '../hooks/useEngine';
import { createRegistry, type Descriptor } from './core';
import { toolGroups, toolRegistry, toolsForGroup } from './tools';
import { panelRegistry, panelsFor } from './panels';
import {
  commandRegistry,
  commandsForSurface,
  searchCommands,
  executeCommand,
  canExecuteCommand,
  type CommandContext,
} from './commands';
import {
  findCommandForEvent,
  findToolForEvent,
  formatShortcut,
  commandShortcutLabel,
  commandShortcuts,
  isDialogTarget,
  shouldDispatchInScope,
} from './shortcuts';
import { normalizeSelection, dedupeIds } from '../features/editor/selection';
import { inspectorSectionsFor } from '../features/editor/inspector/descriptors';

/** Intent ids the engine's `contextMenu` op may return (host contract). */
const ENGINE_CONTEXT_INTENTS = [
  'delete',
  'duplicate',
  'bringToFront',
  'sendToBack',
  'bringForward',
  'sendBackward',
  'group',
  'ungroup',
  'lock',
  'unlock',
] as const;

const descriptor = (id: string, labelKey = `probe.${id}`, defaultLabel = id): Descriptor => ({
  id,
  labelKey,
  defaultLabel,
});

function okBatch(op: string, data: unknown = {}): string {
  return JSON.stringify({ version: 1, applied: 1, results: [{ op, ok: true, data }] });
}

function makeContext(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    engine: { getStatus: async () => ({ selection: [] }) } as unknown as Engine,
    sendBatch: async () => okBatch('noop'),
    selection: [],
    canUndo: false,
    canRedo: false,
    activeTool: 'select',
    viewport: { scrollX: 0, scrollY: 0, zoom: 1 },
    textEditingId: null,
    documentIds: [],
    ...overrides,
  };
}

describe('createRegistry validation', () => {
  test('rejects duplicate ids', () => {
    expect(() => createRegistry('probe', [descriptor('a'), descriptor('a')])).toThrow(
      /duplicate id "a"/,
    );
  });

  test('rejects an empty id', () => {
    expect(() => createRegistry('probe', [descriptor('')])).toThrow(/empty id/);
  });

  test('rejects a malformed localization key', () => {
    expect(() => createRegistry('probe', [descriptor('a', 'Not A Key')])).toThrow(
      /invalid labelKey/,
    );
  });

  test('rejects an empty display label', () => {
    expect(() => createRegistry('probe', [descriptor('a', 'probe.a', '')])).toThrow(
      /empty defaultLabel/,
    );
  });

  test('surfaces per-item validation problems', () => {
    const options = { validateItem: (item: Descriptor) => (item.id === 'bad' ? 'item rejected' : undefined) };
    expect(() => createRegistry('probe', [descriptor('bad')], options)).toThrow(/item rejected/);
  });

  test('surfaces cross-item validation problems', () => {
    const options = { validateAll: () => ['collision between "a" and "b"'] };
    expect(() => createRegistry('probe', [descriptor('a'), descriptor('b')], options)).toThrow(
      /collision/,
    );
  });

  test('keeps registration order and answers lookups', () => {
    const registry = createRegistry('probe', [descriptor('b'), descriptor('a')]);
    expect(registry.all().map((item) => item.id)).toEqual(['b', 'a']);
    expect(registry.get('a')?.id).toBe('a');
    expect(registry.get('missing')).toBeUndefined();
  });
});

describe('tool registry', () => {
  test('preserves the toolbar tool order and engine ids', () => {
    expect(toolRegistry.all().map((tool) => tool.id)).toEqual([
      'select',
      'rectangle',
      'ellipse',
      'frame',
      'line',
      'arrow',
      'text',
      'freedraw',
    ]);
    for (const tool of toolRegistry.all()) {
      expect(tool.engineTool).toBe(tool.id);
    }
  });

  test('every tool carries a localization key and persistent mode', () => {
    for (const tool of toolRegistry.all()) {
      expect(tool.labelKey.startsWith('editor.tools.')).toBe(true);
      expect(tool.mode).toBe('persistent');
    }
  });

  test('tool groups follow semantic workflow order in the registry', () => {
    expect(toolGroups()).toEqual(['selection', 'shapes', 'connectors', 'text', 'draw']);
  });

  test('tools derive from group data without hardcoded branches', () => {
    expect(toolsForGroup('shapes').map((tool) => tool.id)).toEqual(['rectangle', 'ellipse', 'frame']);
    expect(toolsForGroup('connectors').map((tool) => tool.id)).toEqual(['line', 'arrow']);
    expect(toolsForGroup('selection').map((tool) => tool.id)).toEqual(['select']);
  });

  test('every tool has a unique display shortcut', () => {
    const hints = toolRegistry.all().map((tool) => tool.shortcutHint);
    expect(new Set(hints).size).toBe(hints.length);
  });

  test('tool descriptions stay paired with their keys', () => {
    for (const tool of toolRegistry.all()) {
      expect(tool.descriptionKey).toBeDefined();
      expect(tool.defaultDescription).not.toBe('');
    }
  });
});

describe('panel registry', () => {
  test('registers one dock per side in display order', () => {
    expect(panelRegistry.all().map((panel) => panel.id)).toEqual(['layers', 'inspector']);
    expect(panelsFor('left').map((panel) => panel.id)).toEqual(['layers']);
    expect(panelsFor('right').map((panel) => panel.id)).toEqual(['inspector']);
  });

  test('every panel carries localization keys and a valid dock', () => {
    for (const panel of panelRegistry.all()) {
      expect(panel.labelKey.startsWith('editor.panels.')).toBe(true);
      expect(panel.toggleKey.startsWith('editor.panels.')).toBe(true);
      expect(panel.location === 'left' || panel.location === 'right').toBe(true);
    }
  });

  test('dock slots are unique across the registry', () => {
    const slots = panelRegistry.all().map((panel) => `${panel.location}:${panel.order}`);
    expect(new Set(slots).size).toBe(slots.length);
  });
});

describe('command registry', () => {
  test('toolbar commands keep their order and reuse one source', () => {
    const ids = commandsForSurface('toolbar').map((command) => command.id);
    expect(ids).toEqual(['undo', 'redo', 'delete', 'duplicate']);
  });

  test('every engine context-menu intent resolves to a command', () => {
    for (const intent of ENGINE_CONTEXT_INTENTS) {
      const command = commandRegistry.get(intent);
      expect(command, `missing command for engine intent "${intent}"`).toBeDefined();
      expect(command?.surfaces).toContain('contextMenu');
    }
  });

  test('unknown intents fall back to the raw label', () => {
    expect(commandRegistry.get('engineOnlyIntent')).toBeUndefined();
  });

  test('commands carry scope, category, and structured shortcuts', () => {
    for (const command of commandRegistry.all()) {
      expect(command.scope.length).toBeGreaterThan(0);
      expect(command.category.length).toBeGreaterThan(0);
      expect(command.labelKey.startsWith('editor.commands.')).toBe(true);
    }
    expect(commandRegistry.get('undo')?.shortcuts).toEqual([{ key: 'z', ctrlOrCmd: true }]);
    expect(commandRegistry.get('delete')?.shortcuts).toContainEqual({ key: 'Delete' });
  });

  test('toolbar tooltips derive from structured shortcuts', () => {
    const title = (id: string): string => {
      const command = commandRegistry.get(id);
      const base = command?.defaultDescription ?? command?.defaultLabel ?? '';
      const shortcut = command ? commandShortcutLabel(command, false) : undefined;
      return shortcut ? `${base} (${shortcut})` : base;
    };
    expect(title('undo')).toBe('Undo the last change (Ctrl+Z)');
    expect(title('delete')).toBe('Delete selection (Del)');
    expect(title('duplicate')).toBe('Duplicate selection (Ctrl+D)');
  });

  test('undo gating follows the engine history state', () => {
    expect(canExecuteCommand('undo', makeContext({ canUndo: false })).executable).toBe(false);
    expect(canExecuteCommand('undo', makeContext({ canUndo: true })).executable).toBe(true);
    const undo = commandRegistry.get('undo');
    expect(undo?.isEnabled?.(makeContext({ canUndo: false }))).toBe(false);
    expect(undo?.isEnabled?.(makeContext({ canUndo: true }))).toBe(true);
  });

  test('selection gating needs cardinality, not hardcoded branches', () => {
    expect(canExecuteCommand('delete', makeContext({ selection: [] })).executable).toBe(false);
    expect(canExecuteCommand('group', makeContext({ selection: ['a'] })).executable).toBe(false);
    expect(canExecuteCommand('group', makeContext({ selection: ['a', 'b'] })).executable).toBe(true);
    expect(canExecuteCommand('distributeHorizontal', makeContext({ selection: ['a', 'b'] })).executable).toBe(false);
    expect(
      canExecuteCommand('distributeHorizontal', makeContext({ selection: ['a', 'b', 'c'] })).executable,
    ).toBe(true);
  });

  test('executeCommand is the single source: disabled never touches the engine', async () => {
    let calls = 0;
    const ctx = makeContext({
      selection: [],
      sendBatch: async () => {
        calls += 1;
        return okBatch('deleteSelected');
      },
    });
    const result = await executeCommand('delete', ctx);
    expect(result.status).toBe('disabled');
    expect(calls).toBe(0);
  });

  test('undo executes the undo op through the supplied sender', async () => {
    const batches: unknown[][] = [];
    const ctx = makeContext({
      canUndo: true,
      sendBatch: async (ops) => {
        batches.push(ops);
        return okBatch('undo');
      },
    });
    const result = await executeCommand('undo', ctx);
    expect(result.status).toBe('ok');
    expect(batches).toEqual([[{ op: 'undo' }]]);
  });

  test('duplicate re-reads the selection at execution time', async () => {
    const batches: unknown[][] = [];
    const ctx = makeContext({
      engine: { getStatus: async () => ({ selection: ['fresh'] }) } as unknown as Engine,
      selection: ['stale'],
      sendBatch: async (ops) => {
        batches.push(ops);
        return okBatch('duplicate', { count: 1, ids: ['fresh2'] });
      },
    });
    const result = await executeCommand('duplicate', ctx);
    expect(result.status).toBe('ok');
    expect(batches).toEqual([[{ op: 'duplicate', ids: ['fresh'] }]]);
  });

  test('z-order commands send the context selection ids', async () => {
    const batches: unknown[][] = [];
    const ctx = makeContext({
      selection: ['a', 'b'],
      sendBatch: async (ops) => {
        batches.push(ops);
        return okBatch('bringToFront', { affected: ['a', 'b'] });
      },
    });
    await executeCommand('bringToFront', ctx);
    const ctx2 = makeContext({
      selection: ['a', 'b'],
      sendBatch: async (ops) => {
        batches.push(ops);
        return okBatch('group', { affected: ['a', 'b'] });
      },
    });
    await executeCommand('group', ctx2);
    expect(batches).toEqual([
      [{ op: 'bringToFront', ids: ['a', 'b'] }],
      [{ op: 'group', ids: ['a', 'b'] }],
    ]);
  });

  test('engine failures surface as engineError instead of throwing', async () => {
    const ctx = makeContext({
      canUndo: true,
      sendBatch: async () =>
        JSON.stringify({ version: 1, applied: 0, results: [{ op: 'undo', ok: false, code: 'engineError', message: 'boom' }] }),
    });
    const result = await executeCommand('undo', ctx);
    expect(result).toEqual({ status: 'engineError', code: 'engineError', message: 'boom' });
  });

  test('palette search covers labels and keywords', () => {
    expect(searchCommands('').length).toBeGreaterThan(10);
    expect(searchCommands('undo').map((command) => command.id)).toContain('undo');
    expect(searchCommands('clipboard').map((command) => command.id)).toContain('copy');
    expect(searchCommands('zzz-no-match').length).toBe(0);
  });
});

describe('shortcut registry', () => {
  test('letters match case-insensitively with ctrlOrCmd abstraction', () => {
    const command = findCommandForEvent({ key: 'Z', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false });
    expect(command?.id).toBe('undo');
    const redo = findCommandForEvent({ key: 'z', ctrlKey: true, metaKey: false, shiftKey: true, altKey: false });
    expect(redo?.id).toBe('redo');
  });

  test('tools resolve single letters without modifiers only', () => {
    expect(findToolForEvent({ key: 'v', ctrlKey: false, metaKey: false, altKey: false })).toBe('select');
    expect(findToolForEvent({ key: 'V', ctrlKey: false, metaKey: false, altKey: false })).toBe('select');
    expect(findToolForEvent({ key: 'v', ctrlKey: true, metaKey: false, altKey: false })).toBeUndefined();
  });

  test('platform labels render Ctrl vs Cmd', () => {
    expect(formatShortcut({ key: 'z', ctrlOrCmd: true }, false)).toBe('Ctrl+Z');
    expect(formatShortcut({ key: 'z', ctrlOrCmd: true }, true)).toBe('⌘Z');
    expect(formatShortcut({ key: 'Delete' }, false)).toBe('Del');
  });

  test('focus-aware guard keeps editor commands out of inputs', () => {
    const input = { tagName: 'INPUT' } as unknown as EventTarget;
    expect(shouldDispatchInScope('selection', input, false)).toBe(false);
    expect(shouldDispatchInScope('application', input, false)).toBe(true);
    expect(shouldDispatchInScope('editor', null, true)).toBe(false);
    expect(shouldDispatchInScope('editor', null, false)).toBe(true);
  });
});

describe('selection normalization', () => {
  test('drops stale ids and duplicates while preserving order', () => {
    expect(normalizeSelection(['b', 'ghost', 'a', 'b', ''], new Set(['a', 'b']))).toEqual(['b', 'a']);
  });

  test('dedupe preserves first-appearance order', () => {
    expect(dedupeIds(['a', 'b', 'a', '', 'c'])).toEqual(['a', 'b', 'c']);
  });
});

describe('inspector descriptors', () => {
  test('sections derive from selection cardinality, not hardcoded branches', () => {
    const single = inspectorSectionsFor(1, new Set(['rectangle'])).map((section) => section.id);
    expect(single).toContain('transform');
    expect(single).toContain('style');
    expect(single).not.toContain('arrange');
    const multi = inspectorSectionsFor(3, new Set(['rectangle', 'ellipse'])).map((section) => section.id);
    expect(multi).toContain('arrange');
    expect(multi).not.toContain('transform');
    const text = inspectorSectionsFor(1, new Set(['text'])).map((section) => section.id);
    expect(text).toContain('text');
  });
});

describe('shortcut collision audit', () => {
  test('no two commands claim the same chord', () => {
    const seen = new Map<string, string>();
    const problems: string[] = [];
    for (const { command, chord } of commandShortcuts()) {
      const key = `${chord.ctrlOrCmd ? 'ctrl+' : ''}${chord.shift ? 'shift+' : ''}${chord.alt ? 'alt+' : ''}${chord.key.toLowerCase()}`;
      const owner = seen.get(key);
      if (owner) problems.push(`"${key}" claimed by "${owner}" and "${command.id}"`);
      else seen.set(key, command.id);
    }
    expect(problems).toEqual([]);
  });

  test('single-letter tool keys never collide with modifier-free command chords', () => {
    const toolKeys = new Set(
      toolRegistry.all().map((tool) => tool.shortcutHint?.toLowerCase()),
    );
    for (const { command, chord } of commandShortcuts()) {
      const bare = !chord.ctrlOrCmd && !chord.alt && chord.key.length === 1;
      if (bare) {
        expect(toolKeys.has(chord.key.toLowerCase()), `command "${command.id}" steals a tool key`).toBe(
          false,
        );
      }
    }
  });

  test('dialog targets own their keystrokes except for application commands', () => {
    const dialog = { closest: (selector: string) => (selector === '[role="dialog"]' ? {} : null) };
    expect(isDialogTarget(dialog as unknown as EventTarget)).toBe(true);
    expect(isDialogTarget(null)).toBe(false);
    expect(isDialogTarget({} as unknown as EventTarget)).toBe(false);
    expect(shouldDispatchInScope('selection', dialog as unknown as EventTarget, false)).toBe(false);
    expect(shouldDispatchInScope('editor', dialog as unknown as EventTarget, false)).toBe(false);
    expect(shouldDispatchInScope('application', dialog as unknown as EventTarget, false)).toBe(true);
    // Outside dialogs nothing changes: editor commands still dispatch.
    expect(shouldDispatchInScope('selection', null, false)).toBe(true);
  });
});

describe('command predicate matrix', () => {
  test('document-scoped commands need a populated document', () => {
    expect(canExecuteCommand('selectAll', makeContext({ documentIds: [] })).executable).toBe(false);
    expect(canExecuteCommand('selectAll', makeContext({ documentIds: ['a'] })).executable).toBe(true);
  });

  test('view commands need a mounted viewport host', () => {
    expect(canExecuteCommand('zoomIn', makeContext({})).executable).toBe(false);
    const view = {
      zoomStep: async () => undefined,
      resetZoom: async () => undefined,
      fitContent: async () => undefined,
      fitSelection: async () => undefined,
    };
    expect(canExecuteCommand('zoomIn', makeContext({ view })).executable).toBe(true);
    expect(
      canExecuteCommand('fitSelection', makeContext({ view, selection: [] })).executable,
    ).toBe(false);
    expect(
      canExecuteCommand('fitSelection', makeContext({ view, selection: ['a'] })).executable,
    ).toBe(true);
  });

  test('paste and escape stay enabled; redo follows the engine flag', () => {
    expect(canExecuteCommand('paste', makeContext({})).executable).toBe(true);
    expect(canExecuteCommand('escape', makeContext({ textEditingId: 't-1' })).executable).toBe(true);
    expect(canExecuteCommand('redo', makeContext({ canRedo: false })).executable).toBe(false);
    expect(canExecuteCommand('redo', makeContext({ canRedo: true })).executable).toBe(true);
  });

  test('select -> shortcut -> undo/redo journey resolves through one path', async () => {
    expect(
      findCommandForEvent({ key: 'z', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false })?.id,
    ).toBe('undo');
    expect(
      findCommandForEvent({ key: 'y', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false })?.id,
    ).toBe('redo');
    expect(
      findCommandForEvent({ key: 'Delete', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false })?.id,
    ).toBe('delete');

    const batches: unknown[][] = [];
    const undoCtx = makeContext({
      canUndo: true,
      selection: ['a'],
      sendBatch: async (ops) => {
        batches.push(ops);
        return okBatch('undo');
      },
    });
    expect(await executeCommand('undo', undoCtx)).toEqual({ status: 'ok' });
    const redoDisabled = await executeCommand('redo', makeContext({ canRedo: false }));
    expect(redoDisabled).toEqual({ status: 'disabled', reason: 'unavailable' });
    expect(batches).toEqual([[{ op: 'undo' }]]);
  });
});
