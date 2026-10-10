import type { Disposable } from "./commands.js";

/**
 * Central context-key service (`grafalith.context.*`).
 *
 * Extensions read keys, the host writes them, and `when` clauses gate menu,
 * keybinding, palette, and toolbar visibility. Keys are namespaced
 * `grafalith.context.*` (see `BUILTIN_CONTEXT_KEYS`); extensions may set
 * their own `extension.<publisher>.<id>.<key>` entries.
 */
export class ContextKeyService {
  private readonly values = new Map<string, string | boolean | number>();
  private readonly listeners = new Set<(key: string) => void>();

  /** Read one key, falling back when absent. */
  get<T>(key: string, fallback: T): T {
    return (this.values.has(key) ? this.values.get(key) : fallback) as T;
  }

  /** Write one key and notify subscribers. */
  set(key: string, value: string | boolean | number): void {
    this.values.set(key, value);
    for (const listener of [...this.listeners]) listener(key);
  }

  /** Subscribe to any key change; returns a disposable. */
  onDidChange(listener: (key: string) => void): Disposable {
    this.listeners.add(listener);
    return { dispose: () => void this.listeners.delete(listener) };
  }

  /** Snapshot every key (tests and palette gating). */
  snapshot(): Readonly<Record<string, string | boolean | number>> {
    return Object.fromEntries(this.values);
  }
}

/** Built-in context keys the host keeps current. */
export const BUILTIN_CONTEXT_KEYS = [
  "grafalith.context.screen",
  "grafalith.context.editorType",
  "grafalith.context.hasActiveProject",
  "grafalith.context.selectedCount",
  "grafalith.context.activeTool",
  "grafalith.context.layerSelected",
] as const;

export type BuiltinContextKey = (typeof BUILTIN_CONTEXT_KEYS)[number];

/**
 * Evaluate a VSCode-style `when` clause against context values.
 * Supports `key`, `!key`, `key == value`, `key != value`, `&&`, `||`.
 * Unknown keys read as undefined (clause fails closed for `==`, passes
 * for `!=` only when the key exists with a different value).
 */
export function evaluateWhen(
  when: string | undefined,
  values: Readonly<Record<string, string | boolean | number | undefined>>,
): boolean {
  const clause = (when ?? "").trim();
  if (clause === "") return true;
  const orParts = clause.split("||").map((part) => part.trim());
  return orParts.some((orPart) =>
    orPart
      .split("&&")
      .map((part) => part.trim())
      .filter((part) => part !== "")
      .every((atom) => evaluateAtom(atom, values)),
  );
}

function evaluateAtom(
  atom: string,
  values: Readonly<Record<string, string | boolean | number | undefined>>,
): boolean {
  const notMatch = /^!\s*([\w.]+)$/.exec(atom);
  if (notMatch) return !truthy(values[notMatch[1]]);
  const equals = /^([\w.]+)\s*(==|!=)\s*(.+)$/.exec(atom);
  if (equals) {
    const [, key, operator, raw] = equals;
    const actual = values[key];
    const expected = parseLiteral(raw.trim());
    const same = actual === expected;
    return operator === "==" ? same : !same;
  }
  return truthy(values[atom]);
}

function truthy(value: string | boolean | number | undefined): boolean {
  if (value === undefined) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  return value !== "" && value !== "false";
}

function parseLiteral(raw: string): string | boolean | number {
  if (raw === "true") return true;
  if (raw === "false") return false;
  const numeric = Number(raw);
  if (raw !== "" && Number.isFinite(numeric)) return numeric;
  return raw.replace(/^['"]|['"]$/g, "");
}
