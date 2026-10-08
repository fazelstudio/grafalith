import { describe, expect, test } from 'bun:test';
import type { Engine } from '../hooks/useEngine';
import {
  executeCommand,
  canExecuteCommand,
  type CommandContext,
} from './commands';
import {
  searchUnifiedPalette,
  groupUnifiedRows,
  menuRowExecutable,
  executeMenuRow,
  type UnifiedPaletteRow,
} from './unified';
import type { AppCommandContext } from './appCommands';

function okBatch(op: string, data: unknown = {}): string {
  return JSON.stringify({ version: 1, applied: 1, results: [{ op, ok: true, data }] });
}

function engineCtx(overrides: Partial<CommandContext> = {}): CommandContext {
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

describe('targeted selection commands', () => {
  test('selectIds needs explicit targets', async () => {
    expect(canExecuteCommand('selectIds', engineCtx()).executable).toBe(false);
    const batches: unknown[][] = [];
    const ctx = engineCtx({
      targetIds: ['a'],
      sendBatch: async (ops) => {
        batches.push(ops);
        return okBatch('select');
      },
    });
    expect(canExecuteCommand('selectIds', ctx).executable).toBe(true);
    expect(await executeCommand('selectIds', ctx)).toEqual({ status: 'ok' });
    expect(batches).toEqual([[{ op: 'select', ids: ['a'] }]]);
  });

  test('deselect clears through the select op', async () => {
    const batches: unknown[][] = [];
    const ctx = engineCtx({
      selection: ['a'],
      sendBatch: async (ops) => {
        batches.push(ops);
        return okBatch('select');
      },
    });
    expect(await executeCommand('deselect', ctx)).toEqual({ status: 'ok' });
    expect(batches).toEqual([[{ op: 'select', ids: [] }]]);
  });

  test('inspector writes route per op with enablement', async () => {
    const batches: unknown[][] = [];
    const base = engineCtx({
      selection: ['a'],
      sendBatch: async (ops) => {
        batches.push(ops);
        return okBatch('setBounds');
      },
    });
    expect(canExecuteCommand('inspector.setBounds', base).executable).toBe(false);
    const withOp = { ...base, inspectorOp: { op: 'setBounds', ops: [{ op: 'setBounds' }] } };
    expect(canExecuteCommand('inspector.setBounds', withOp).executable).toBe(true);
    expect(await executeCommand('inspector.setBounds', withOp)).toEqual({ status: 'ok' });
    expect(batches).toEqual([[{ op: 'setBounds' }]]);
  });
});

describe('unified palette', () => {
  const appCtx: AppCommandContext = { navigate: () => undefined };

  test('search merges engine and host commands', () => {
    const rows = searchUnifiedPalette('', engineCtx(), appCtx);
    expect(rows.some((row) => row.kind === 'engine' && row.id === 'undo')).toBe(true);
    expect(rows.some((row) => row.kind === 'app' && row.id === 'project.save')).toBe(true);
  });

  test('groups follow category order of appearance', () => {
    const rows: UnifiedPaletteRow[] = [
      { kind: 'engine', id: 'undo', label: 'Undo', description: '', category: 'history', executable: true },
      { kind: 'app', id: 'project.save', label: 'Save', description: '', category: 'project', executable: true },
    ];
    expect(groupUnifiedRows(rows).map((group) => group.category)).toEqual(['history', 'project']);
  });

  test('menu rows execute through their own registry', async () => {
    let engineCalls = 0;
    const ctx = engineCtx({
      canUndo: true,
      sendBatch: async () => {
        engineCalls += 1;
        return okBatch('undo');
      },
    });
    await executeMenuRow(
      {
        id: 'edit.undo',
        labelKey: 'editor.commands.undo',
        defaultLabel: 'Undo',
        location: 'menubar.edit',
        commandId: 'undo',
        commandKind: 'engine',
        group: 0,
        order: 0,
      },
      ctx,
      appCtx,
    );
    expect(engineCalls).toBe(1);
    expect(menuRowExecutable(
      {
        id: 'edit.delete',
        labelKey: 'editor.commands.delete',
        defaultLabel: 'Delete',
        location: 'canvas.context',
        commandId: 'delete',
        commandKind: 'engine',
        group: 0,
        order: 0,
      },
      engineCtx(),
      appCtx,
    )).toBe(false);
  });
});
