// Central context-key service for `when`-clause gating.
//
// Every menu row, keybinding, palette entry, and toolbar tool declares an
// optional `when` clause evaluated against these keys. The shell writes keys,
// extensions read them and may set their own `extension.*` entries.

/** Built-in context keys the shell keeps current. */
export const BUILTIN_CONTEXT_KEYS = [
  'grafalith.context.screen',
  'grafalith.context.editorType',
  'grafalith.context.hasActiveProject',
  'grafalith.context.selectedCount',
  'grafalith.context.activeTool',
  'grafalith.context.layerSelected',
] as const;

export type BuiltinContextKey = (typeof BUILTIN_CONTEXT_KEYS)[number];

export type ContextValue = string | boolean | number;

/** Screen the user is on (Home vs editor). */
export type ContextScreen = 'home' | 'editor';

/** Editor kind when `screen` is `editor`. */
export type ContextEditorType = 'design' | 'whiteboard' | 'diagram' | 'none';

/**
 * Window-shared context-key store. One instance per window; no globals.
 * Values are JSON-safe primitives so they serialize for diagnostics.
 */
export class ContextKeyService {
  private readonly values = new Map<string, ContextValue>();
  private readonly listeners = new Set<(key: string) => void>();

  constructor(initial?: Readonly<Record<string, ContextValue>>) {
    this.values.set('grafalith.context.screen', 'home');
    this.values.set('grafalith.context.editorType', 'none');
    this.values.set('grafalith.context.hasActiveProject', false);
    this.values.set('grafalith.context.selectedCount', 0);
    this.values.set('grafalith.context.activeTool', 'select');
    this.values.set('grafalith.context.layerSelected', false);
    if (initial) {
      for (const [key, value] of Object.entries(initial)) this.values.set(key, value);
    }
  }

  /** Read one key, falling back when absent. */
  get<T>(key: string, fallback: T): T {
    return (this.values.has(key) ? this.values.get(key) : fallback) as T;
  }

  /** Write one key and notify subscribers. */
  set(key: string, value: ContextValue): void {
    this.values.set(key, value);
    for (const listener of [...this.listeners]) listener(key);
  }

  /** Subscribe to any key change. */
  onDidChange(listener: (key: string) => void): { dispose(): void } {
    this.listeners.add(listener);
    return { dispose: () => void this.listeners.delete(listener) };
  }

  /** Snapshot every key (palette gating, diagnostics). */
  snapshot(): Readonly<Record<string, ContextValue>> {
    return Object.fromEntries(this.values);
  }

  /** Sync editor-derived keys in one call (selection, tool, screen). */
  syncEditorState(input: {
    screen: ContextScreen;
    editorType: ContextEditorType;
    hasActiveProject: boolean;
    selectedCount: number;
    activeTool: string;
    layerSelected: boolean;
  }): void {
    this.set('grafalith.context.screen', input.screen);
    this.set('grafalith.context.editorType', input.editorType);
    this.set('grafalith.context.hasActiveProject', input.hasActiveProject);
    this.set('grafalith.context.selectedCount', input.selectedCount);
    this.set('grafalith.context.activeTool', input.activeTool);
    this.set('grafalith.context.layerSelected', input.layerSelected);
  }
}

/**
 * Evaluate a VSCode-style `when` clause. Supports `key`, `!key`,
 * `key == value`, `key != value`, `&&`, `||`. Empty clauses pass.
 */
export function evaluateWhen(
  when: string | undefined,
  values: Readonly<Record<string, ContextValue | undefined>>,
): boolean {
  const clause = (when ?? '').trim();
  if (clause === '') return true;
  return clause
    .split('||')
    .map((part) => part.trim())
    .some((orPart) =>
      orPart
        .split('&&')
        .map((part) => part.trim())
        .filter((part) => part !== '')
        .every((atom) => evaluateAtom(atom, values)),
    );
}

function evaluateAtom(atom: string, values: Readonly<Record<string, ContextValue | undefined>>): boolean {
  const negation = /^!\s*([\w.]+)$/.exec(atom);
  if (negation) return !truthy(values[negation[1]]);
  const comparison = /^([\w.]+)\s*(==|!=)\s*(.+)$/.exec(atom);
  if (comparison) {
    const [, key, operator, raw] = comparison;
    const same = values[key] === parseLiteral(raw.trim());
    return operator === '==' ? same : !same;
  }
  return truthy(values[atom]);
}

function truthy(value: ContextValue | undefined): boolean {
  if (value === undefined) return false;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return value !== '' && value !== 'false';
}

function parseLiteral(raw: string): ContextValue {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  const numeric = Number(raw);
  if (raw !== '' && Number.isFinite(numeric)) return numeric;
  return raw.replace(/^['"]|['"]$/g, '');
}

let sharedContext: ContextKeyService | null = null;

/** Window-shared context keys (one store per window). */
export function getContextKeys(): ContextKeyService {
  if (!sharedContext) sharedContext = new ContextKeyService();
  return sharedContext;
}

/** Drop the shared store (tests and full teardown). */
export function resetContextKeys(): void {
  sharedContext = null;
}
