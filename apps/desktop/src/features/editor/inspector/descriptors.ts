import type { DrawEntryDto, Engine } from '../../../hooks/useEngine';
import type { FillPreview } from '../../../render/drawModel';
import type { CommandResult } from '../../../registries';
import { fillToPatch, isGradientFill, paintToFill, type FillValue } from './colorSwatches';

/** Control template a field renders through (no bespoke JSX per property). */
export type InspectorControlType =
  | 'number'
  | 'opacity'
  | 'text'
  | 'color'
  | 'select'
  | 'toggle'
  | 'segmented'
  | 'alignment'
  | 'readonly';

/** Display precision for transform numbers: one decimal (Figma-style). */
export const TRANSFORM_DECIMALS = 1;

/**
 * Rounds to one decimal for inspector display and commits. Storage keeps
 * full float precision (repeated gestures would drift if the engine
 * rounded), so long fractions like 619.2807… render as 619.3.
 */
export function roundToTenth(value: number): number {
  const rounded = Math.round(value * 10) / 10;
  return rounded === 0 ? 0 : rounded;
}

/** Sentinel for multi-selection values that differ across the selection. */
export const MIXED = Symbol('mixed');
export type Mixed = typeof MIXED;

/** Context a field reads from and writes through (command-backed only). */
export interface InspectorFieldContext {
  entries: DrawEntryDto[];
  selection: readonly string[];
  sendBatch: (ops: unknown[]) => Promise<string>;
  engine: Engine;
  /** Open project for per-project chrome such as color recents. */
  projectId: string;
  /**
   * Uncommitted fill preview shared with the canvas loop by ref (never
   * React state). Writers set it during drags and clear it on commit,
   * cancel, or close; Canvas only ever reads it.
   */
  fillPreviewRef: { current: FillPreview | null };
  /** Write path: one inspector command per op (bounds, rotation, style). */
  commit: (commandId: string, op: string, ops: unknown[]) => Promise<CommandResult>;
}

export type FieldValue = string | number | boolean | Mixed;

/** One inspector field: generic adapters supply read/write; templates render. */
export interface InspectorFieldDefinition {
  id: string;
  labelKey: string;
  defaultLabel: string;
  control: InspectorControlType;
  read: (ctx: InspectorFieldContext) => FieldValue;
  write: (value: Exclude<FieldValue, Mixed>, ctx: InspectorFieldContext) => Promise<CommandResult>;
  validate?: (value: Exclude<FieldValue, Mixed>) => string | undefined;
  disabled?: (ctx: InspectorFieldContext) => boolean;
  visible?: (ctx: InspectorFieldContext) => boolean;
  /** Gradient tools render for this color field (fill only; strokes stay solid). */
  allowGradient?: boolean;
  options?: readonly { value: string; labelKey: string; defaultLabel: string }[];
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  placeholderKey?: string;
  defaultPlaceholder?: string;
  /**
   * Reset target rendered as a button beside the input. Set for x/y/rotation
   * (each resets to 0); absent means no reset button.
   */
  resetValue?: number;
  /**
   * Reserves reset-button space without rendering the button, so the input
   * matches the width of siblings that have one (width/height align with
   * x/y). No behavior, layout only.
   */
  reserveResetSpace?: boolean;
  /**
   * Quick-pick values in the opacity menu (single click opens, double-click
   * edits inline). Free typing in edit mode still allows any value within
   * min/max.
   */
  presets?: readonly number[];
  /**
   * Stacked layout: label above, control below full width (like fields
   * inside a row). Single fields default to label-left/input-right.
   */
  stacked?: boolean;
  /**
   * Caps a stacked control at one row-cell width, matching inputs that
   * share a row (rotation aligns with x/y). Layout only.
   */
  halfWidth?: boolean;
  /** Row group id: consecutive fields sharing one render side by side. */
  row?: string;
}

/** One inspector section: configuration + adapter, rendered generically. */
export interface InspectorSectionDefinition {
  id: string;
  titleKey: string;
  defaultTitle: string;
  order: number;
  appliesTo: (ctx: { selectionCount: number; kinds: ReadonlySet<string> }) => boolean;
  fields: readonly InspectorFieldDefinition[];
}

function mixedIf<T>(values: readonly T[]): T | Mixed {
  if (values.length === 0) return MIXED;
  const first = values[0];
  return values.every((value) => value === first) ? first : MIXED;
}

function entryFrame(entry: DrawEntryDto): DrawEntryDto['bounds'] {
  return entry.frame ?? entry.bounds;
}

function entryWidth(entry: DrawEntryDto): number {
  const frame = entryFrame(entry);
  return frame.maxX - frame.minX;
}

function entryHeight(entry: DrawEntryDto): number {
  const frame = entryFrame(entry);
  return frame.maxY - frame.minY;
}

function radiansToDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Op name to the inspector command owning it (one intent per write). */
const INSPECTOR_COMMANDS: Readonly<Record<string, string>> = {
  setBounds: 'inspector.setBounds',
  setRotation: 'inspector.setRotation',
  setStyle: 'inspector.setStyle',
};

async function runWriteOp(
  ctx: InspectorFieldContext,
  op: string,
  ops: unknown[],
): Promise<CommandResult> {
  const commandId = INSPECTOR_COMMANDS[op];
  if (!commandId) {
    return { status: 'validationError', message: `Unknown inspector op "${op}"` };
  }
  return ctx.commit(commandId, op, ops);
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function numberField(
  id: string,
  labelKey: string,
  defaultLabel: string,
  read: (ctx: InspectorFieldContext) => number | Mixed,
  write: (value: number, ctx: InspectorFieldContext) => Promise<CommandResult>,
  opts: { min?: number; max?: number; step?: number; unit?: string; row?: string; resetValue?: number; reserveResetSpace?: boolean; presets?: readonly number[]; stacked?: boolean; halfWidth?: boolean } = {},
): InspectorFieldDefinition {
  return {
    id,
    labelKey,
    defaultLabel,
    control: 'number',
    read,
    write: async (value, ctx) => {
      const numeric = finiteNumber(value);
      if (numeric === undefined) return { status: 'validationError', message: `Invalid number for ${defaultLabel}` };
      if (opts.min !== undefined && numeric < opts.min) {
        return { status: 'validationError', message: `${defaultLabel} must be >= ${opts.min}` };
      }
      if (opts.max !== undefined && numeric > opts.max) {
        return { status: 'validationError', message: `${defaultLabel} must be <= ${opts.max}` };
      }
      return write(numeric, ctx);
    },
    ...opts,
  };
}

/** One rendered unit: a lone field or a side-by-side row of fields. */
export type FieldRowGroup<T extends { id: string; row?: string }> =
  | { kind: 'single'; field: T }
  | { kind: 'row'; key: string; fields: T[] };

/**
 * Groups consecutive fields sharing a `row` id into side-by-side rows.
 * A grouped id appearing alone renders full width like an ungrouped field.
 */
export function groupFieldRows<T extends { id: string; row?: string }>(fields: readonly T[]): FieldRowGroup<T>[] {
  const groups: FieldRowGroup<T>[] = [];
  for (const field of fields) {
    const last = groups[groups.length - 1];
    if (field.row !== undefined && last !== undefined && last.kind === 'row' && last.key === field.row) {
      last.fields.push(field);
    } else if (field.row !== undefined) {
      groups.push({ kind: 'row', key: field.row, fields: [field] });
    } else {
      groups.push({ kind: 'single', field });
    }
  }
  return groups.map((group) =>
    group.kind === 'row' && group.fields.length < 2 ? { kind: 'single', field: group.fields[0] } : group,
  );
}

/** Transform section: x/y/width/height via setBounds, rotation via setRotation. */
const transformSection: InspectorSectionDefinition = {
  id: 'transform',
  titleKey: 'editor.inspector.transformTitle',
  defaultTitle: 'Transform',
  order: 10,
  appliesTo: ({ selectionCount }) => selectionCount === 1,
  fields: [
    numberField(
      'x',
      'editor.inspector.positionX',
      'X',
      (ctx) => (ctx.entries.length === 1 ? roundToTenth(entryFrame(ctx.entries[0]).minX) : MIXED),
      async (value, ctx) => {
        const entry = ctx.entries[0];
        if (!entry) return { status: 'notApplicable' };
        return runWriteOp(ctx, 'setBounds', [
          {
            op: 'setBounds',
            id: entry.id,
            x: roundToTenth(value),
            y: roundToTenth(entryFrame(entry).minY),
            width: Math.max(roundToTenth(entryWidth(entry)), 1),
            height: Math.max(roundToTenth(entryHeight(entry)), 1),
          },
        ]);
      },
      { step: 0.1, row: 'position', resetValue: 0 },
    ),
    numberField(
      'y',
      'editor.inspector.positionY',
      'Y',
      (ctx) => (ctx.entries.length === 1 ? roundToTenth(entryFrame(ctx.entries[0]).minY) : MIXED),
      async (value, ctx) => {
        const entry = ctx.entries[0];
        if (!entry) return { status: 'notApplicable' };
        return runWriteOp(ctx, 'setBounds', [
          {
            op: 'setBounds',
            id: entry.id,
            x: roundToTenth(entryFrame(entry).minX),
            y: roundToTenth(value),
            width: Math.max(roundToTenth(entryWidth(entry)), 1),
            height: Math.max(roundToTenth(entryHeight(entry)), 1),
          },
        ]);
      },
      { step: 0.1, row: 'position', resetValue: 0 },
    ),
    numberField(
      'width',
      'editor.inspector.width',
      'Width',
      (ctx) => (ctx.entries.length === 1 ? roundToTenth(entryWidth(ctx.entries[0])) : MIXED),
      async (value, ctx) => {
        const entry = ctx.entries[0];
        if (!entry) return { status: 'notApplicable' };
        return runWriteOp(ctx, 'setBounds', [
          {
            op: 'setBounds',
            id: entry.id,
            x: roundToTenth(entryFrame(entry).minX),
            y: roundToTenth(entryFrame(entry).minY),
            width: Math.max(roundToTenth(value), 1),
            height: Math.max(roundToTenth(entryHeight(entry)), 1),
          },
        ]);
      },
      { min: 1, step: 0.1, row: 'size', reserveResetSpace: true },
    ),
    numberField(
      'height',
      'editor.inspector.height',
      'Height',
      (ctx) => (ctx.entries.length === 1 ? roundToTenth(entryHeight(ctx.entries[0])) : MIXED),
      async (value, ctx) => {
        const entry = ctx.entries[0];
        if (!entry) return { status: 'notApplicable' };
        return runWriteOp(ctx, 'setBounds', [
          {
            op: 'setBounds',
            id: entry.id,
            x: roundToTenth(entryFrame(entry).minX),
            y: roundToTenth(entryFrame(entry).minY),
            width: Math.max(roundToTenth(entryWidth(entry)), 1),
            height: Math.max(roundToTenth(value), 1),
          },
        ]);
      },
      { min: 1, step: 0.1, row: 'size', reserveResetSpace: true },
    ),
    numberField(
      'rotation',
      'editor.inspector.rotation',
      'Rotation',
      (ctx) => (ctx.entries.length === 1 ? roundToTenth(radiansToDegrees(ctx.entries[0].rotation)) : MIXED),
      async (value, ctx) => {
        const entry = ctx.entries[0];
        if (!entry) return { status: 'notApplicable' };
        return runWriteOp(ctx, 'setRotation', [
          { op: 'setRotation', id: entry.id, rotation: degreesToRadians(roundToTenth(value)) },
        ]);
      },
      { step: 0.1, unit: '°', resetValue: 0, stacked: true, halfWidth: true },
    ),
  ],
};

/** Style section: scalar setStyle fields plus gradient fills (strokes stay solid). */
const styleSection: InspectorSectionDefinition = {
  id: 'style',
  titleKey: 'editor.inspector.styleTitle',
  defaultTitle: 'Style',
  order: 20,
  appliesTo: ({ selectionCount }) => selectionCount >= 1,
  fields: [
    {
      id: 'fill',
      labelKey: 'editor.inspector.fill',
      defaultLabel: 'Fill',
      control: 'color',
      allowGradient: true,
      read: (ctx) => mixedIf(ctx.entries.map((entry) => paintToFill(entry.paint))) as FieldValue,
      write: async (value, ctx) => {
        // The wire accepts gradient objects beyond the scalar FieldValue union.
        const fill = value as unknown as FillValue;
        if (typeof fill === 'string') {
          if (fill.trim() === '') {
            return { status: 'validationError', message: 'Fill must be a color string' };
          }
          return runWriteOp(ctx, 'setStyle', [
            { op: 'setStyle', ids: [...ctx.selection], patch: { background: fill } },
          ]);
        }
        if (!isGradientFill(fill)) {
          return { status: 'validationError', message: 'Fill must be a color or gradient' };
        }
        return runWriteOp(ctx, 'setStyle', [
          { op: 'setStyle', ids: [...ctx.selection], patch: { background: fillToPatch(fill) } },
        ]);
      },
    },
    {
      id: 'stroke',
      labelKey: 'editor.inspector.strokeColor',
      defaultLabel: 'Stroke',
      control: 'color',
      read: (ctx) => mixedIf(ctx.entries.map((entry) => entry.strokeColor)),
      write: async (value, ctx) => {
        if (typeof value !== 'string' || value.trim() === '') {
          return { status: 'validationError', message: 'Stroke must be a color string' };
        }
        return runWriteOp(ctx, 'setStyle', [
          { op: 'setStyle', ids: [...ctx.selection], patch: { strokeColor: value } },
        ]);
      },
    },
    {
      id: 'border',
      labelKey: 'editor.inspector.borderColor',
      defaultLabel: 'Border',
      control: 'color',
      read: (ctx) =>
        mixedIf(
          ctx.entries.map((entry) =>
            entry.detail.type === 'text' ? (entry.detail.borderColor ?? 'transparent') : MIXED,
          ),
        ) as FieldValue,
      write: async (value, ctx) => {
        if (typeof value !== 'string' || value.trim() === '') {
          return { status: 'validationError', message: 'Border must be a color string' };
        }
        return runWriteOp(ctx, 'setStyle', [
          { op: 'setStyle', ids: [...ctx.selection], patch: { borderColor: value } },
        ]);
      },
      visible: (ctx) => ctx.entries.some((entry) => entry.kind === 'text'),
    },
    numberField(
      'strokeWidth',
      'editor.inspector.strokeWidth',
      'Stroke width',
      (ctx) => mixedIf(ctx.entries.map((entry) => entry.strokeWidth)),
      async (value, ctx) =>
        runWriteOp(ctx, 'setStyle', [
          { op: 'setStyle', ids: [...ctx.selection], patch: { strokeWidth: value } },
        ]),
      { min: 0, step: 1 },
    ),
    {
      id: 'strokeStyle',
      labelKey: 'editor.inspector.strokeStyle',
      defaultLabel: 'Dash',
      control: 'segmented',
      options: [
        { value: 'solid', labelKey: 'editor.inspector.dashSolid', defaultLabel: 'Solid' },
        { value: 'dashed', labelKey: 'editor.inspector.dashDashed', defaultLabel: 'Dashed' },
        { value: 'dotted', labelKey: 'editor.inspector.dashDotted', defaultLabel: 'Dotted' },
      ],
      read: (ctx) => mixedIf(ctx.entries.map((entry) => entry.strokeStyle)),
      write: async (value, ctx) => {
        if (value !== 'solid' && value !== 'dashed' && value !== 'dotted') {
          return { status: 'validationError', message: 'Unknown dash style' };
        }
        return runWriteOp(ctx, 'setStyle', [
          { op: 'setStyle', ids: [...ctx.selection], patch: { strokeStyle: value } },
        ]);
      },
    },
    {
      // Number plumbing is shared; only the control template differs.
      ...numberField(
        'opacity',
        'editor.inspector.opacity',
        'Opacity',
        (ctx) => mixedIf(ctx.entries.map((entry) => entry.opacity)),
        async (value, ctx) =>
          runWriteOp(ctx, 'setStyle', [
            { op: 'setStyle', ids: [...ctx.selection], patch: { opacity: value } },
          ]),
        { min: 0, max: 100, step: 1, presets: [0, 25, 50, 75, 100] },
      ),
      control: 'opacity',
    },
  ],
};

/** Text section: read-only (no direct write op; edits go through the overlay session). */
const textSection: InspectorSectionDefinition = {
  id: 'text',
  titleKey: 'editor.inspector.textTitle',
  defaultTitle: 'Text',
  order: 30,
  appliesTo: ({ selectionCount, kinds }) => selectionCount === 1 && kinds.has('text'),
  fields: [
    {
      id: 'content',
      labelKey: 'editor.inspector.content',
      defaultLabel: 'Content',
      control: 'readonly',
      read: (ctx) => {
        const detail = ctx.entries[0]?.detail;
        if (detail?.type === 'text') return detail.text;
        return MIXED;
      },
      write: async () => ({ status: 'notApplicable', reason: 'read-only' }),
    },
    {
      id: 'fontSize',
      labelKey: 'editor.inspector.fontSize',
      defaultLabel: 'Font size',
      control: 'readonly',
      read: (ctx) => {
        const detail = ctx.entries[0]?.detail;
        if (detail?.type === 'text') return detail.fontSize;
        return MIXED;
      },
      write: async () => ({ status: 'notApplicable', reason: 'read-only' }),
    },
    {
      id: 'fontFamily',
      labelKey: 'editor.inspector.fontFamily',
      defaultLabel: 'Font',
      control: 'readonly',
      read: (ctx) => {
        const detail = ctx.entries[0]?.detail;
        if (detail?.type === 'text') return detail.fontFamily;
        return MIXED;
      },
      write: async () => ({ status: 'notApplicable', reason: 'read-only' }),
    },
  ],
};

/** Arrange section: alignment/distribution entry points (commands own execution). */
const arrangeSection: InspectorSectionDefinition = {
  id: 'arrange',
  titleKey: 'editor.inspector.arrangeTitle',
  defaultTitle: 'Arrange',
  order: 40,
  appliesTo: ({ selectionCount }) => selectionCount >= 2,
  fields: [
    {
      id: 'align',
      labelKey: 'editor.inspector.align',
      defaultLabel: 'Align',
      control: 'alignment',
      read: () => MIXED,
      write: async () => ({ status: 'notApplicable', reason: 'command-buttons' }),
    },
  ],
};

const metadataSection: InspectorSectionDefinition = {
  id: 'metadata',
  titleKey: 'editor.inspector.detailsTitle',
  defaultTitle: 'Details',
  order: 50,
  appliesTo: ({ selectionCount }) => selectionCount === 1,
  fields: [
    {
      id: 'kind',
      labelKey: 'editor.inspector.kind',
      defaultLabel: 'Type',
      control: 'readonly',
      read: (ctx) => ctx.entries[0]?.kind ?? MIXED,
      write: async () => ({ status: 'notApplicable', reason: 'read-only' }),
    },
    {
      id: 'id',
      labelKey: 'editor.inspector.id',
      defaultLabel: 'ID',
      control: 'readonly',
      read: (ctx) => ctx.entries[0]?.id ?? MIXED,
      write: async () => ({ status: 'notApplicable', reason: 'read-only' }),
    },
  ],
};

const SECTIONS: readonly InspectorSectionDefinition[] = [
  transformSection,
  styleSection,
  textSection,
  arrangeSection,
  metadataSection,
];

function validateSections(sections: readonly InspectorSectionDefinition[]): void {
  const ids = new Set<string>();
  const orders = new Set<number>();
  const problems: string[] = [];
  for (const section of sections) {
    if (section.id === '' || ids.has(section.id)) {
      problems.push(`duplicate or empty section id "${section.id}"`);
    }
    ids.add(section.id);
    if (orders.has(section.order)) {
      problems.push(`duplicate section order "${section.order}" for id "${section.id}"`);
    }
    orders.add(section.order);
    const fieldIds = new Set<string>();
    for (const field of section.fields) {
      if (field.id === '' || fieldIds.has(field.id)) {
        problems.push(`duplicate or empty field id "${field.id}" in section "${section.id}"`);
      }
      fieldIds.add(field.id);
    }
  }
  if (problems.length > 0) {
    throw new Error(`inspector registry is invalid: ${problems.join('; ')}`);
  }
}

validateSections(SECTIONS);

/** Sections applicable to the current selection (ordered; no per-kind branching in renderers). */
export function inspectorSectionsFor(selectionCount: number, kinds: ReadonlySet<string>) {
  return SECTIONS.filter((section) => section.appliesTo({ selectionCount, kinds })).sort(
    (a, b) => a.order - b.order,
  );
}

export function allInspectorSections(): readonly InspectorSectionDefinition[] {
  return SECTIONS;
}
