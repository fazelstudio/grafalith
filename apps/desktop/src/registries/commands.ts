import type { Engine } from '../hooks/useEngine';
import { parseBatchResult } from '../hooks/useEngine';
import { createRegistry, type Descriptor } from './core';

/** UI surface a command may render on. Palette/shortcut eligibility is separate. */
export type CommandSurface = 'toolbar' | 'menu' | 'contextMenu' | 'palette';

/** Conceptual scope a command operates in. */
export type CommandScope =
  | 'application'
  | 'project'
  | 'editor'
  | 'selection'
  | 'canvas'
  | 'text';

/** Palette grouping for search and display. */
export type CommandCategory =
  | 'history'
  | 'clipboard'
  | 'edit'
  | 'arrange'
  | 'align'
  | 'view'
  | 'document';

/** Structured shortcut chord; matching uses ctrlOrCmd abstraction (no OS branching). */
export interface ShortcutChord {
  /** DOM `KeyboardEvent.key` value (`'z'`, `'Delete'`, `'ArrowLeft'`, `'Escape'`, …). */
  key: string;
  ctrlOrCmd?: boolean;
  shift?: boolean;
  alt?: boolean;
}

/** Viewport actions the host wires for view commands (canvas-owned math stays in viewport.ts). */
export interface ViewActions {
  zoomStep: (factor: number) => Promise<void>;
  resetZoom: () => Promise<void>;
  fitContent: () => Promise<void>;
  fitSelection: () => Promise<void>;
  /** Watcher kick for host-driven mutations: one fresh frame follows. */
  refreshFrame: () => void;
}

/** Document file actions the host wires for document commands. */
export interface FileActions {
  exportScene: () => Promise<void>;
  importScene: () => Promise<void>;
  exportPng: () => Promise<void>;
  exportSvg: () => Promise<void>;
  exportPdf: () => Promise<void>;
}

/** UI actions the host wires for application commands. */
export interface UiActions {
  openPalette: () => void;
}

/** Typed context assembled by the editor shell (small and derived). */
export interface CommandContext {
  /** Engine instance for reads that go beyond a single batched op. */
  engine: Engine;
  /** Batch sender: the toolbar passes its direct sender, the canvas its serialized chain. */
  sendBatch: (ops: unknown[]) => Promise<string>;
  /** Engine-reported selection (already normalized centrally). */
  selection: readonly string[];
  /** Whether the engine currently accepts an undo. */
  canUndo: boolean;
  /** Whether the engine currently accepts a redo. */
  canRedo: boolean;
  /** Active tool id (selection state, not document state). */
  activeTool: string;
  /** Current viewport mirror (viewport state, not document state). */
  viewport: { scrollX: number; scrollY: number; zoom: number };
  /** Engine text-session element id, or null when not editing text. */
  textEditingId: string | null;
  /** All live document ids (for select-all; derived from the render model). */
  documentIds: readonly string[];
  /** Modifiers from the triggering key event (nudge uses shift for ×10). */
  modifiers?: { shift: boolean; alt: boolean; ctrlOrCmd: boolean };
  /** Present when the canvas viewport host is mounted. */
  view?: ViewActions;
  /** Present when the project session is ready. */
  files?: FileActions;
  /** Present at the application root. */
  ui?: UiActions;
  /** Explicit ids for targeted selection commands (layers, quick switcher). */
  targetIds?: readonly string[];
  /** Inspector write payload: op name plus the ops to send when enabled. */
  inspectorOp?: { op: string; ops: unknown[] };
}

/** Why a command refuses to run (surfaced consistently, never swallowed). */
export type CommandDisableReason =
  | 'empty-selection'
  | 'needs-multiple'
  | 'needs-triple'
  | 'no-document'
  | 'text-editing'
  | 'unavailable';

/** Enablement verdict; disabled commands render disabled with a reason. */
export type CommandVerdict = { executable: true } | { executable: false; reason: string };

/** Execution outcome mapped to consistent user feedback. */
export type CommandResult =
  | { status: 'ok'; affected?: number }
  | { status: 'disabled'; reason: string }
  | { status: 'notApplicable'; reason?: string }
  | { status: 'validationError'; message: string }
  | { status: 'engineError'; code: string; message: string };

/** Declarative description of one user command (single execution source). */
export interface CommandDefinition extends Descriptor {
  /** Surfaces allowed to render this command. */
  surfaces: readonly CommandSurface[];
  /** Conceptual scope for focus-aware dispatch. */
  scope: CommandScope;
  /** Palette grouping. */
  category: CommandCategory;
  /** Extra search terms for the palette (beyond label). */
  keywords?: readonly string[];
  /** Icon name key; the UI layer maps it to a component (no React in the registry). */
  icon?: string;
  /** Keyboard chords that invoke this command (empty = palette/menu only). */
  shortcuts?: readonly ShortcutChord[];
  /** Localization key for `defaultDescription` (paired, all-or-nothing). */
  descriptionKey?: string;
  /** Tooltip text; falls back to `defaultLabel` when absent. */
  defaultDescription?: string;
  /**
   * Enablement predicate. Pure and synchronous: derives from selection
   * cardinality, history flags, and host capabilities — never from stale
   * React state. Prefer this over ad-hoc `disabled` props on surfaces.
   */
  canExecute: (ctx: CommandContext) => CommandVerdict;
  /**
   * One execution path shared by toolbar, menu, context menu, palette,
   * and shortcuts. Returns a structured result; never throws for
   * expected engine rejections.
   */
  execute: (ctx: CommandContext) => Promise<CommandResult>;
  /**
   * Legacy gating predicate (toolbar-era). Kept as an alias so older
   * surfaces keep working while they migrate to `canExecute`.
   */
  isEnabled?: (ctx: CommandContext) => boolean;
}

function enabled(): CommandVerdict {
  return { executable: true };
}

function disabled(reason: CommandDisableReason): CommandVerdict {
  return { executable: false, reason };
}

function needsSelection(ctx: CommandContext, atLeast = 1): CommandVerdict {
  if (ctx.selection.length < atLeast) {
    return disabled(atLeast >= 3 ? 'needs-triple' : atLeast >= 2 ? 'needs-multiple' : 'empty-selection');
  }
  return enabled();
}

function engineError(code: string, message: string): CommandResult {
  return { status: 'engineError', code, message };
}

/**
 * Map one batch crossing to a command result. Every op reports
 * individually, so the first failure determines the outcome instead of
 * being swallowed to keep the UI clean.
 */
function resultFromBatch(raw: string, op: string): CommandResult {
  let parsed: ReturnType<typeof parseBatchResult>;
  try {
    parsed = parseBatchResult(raw);
  } catch (error) {
    return engineError('parseError', error instanceof Error ? error.message : String(error));
  }
  const failure = parsed.results.find((entry) => entry.op === op && !entry.ok);
  if (failure) {
    return engineError(failure.code ?? 'engineError', failure.message ?? `op "${op}" failed`);
  }
  const data = [...parsed.results].reverse().find((entry) => entry.op === op && entry.ok)?.data as
    | { count?: unknown; affected?: unknown }
    | undefined;
  const count = typeof data?.count === 'number' ? data.count : undefined;
  const affected = Array.isArray(data?.affected) ? data.affected.length : count;
  if (op === 'paste' && count === 0) {
    return { status: 'notApplicable', reason: 'empty-clipboard' };
  }
  return { status: 'ok', affected };
}

async function runOp(ctx: CommandContext, op: string, ops: unknown[]): Promise<CommandResult> {
  try {
    const raw = await ctx.sendBatch(ops);
    const result = resultFromBatch(raw, op);
    // The canvas frame watcher sleeps while clean: every applied command
    // wakes it for exactly one fresh frame instead of polling on a timer.
    if (result.status === 'ok') ctx.view?.refreshFrame?.();
    return result;
  } catch (error) {
    return engineError('transportError', error instanceof Error ? error.message : String(error));
  }
}

async function freshSelection(ctx: CommandContext): Promise<readonly string[]> {
  try {
    const status = await ctx.engine.getStatus();
    return status.selection;
  } catch {
    return ctx.selection;
  }
}

const SELECT_Z_OPS = ['bringToFront', 'sendToBack', 'bringForward', 'sendBackward'] as const;

/** Context-menu wording for the z-order ops. */
const Z_OP_LABELS: Record<(typeof SELECT_Z_OPS)[number], string> = {
  bringToFront: 'Bring to front',
  sendToBack: 'Send to back',
  bringForward: 'Bring forward',
  sendBackward: 'Send backward',
};

const Z_OP_DESCRIPTIONS: Record<(typeof SELECT_Z_OPS)[number], string> = {
  bringToFront: 'Move selection to the front',
  sendToBack: 'Move selection to the back',
  bringForward: 'Move selection one step forward',
  sendBackward: 'Move selection one step backward',
};

function nudgeCommand(
  id: string,
  labelKey: string,
  defaultLabel: string,
  descriptionKey: string,
  defaultDescription: string,
  key: string,
  dx: number,
  dy: number,
): CommandDefinition {
  return {
    id,
    labelKey,
    defaultLabel,
    descriptionKey,
    defaultDescription,
    scope: 'selection',
    category: 'edit',
    icon: 'nudge',
    keywords: ['move', 'nudge', 'arrow'],
    shortcuts: [{ key }],
    surfaces: ['palette'],
    canExecute: (ctx) => needsSelection(ctx, 1),
    execute: async (ctx) => {
      const step = ctx.modifiers?.shift ? 10 : 1;
      return runOp(ctx, 'nudge', [{ op: 'nudge', dx: dx * step, dy: dy * step }]);
    },
  };
}

function alignCommand(
  id: string,
  defaultLabel: string,
  defaultDescription: string,
  mode: string,
): CommandDefinition {
  return {
    id,
    labelKey: `editor.commands.${id}`,
    defaultLabel,
    descriptionKey: `editor.commands.${id}Description`,
    defaultDescription,
    scope: 'selection',
    category: 'align',
    icon: 'align',
    keywords: ['align', 'arrange', mode],
    surfaces: ['menu', 'contextMenu', 'palette'],
    canExecute: (ctx) => needsSelection(ctx, 2),
    execute: async (ctx) => runOp(ctx, 'align', [{ op: 'align', ids: [...ctx.selection], mode }]),
  };
}

function distributeCommand(
  id: string,
  defaultLabel: string,
  defaultDescription: string,
  axis: string,
): CommandDefinition {
  return {
    id,
    labelKey: `editor.commands.${id}`,
    defaultLabel,
    descriptionKey: `editor.commands.${id}Description`,
    defaultDescription,
    scope: 'selection',
    category: 'align',
    icon: 'distribute',
    keywords: ['distribute', 'space', 'evenly', axis],
    surfaces: ['menu', 'contextMenu', 'palette'],
    canExecute: (ctx) => needsSelection(ctx, 3),
    execute: async (ctx) =>
      runOp(ctx, 'distribute', [{ op: 'distribute', ids: [...ctx.selection], axis }]),
  };
}

const COMMANDS: readonly CommandDefinition[] = [
  {
    id: 'undo',
    labelKey: 'editor.commands.undo',
    defaultLabel: 'Undo',
    descriptionKey: 'editor.commands.undoDescription',
    defaultDescription: 'Undo the last change',
    scope: 'editor',
    category: 'history',
    icon: 'undo',
    keywords: ['undo', 'history', 'revert'],
    shortcuts: [{ key: 'z', ctrlOrCmd: true }],
    surfaces: ['toolbar', 'menu', 'palette'],
    canExecute: (ctx) => (ctx.canUndo ? enabled() : disabled('unavailable')),
    isEnabled: (ctx) => ctx.canUndo,
    execute: async (ctx) => runOp(ctx, 'undo', [{ op: 'undo' }]),
  },
  {
    id: 'redo',
    labelKey: 'editor.commands.redo',
    defaultLabel: 'Redo',
    descriptionKey: 'editor.commands.redoDescription',
    defaultDescription: 'Redo the undone change',
    scope: 'editor',
    category: 'history',
    icon: 'redo',
    keywords: ['redo', 'history', 'repeat'],
    shortcuts: [
      { key: 'z', ctrlOrCmd: true, shift: true },
      { key: 'y', ctrlOrCmd: true },
    ],
    surfaces: ['toolbar', 'menu', 'palette'],
    canExecute: (ctx) => (ctx.canRedo ? enabled() : disabled('unavailable')),
    isEnabled: (ctx) => ctx.canRedo,
    execute: async (ctx) => runOp(ctx, 'redo', [{ op: 'redo' }]),
  },
  {
    id: 'copy',
    labelKey: 'editor.commands.copy',
    defaultLabel: 'Copy',
    descriptionKey: 'editor.commands.copyDescription',
    defaultDescription: 'Copy selection to the clipboard buffer',
    scope: 'selection',
    category: 'clipboard',
    icon: 'copy',
    keywords: ['copy', 'clipboard'],
    shortcuts: [{ key: 'c', ctrlOrCmd: true }],
    surfaces: ['menu', 'contextMenu', 'palette'],
    canExecute: (ctx) => needsSelection(ctx, 1),
    execute: async (ctx) => {
      const ids = [...(await freshSelection(ctx))];
      if (ids.length === 0) return { status: 'disabled', reason: 'empty-selection' };
      return runOp(ctx, 'copy', [{ op: 'copy', ids }]);
    },
  },
  {
    id: 'cut',
    labelKey: 'editor.commands.cut',
    defaultLabel: 'Cut',
    descriptionKey: 'editor.commands.cutDescription',
    defaultDescription: 'Cut selection to the clipboard buffer',
    scope: 'selection',
    category: 'clipboard',
    icon: 'cut',
    keywords: ['cut', 'clipboard', 'move'],
    shortcuts: [{ key: 'x', ctrlOrCmd: true }],
    surfaces: ['menu', 'contextMenu', 'palette'],
    canExecute: (ctx) => needsSelection(ctx, 1),
    execute: async (ctx) => {
      const ids = [...(await freshSelection(ctx))];
      if (ids.length === 0) return { status: 'disabled', reason: 'empty-selection' };
      return runOp(ctx, 'cut', [{ op: 'cut', ids }]);
    },
  },
  {
    id: 'paste',
    labelKey: 'editor.commands.paste',
    defaultLabel: 'Paste',
    descriptionKey: 'editor.commands.pasteDescription',
    defaultDescription: 'Paste the clipboard buffer',
    scope: 'editor',
    category: 'clipboard',
    icon: 'paste',
    keywords: ['paste', 'clipboard'],
    shortcuts: [{ key: 'v', ctrlOrCmd: true }],
    surfaces: ['menu', 'contextMenu', 'palette'],
    canExecute: () => enabled(),
    execute: async (ctx) => runOp(ctx, 'paste', [{ op: 'paste' }]),
  },
  {
    id: 'delete',
    labelKey: 'editor.commands.delete',
    defaultLabel: 'Delete',
    descriptionKey: 'editor.commands.deleteDescription',
    defaultDescription: 'Delete selection',
    scope: 'selection',
    category: 'edit',
    icon: 'delete',
    keywords: ['delete', 'remove', 'clear'],
    shortcuts: [{ key: 'Delete' }, { key: 'Backspace' }],
    surfaces: ['toolbar', 'menu', 'contextMenu', 'palette'],
    canExecute: (ctx) => needsSelection(ctx, 1),
    isEnabled: (ctx) => ctx.selection.length > 0,
    execute: async (ctx) => runOp(ctx, 'deleteSelected', [{ op: 'deleteSelected' }]),
  },
  {
    id: 'duplicate',
    labelKey: 'editor.commands.duplicate',
    defaultLabel: 'Duplicate',
    descriptionKey: 'editor.commands.duplicateDescription',
    defaultDescription: 'Duplicate selection',
    scope: 'selection',
    category: 'edit',
    icon: 'duplicate',
    keywords: ['duplicate', 'clone', 'copy'],
    shortcuts: [{ key: 'd', ctrlOrCmd: true }],
    surfaces: ['toolbar', 'menu', 'contextMenu', 'palette'],
    canExecute: (ctx) => needsSelection(ctx, 1),
    isEnabled: (ctx) => ctx.selection.length > 0,
    execute: async (ctx) => {
      // Re-read the selection at execution time so a click never duplicates
      // stale ids from the last status poll.
      const ids = [...(await freshSelection(ctx))];
      if (ids.length === 0) return { status: 'disabled', reason: 'empty-selection' };
      return runOp(ctx, 'duplicate', [{ op: 'duplicate', ids }]);
    },
  },
  {
    id: 'selectAll',
    labelKey: 'editor.commands.selectAll',
    defaultLabel: 'Select all',
    descriptionKey: 'editor.commands.selectAllDescription',
    defaultDescription: 'Select all elements',
    scope: 'selection',
    category: 'edit',
    icon: 'selectAll',
    keywords: ['select', 'all'],
    shortcuts: [{ key: 'a', ctrlOrCmd: true }],
    surfaces: ['menu', 'contextMenu', 'palette'],
    canExecute: (ctx) => (ctx.documentIds.length > 0 ? enabled() : disabled('no-document')),
    execute: async (ctx) => {
      if (ctx.documentIds.length === 0) return { status: 'disabled', reason: 'no-document' };
      return runOp(ctx, 'select', [{ op: 'select', ids: [...ctx.documentIds] }]);
    },
  },
  {
    id: 'selectIds',
    labelKey: 'editor.commands.selectAll',
    defaultLabel: 'Select layers',
    descriptionKey: 'editor.commands.selectAllDescription',
    defaultDescription: 'Select the targeted elements',
    scope: 'selection',
    category: 'edit',
    icon: 'selectAll',
    keywords: ['select', 'layer'],
    surfaces: [],
    canExecute: (ctx) =>
      ctx.targetIds !== undefined && ctx.targetIds.length > 0 ? enabled() : disabled('unavailable'),
    execute: async (ctx) => {
      if (!ctx.targetIds || ctx.targetIds.length === 0) {
        return { status: 'disabled', reason: 'unavailable' };
      }
      return runOp(ctx, 'select', [{ op: 'select', ids: [...ctx.targetIds] }]);
    },
  },
  {
    id: 'deselect',
    labelKey: 'editor.commands.escape',
    defaultLabel: 'Deselect all',
    descriptionKey: 'editor.commands.escapeDescription',
    defaultDescription: 'Clear the selection',
    scope: 'selection',
    category: 'edit',
    icon: 'escape',
    keywords: ['deselect', 'clear', 'selection'],
    surfaces: ['palette'],
    canExecute: (ctx) => needsSelection(ctx, 1),
    execute: async (ctx) => runOp(ctx, 'select', [{ op: 'select', ids: [] }]),
  },
  {
    id: 'inspector.setBounds',
    labelKey: 'editor.commands.selectAll',
    defaultLabel: 'Set bounds',
    descriptionKey: 'editor.commands.selectAllDescription',
    defaultDescription: 'Write inspector bounds to the engine',
    scope: 'selection',
    category: 'edit',
    icon: 'inspector',
    keywords: ['inspector', 'bounds', 'position', 'size'],
    surfaces: [],
    canExecute: (ctx) =>
      ctx.inspectorOp?.op === 'setBounds' ? needsSelection(ctx, 1) : disabled('unavailable'),
    execute: async (ctx) => {
      if (!ctx.inspectorOp || ctx.inspectorOp.op !== 'setBounds') {
        return { status: 'disabled', reason: 'unavailable' };
      }
      return runOp(ctx, 'setBounds', ctx.inspectorOp.ops);
    },
  },
  {
    id: 'inspector.setRotation',
    labelKey: 'editor.commands.selectAll',
    defaultLabel: 'Set rotation',
    descriptionKey: 'editor.commands.selectAllDescription',
    defaultDescription: 'Write inspector rotation to the engine',
    scope: 'selection',
    category: 'edit',
    icon: 'inspector',
    keywords: ['inspector', 'rotation'],
    surfaces: [],
    canExecute: (ctx) =>
      ctx.inspectorOp?.op === 'setRotation' ? needsSelection(ctx, 1) : disabled('unavailable'),
    execute: async (ctx) => {
      if (!ctx.inspectorOp || ctx.inspectorOp.op !== 'setRotation') {
        return { status: 'disabled', reason: 'unavailable' };
      }
      return runOp(ctx, 'setRotation', ctx.inspectorOp.ops);
    },
  },
  {
    id: 'inspector.setStyle',
    labelKey: 'editor.commands.selectAll',
    defaultLabel: 'Set style',
    descriptionKey: 'editor.commands.selectAllDescription',
    defaultDescription: 'Write inspector style to the engine',
    scope: 'selection',
    category: 'edit',
    icon: 'inspector',
    keywords: ['inspector', 'style', 'fill', 'stroke'],
    surfaces: [],
    canExecute: (ctx) =>
      ctx.inspectorOp?.op === 'setStyle' ? needsSelection(ctx, 1) : disabled('unavailable'),
    execute: async (ctx) => {
      if (!ctx.inspectorOp || ctx.inspectorOp.op !== 'setStyle') {
        return { status: 'disabled', reason: 'unavailable' };
      }
      return runOp(ctx, 'setStyle', ctx.inspectorOp.ops);
    },
  },
  nudgeCommand(
    'nudgeLeft',
    'editor.commands.nudgeLeft',
    'Nudge left',
    'editor.commands.nudgeLeftDescription',
    'Move selection left',
    'ArrowLeft',
    -1,
    0,
  ),
  nudgeCommand(
    'nudgeRight',
    'editor.commands.nudgeRight',
    'Nudge right',
    'editor.commands.nudgeRightDescription',
    'Move selection right',
    'ArrowRight',
    1,
    0,
  ),
  nudgeCommand(
    'nudgeUp',
    'editor.commands.nudgeUp',
    'Nudge up',
    'editor.commands.nudgeUpDescription',
    'Move selection up',
    'ArrowUp',
    0,
    -1,
  ),
  nudgeCommand(
    'nudgeDown',
    'editor.commands.nudgeDown',
    'Nudge down',
    'editor.commands.nudgeDownDescription',
    'Move selection down',
    'ArrowDown',
    0,
    1,
  ),
  ...SELECT_Z_OPS.map(
    (op): CommandDefinition => ({
      id: op,
      labelKey: `editor.commands.${op}`,
      defaultLabel: Z_OP_LABELS[op],
      descriptionKey: `editor.commands.${op}Description`,
      defaultDescription: Z_OP_DESCRIPTIONS[op],
      scope: 'selection',
      category: 'arrange',
      icon: op,
      keywords: ['arrange', 'layer', 'order', op],
      surfaces: ['menu', 'contextMenu', 'palette'],
      canExecute: (ctx) => needsSelection(ctx, 1),
      execute: async (ctx) => runOp(ctx, op, [{ op, ids: [...ctx.selection] }]),
    }),
  ),
  {
    id: 'group',
    labelKey: 'editor.commands.group',
    defaultLabel: 'Group',
    descriptionKey: 'editor.commands.groupDescription',
    defaultDescription: 'Group the selection',
    scope: 'selection',
    category: 'arrange',
    icon: 'group',
    keywords: ['group', 'combine'],
    shortcuts: [{ key: 'g', ctrlOrCmd: true }],
    surfaces: ['menu', 'contextMenu', 'palette'],
    canExecute: (ctx) => needsSelection(ctx, 2),
    execute: async (ctx) => runOp(ctx, 'group', [{ op: 'group', ids: [...ctx.selection] }]),
  },
  {
    id: 'ungroup',
    labelKey: 'editor.commands.ungroup',
    defaultLabel: 'Ungroup',
    descriptionKey: 'editor.commands.ungroupDescription',
    defaultDescription: 'Ungroup the selection',
    scope: 'selection',
    category: 'arrange',
    icon: 'ungroup',
    keywords: ['ungroup', 'separate'],
    shortcuts: [{ key: 'g', ctrlOrCmd: true, shift: true }],
    surfaces: ['menu', 'contextMenu', 'palette'],
    canExecute: (ctx) => needsSelection(ctx, 1),
    execute: async (ctx) => {
      // Ungroup needs a group id: resolve the first grouped member of the
      // selection with one export (one-shot, not per frame).
      try {
        const sceneJson = await ctx.engine.exportScene();
        const scene = JSON.parse(sceneJson) as {
          elements?: { id?: string; groupIds?: string[] }[];
        };
        const elements = scene.elements ?? [];
        const byId = new Map(elements.map((el) => [el.id, el]));
        const groupId = ctx.selection
          .map((id) => byId.get(id)?.groupIds?.[0])
          .find((gid): gid is string => typeof gid === 'string');
        if (!groupId) return { status: 'notApplicable', reason: 'not-grouped' };
        return runOp(ctx, 'ungroup', [{ op: 'ungroup', groupId }]);
      } catch (error) {
        return engineError('engineError', error instanceof Error ? error.message : String(error));
      }
    },
  },
  {
    id: 'lock',
    labelKey: 'editor.commands.lock',
    defaultLabel: 'Lock',
    descriptionKey: 'editor.commands.lockDescription',
    defaultDescription: 'Lock the selection',
    scope: 'selection',
    category: 'arrange',
    icon: 'lock',
    keywords: ['lock', 'protect'],
    surfaces: ['menu', 'contextMenu', 'palette'],
    canExecute: (ctx) => needsSelection(ctx, 1),
    execute: async (ctx) => {
      // Lock is a toggle in the editor UI: a mixed or unlocked selection is
      // locked as one operation; an entirely locked selection is unlocked.
      try {
        const sceneJson = await ctx.engine.exportScene();
        const scene = JSON.parse(sceneJson) as {
          elements?: { id?: string; locked?: boolean; isDeleted?: boolean }[];
        };
        const byId = new Map((scene.elements ?? []).map((element) => [element.id, element]));
        const selected = ctx.selection
          .map((id) => byId.get(id))
          .filter((element): element is { id?: string; locked?: boolean; isDeleted?: boolean } =>
            element !== undefined && element.isDeleted !== true,
          );
        const locked = selected.length > 0 && selected.every((element) => element.locked === true);
        return runOp(ctx, 'setLocked', [{ op: 'setLocked', ids: [...ctx.selection], locked: !locked }]);
      } catch (error) {
        return engineError('engineError', error instanceof Error ? error.message : String(error));
      }
    },
  },
  {
    id: 'unlock',
    labelKey: 'editor.commands.unlock',
    defaultLabel: 'Unlock',
    descriptionKey: 'editor.commands.unlockDescription',
    defaultDescription: 'Unlock the selection',
    scope: 'selection',
    category: 'arrange',
    icon: 'unlock',
    keywords: ['unlock', 'unprotect'],
    surfaces: ['menu', 'contextMenu', 'palette'],
    canExecute: (ctx) => needsSelection(ctx, 1),
    execute: async (ctx) =>
      runOp(ctx, 'setLocked', [{ op: 'setLocked', ids: [...ctx.selection], locked: false }]),
  },
  alignCommand('alignLeft', 'Align left', 'Align selection to the left', 'left'),
  alignCommand('alignCenterH', 'Align center', 'Align selection horizontally centered', 'centerH'),
  alignCommand('alignRight', 'Align right', 'Align selection to the right', 'right'),
  alignCommand('alignTop', 'Align top', 'Align selection to the top', 'top'),
  alignCommand('alignCenterV', 'Align middle', 'Align selection vertically centered', 'centerV'),
  alignCommand('alignBottom', 'Align bottom', 'Align selection to the bottom', 'bottom'),
  distributeCommand(
    'distributeHorizontal',
    'Distribute horizontally',
    'Distribute selection with equal horizontal gaps',
    'horizontal',
  ),
  distributeCommand(
    'distributeVertical',
    'Distribute vertically',
    'Distribute selection with equal vertical gaps',
    'vertical',
  ),
  {
    id: 'zoomIn',
    labelKey: 'editor.commands.zoomIn',
    defaultLabel: 'Zoom in',
    descriptionKey: 'editor.commands.zoomInDescription',
    defaultDescription: 'Zoom the canvas in',
    scope: 'canvas',
    category: 'view',
    icon: 'zoomIn',
    keywords: ['zoom', 'in', 'view'],
    shortcuts: [{ key: '=', ctrlOrCmd: true }],
    surfaces: ['menu', 'palette'],
    canExecute: (ctx) => (ctx.view ? enabled() : disabled('unavailable')),
    execute: async (ctx) => {
      if (!ctx.view) return { status: 'disabled', reason: 'unavailable' };
      await ctx.view.zoomStep(1.25);
      return { status: 'ok' };
    },
  },
  {
    id: 'zoomOut',
    labelKey: 'editor.commands.zoomOut',
    defaultLabel: 'Zoom out',
    descriptionKey: 'editor.commands.zoomOutDescription',
    defaultDescription: 'Zoom the canvas out',
    scope: 'canvas',
    category: 'view',
    icon: 'zoomOut',
    keywords: ['zoom', 'out', 'view'],
    shortcuts: [{ key: '-', ctrlOrCmd: true }],
    surfaces: ['menu', 'palette'],
    canExecute: (ctx) => (ctx.view ? enabled() : disabled('unavailable')),
    execute: async (ctx) => {
      if (!ctx.view) return { status: 'disabled', reason: 'unavailable' };
      await ctx.view.zoomStep(1 / 1.25);
      return { status: 'ok' };
    },
  },
  {
    id: 'resetZoom',
    labelKey: 'editor.commands.resetZoom',
    defaultLabel: 'Reset zoom',
    descriptionKey: 'editor.commands.resetZoomDescription',
    defaultDescription: 'Reset zoom to 100%',
    scope: 'canvas',
    category: 'view',
    icon: 'resetZoom',
    keywords: ['zoom', 'reset', '100%'],
    shortcuts: [{ key: '0', ctrlOrCmd: true }],
    surfaces: ['menu', 'palette'],
    canExecute: (ctx) => (ctx.view ? enabled() : disabled('unavailable')),
    execute: async (ctx) => {
      if (!ctx.view) return { status: 'disabled', reason: 'unavailable' };
      await ctx.view.resetZoom();
      return { status: 'ok' };
    },
  },
  {
    id: 'fitContent',
    labelKey: 'editor.commands.fitContent',
    defaultLabel: 'Fit content',
    descriptionKey: 'editor.commands.fitContentDescription',
    defaultDescription: 'Fit all content to view',
    scope: 'canvas',
    category: 'view',
    icon: 'fit',
    keywords: ['fit', 'content', 'view', 'frame'],
    surfaces: ['menu', 'palette'],
    canExecute: (ctx) => (ctx.view ? enabled() : disabled('unavailable')),
    execute: async (ctx) => {
      if (!ctx.view) return { status: 'disabled', reason: 'unavailable' };
      await ctx.view.fitContent();
      return { status: 'ok' };
    },
  },
  {
    id: 'fitSelection',
    labelKey: 'editor.commands.fitSelection',
    defaultLabel: 'Fit selection',
    descriptionKey: 'editor.commands.fitSelectionDescription',
    defaultDescription: 'Fit the selection to view',
    scope: 'selection',
    category: 'view',
    icon: 'fitSelection',
    keywords: ['fit', 'selection', 'view', 'frame'],
    surfaces: ['menu', 'palette'],
    canExecute: (ctx) => {
      if (!ctx.view) return disabled('unavailable');
      return needsSelection(ctx, 1);
    },
    execute: async (ctx) => {
      if (!ctx.view) return { status: 'disabled', reason: 'unavailable' };
      if (ctx.selection.length === 0) return { status: 'disabled', reason: 'empty-selection' };
      await ctx.view.fitSelection();
      return { status: 'ok' };
    },
  },
  {
    id: 'escape',
    labelKey: 'editor.commands.escape',
    defaultLabel: 'Cancel / deselect',
    descriptionKey: 'editor.commands.escapeDescription',
    defaultDescription: 'Cancel the active gesture or clear selection',
    scope: 'editor',
    category: 'edit',
    icon: 'escape',
    keywords: ['escape', 'cancel', 'deselect', 'clear'],
    shortcuts: [{ key: 'Escape' }],
    surfaces: ['palette'],
    canExecute: () => enabled(),
    execute: async (ctx) =>
      runOp(ctx, 'keyDown', [
        { op: 'keyDown', key: 'Escape', modifiers: { shift: false, alt: false, ctrlOrCmd: false } },
      ]),
  },
  {
    id: 'exportScene',
    labelKey: 'editor.commands.exportScene',
    defaultLabel: 'Export scene',
    descriptionKey: 'editor.commands.exportSceneDescription',
    defaultDescription: 'Export scene JSON to a file',
    scope: 'project',
    category: 'document',
    icon: 'export',
    keywords: ['export', 'save', 'download', 'json'],
    surfaces: ['menu', 'palette'],
    canExecute: (ctx) => (ctx.files ? enabled() : disabled('unavailable')),
    execute: async (ctx) => {
      if (!ctx.files) return { status: 'disabled', reason: 'unavailable' };
      try {
        await ctx.files.exportScene();
        return { status: 'ok' };
      } catch (error) {
        return engineError('engineError', error instanceof Error ? error.message : String(error));
      }
    },
  },
  {
    id: 'importScene',
    labelKey: 'editor.commands.importScene',
    defaultLabel: 'Import scene',
    descriptionKey: 'editor.commands.importSceneDescription',
    defaultDescription: 'Import scene JSON from a file',
    scope: 'project',
    category: 'document',
    icon: 'import',
    keywords: ['import', 'open', 'load', 'json'],
    surfaces: ['menu', 'palette'],
    canExecute: (ctx) => (ctx.files ? enabled() : disabled('unavailable')),
    execute: async (ctx) => {
      if (!ctx.files) return { status: 'disabled', reason: 'unavailable' };
      try {
        await ctx.files.importScene();
        return { status: 'ok' };
      } catch (error) {
        return engineError('engineError', error instanceof Error ? error.message : String(error));
      }
    },
  },
  {
    id: 'exportPng',
    labelKey: 'editor.commands.exportPng',
    defaultLabel: 'Export PNG',
    descriptionKey: 'editor.commands.exportPngDescription',
    defaultDescription: 'Export the canvas to a PNG file',
    scope: 'project',
    category: 'document',
    icon: 'export',
    keywords: ['export', 'png', 'image', 'download', 'picture'],
    surfaces: ['menu', 'palette'],
    canExecute: (ctx) => (ctx.files ? enabled() : disabled('unavailable')),
    execute: async (ctx) => {
      if (!ctx.files) return { status: 'disabled', reason: 'unavailable' };
      try {
        await ctx.files.exportPng();
        return { status: 'ok' };
      } catch (error) {
        return engineError('engineError', error instanceof Error ? error.message : String(error));
      }
    },
  },
  {
    id: 'exportSvg',
    labelKey: 'editor.commands.exportSvg',
    defaultLabel: 'Export SVG',
    descriptionKey: 'editor.commands.exportSvgDescription',
    defaultDescription: 'Export the canvas to an SVG file',
    scope: 'project',
    category: 'document',
    icon: 'export',
    keywords: ['export', 'svg', 'vector', 'download', 'picture'],
    surfaces: ['menu', 'palette'],
    canExecute: (ctx) => (ctx.files ? enabled() : disabled('unavailable')),
    execute: async (ctx) => {
      if (!ctx.files) return { status: 'disabled', reason: 'unavailable' };
      try {
        await ctx.files.exportSvg();
        return { status: 'ok' };
      } catch (error) {
        return engineError('engineError', error instanceof Error ? error.message : String(error));
      }
    },
  },
  {
    id: 'exportPdf',
    labelKey: 'editor.commands.exportPdf',
    defaultLabel: 'Export PDF',
    descriptionKey: 'editor.commands.exportPdfDescription',
    defaultDescription: 'Export the canvas to a PDF file',
    scope: 'project',
    category: 'document',
    icon: 'export',
    keywords: ['export', 'pdf', 'document', 'download', 'print'],
    surfaces: ['menu', 'palette'],
    canExecute: (ctx) => (ctx.files ? enabled() : disabled('unavailable')),
    execute: async (ctx) => {
      if (!ctx.files) return { status: 'disabled', reason: 'unavailable' };
      try {
        await ctx.files.exportPdf();
        return { status: 'ok' };
      } catch (error) {
        return engineError('engineError', error instanceof Error ? error.message : String(error));
      }
    },
  },
  {
    id: 'commandPalette',
    labelKey: 'editor.commands.commandPalette',
    defaultLabel: 'Command palette',
    descriptionKey: 'editor.commands.commandPaletteDescription',
    defaultDescription: 'Search and run commands',
    scope: 'application',
    category: 'view',
    icon: 'palette',
    keywords: ['palette', 'command', 'search', 'actions'],
    shortcuts: [
      { key: 'p', ctrlOrCmd: true, shift: true },
      { key: 'k', ctrlOrCmd: true },
    ],
    surfaces: [],
    canExecute: (ctx) => (ctx.ui ? enabled() : disabled('unavailable')),
    execute: async (ctx) => {
      if (!ctx.ui) return { status: 'disabled', reason: 'unavailable' };
      ctx.ui.openPalette();
      return { status: 'ok' };
    },
  },
];

function findShortcutCollisions(items: readonly CommandDefinition[]): readonly string[] {
  const ownerByHint = new Map<string, string>();
  const problems: string[] = [];
  const chordKey = (chord: ShortcutChord): string =>
    `${chord.ctrlOrCmd ? 'ctrl+' : ''}${chord.shift ? 'shift+' : ''}${chord.alt ? 'alt+' : ''}${chord.key.toLowerCase()}`;
  for (const item of items) {
    for (const chord of item.shortcuts ?? []) {
      const key = chordKey(chord);
      const owner = ownerByHint.get(key);
      if (owner) {
        problems.push(`shortcut "${key}" claimed by "${owner}" and "${item.id}"`);
      } else {
        ownerByHint.set(key, item.id);
      }
    }
  }
  return problems;
}

/** Validated lookup over the commands shared by every surface. */
export const commandRegistry = createRegistry('command', COMMANDS, {
  validateItem: (command) => {
    const keyed = command.descriptionKey !== undefined;
    const described = command.defaultDescription !== undefined;
    if (keyed !== described) {
      return `descriptionKey and defaultDescription must both be present or absent for id "${command.id}"`;
    }
    if (command.defaultLabel === '') {
      return `empty defaultLabel for id "${command.id}"`;
    }
    return undefined;
  },
  validateAll: findShortcutCollisions,
});

/** Commands for one surface in registration order (no per-surface branching). */
export function commandsForSurface(surface: CommandSurface): readonly CommandDefinition[] {
  return commandRegistry.all().filter((command) => command.surfaces.includes(surface));
}

/** Palette-visible commands: explicit palette surface (no hidden duplicates). */
export function paletteCommands(): readonly CommandDefinition[] {
  return commandsForSurface('palette');
}

/** Search palette commands by label and keywords (case-insensitive substring). */
export function searchCommands(query: string): readonly CommandDefinition[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return paletteCommands();
  return paletteCommands().filter((command) => {
    const haystacks = [
      command.defaultLabel.toLowerCase(),
      command.defaultDescription?.toLowerCase() ?? '',
      command.id.toLowerCase(),
      ...(command.keywords ?? []).map((keyword) => keyword.toLowerCase()),
    ];
    return haystacks.some((haystack) => haystack.includes(needle));
  });
}

/**
 * Single execution source for every surface. Checks enablement first so
 * toolbar, menu, context menu, palette, and shortcuts share one gating
 * path instead of duplicating `disabled` logic per surface.
 */
export async function executeCommand(
  id: string,
  ctx: CommandContext,
): Promise<CommandResult> {
  const command = commandRegistry.get(id);
  if (!command) return { status: 'notApplicable', reason: 'unknown-command' };
  const verdict = command.canExecute(ctx);
  if (!verdict.executable) return { status: 'disabled', reason: verdict.reason };
  // Legacy alias stays consistent: when both exist they must agree.
  const legacy = command.isEnabled?.(ctx) ?? true;
  if (!legacy) return { status: 'disabled', reason: 'unavailable' };
  try {
    return await command.execute(ctx);
  } catch (error) {
    return engineError('engineError', error instanceof Error ? error.message : String(error));
  }
}

/** Enablement probe shared by buttons, menu items, and palette rows. */
export function canExecuteCommand(id: string, ctx: CommandContext): CommandVerdict {
  const command = commandRegistry.get(id);
  if (!command) return disabled('unavailable');
  return command.canExecute(ctx);
}
