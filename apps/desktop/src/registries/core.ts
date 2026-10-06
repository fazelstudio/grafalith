/**
 * Shared registry construction for descriptor-driven UI.
 *
 * A registry turns a static descriptor list into validated lookup data so
 * renderers stay generic (they iterate descriptors instead of branching on
 * ids) while every definition is checked once at module load.
 */

/** Contract every registered descriptor satisfies. */
export interface Descriptor {
  /** Stable identifier: lookup key, React key, and engine id where applicable. */
  id: string;
  /** Localization key; locale resources resolve it once they exist. */
  labelKey: string;
  /** English text rendered until `labelKey` resolves in a locale. */
  defaultLabel: string;
}

/** Read-only lookup view over a validated descriptor list. */
export interface Registry<T extends Descriptor> {
  /** All descriptors in registration order, which is the display order. */
  all(): readonly T[];
  /** Descriptor for `id`, or `undefined` when the id is not registered. */
  get(id: string): T | undefined;
}

/** Extra validation hooks for one registry. */
export interface RegistryOptions<T extends Descriptor> {
  /** Per-descriptor checks; return a message to reject the item. */
  validateItem?: (item: T) => string | undefined;
  /** Cross-descriptor checks; return one message per problem found. */
  validateAll?: (items: readonly T[]) => readonly string[];
}

const LABEL_KEY_PATTERN = /^[a-z][a-z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/;

/**
 * Build a registry from descriptors.
 *
 * Rejects descriptors with an empty or duplicate `id`, a malformed
 * `labelKey`, or an empty `defaultLabel`, plus any problem reported by the
 * options. Registry data is static, so an invalid entry is a programming
 * error and must fail fast instead of rendering wrong UI.
 *
 * @param kind - Registry name used in error messages, such as `"command"`.
 * @param items - Descriptors in the order they should render.
 * @param options - Additional validation for this registry.
 * @throws Error when any descriptor or cross-descriptor check fails.
 */
export function createRegistry<T extends Descriptor>(
  kind: string,
  items: readonly T[],
  options: RegistryOptions<T> = {},
): Registry<T> {
  const seen = new Set<string>();
  const problems: string[] = [];
  for (const item of items) {
    if (item.id === '') {
      problems.push('descriptor with empty id');
    } else if (seen.has(item.id)) {
      problems.push(`duplicate id "${item.id}"`);
    }
    seen.add(item.id);
    if (!LABEL_KEY_PATTERN.test(item.labelKey)) {
      problems.push(`invalid labelKey "${item.labelKey}" for id "${item.id}"`);
    }
    if (item.defaultLabel === '') {
      problems.push(`empty defaultLabel for id "${item.id}"`);
    }
    const issue = options.validateItem?.(item);
    if (issue) problems.push(issue);
  }
  problems.push(...(options.validateAll?.(items) ?? []));
  if (problems.length > 0) {
    throw new Error(`${kind} registry is invalid: ${problems.join('; ')}`);
  }
  const byId = new Map(items.map((item) => [item.id, item]));
  return {
    all: () => items,
    get: (id) => byId.get(id),
  };
}
