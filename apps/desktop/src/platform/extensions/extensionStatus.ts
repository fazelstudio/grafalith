// Extension status machine: one visible state per installed extension.
//
// Every extension moves DISCOVERED -> VALIDATING -> VALID -> LOADING ->
// ACTIVE, with failure states for each phase. Statuses persist in
// localStorage so a known-bad extension is skipped on the next startup
// without re-toasting, and the Extension Manager renders them directly.
export type ExtensionStatus =
  | 'DISCOVERED'
  | 'VALIDATING'
  | 'VALID'
  | 'LOADING'
  | 'ACTIVE'
  | 'INVALID_MANIFEST'
  | 'INCOMPATIBLE_VERSION'
  | 'MISSING_DEPENDENCY'
  | 'CIRCULAR_DEPENDENCY'
  | 'LOAD_FAILED'
  | 'INVALID_ENTRY'
  | 'ACTIVATION_FAILED'
  | 'ACTIVATION_TIMEOUT'
  | 'DISABLED'
  | 'DEACTIVATED';

/** Failure states that skip activation on the next startup. */
const FAILURE_STATES: ReadonlySet<ExtensionStatus> = new Set([
  'INVALID_MANIFEST',
  'INCOMPATIBLE_VERSION',
  'MISSING_DEPENDENCY',
  'CIRCULAR_DEPENDENCY',
  'LOAD_FAILED',
  'INVALID_ENTRY',
  'ACTIVATION_FAILED',
  'ACTIVATION_TIMEOUT',
]);

/** Whether a status means the extension failed and stays skipped. */
export function isFailureStatus(status: ExtensionStatus): boolean {
  return FAILURE_STATES.has(status);
}

/** Whether a status means the extension is currently running. */
export function isActiveStatus(status: ExtensionStatus): boolean {
  return status === 'ACTIVE';
}

const STORAGE_KEY = 'grafalith.extension.status.v1';
const REASON_KEY = 'grafalith.extension.statusReason.v1';

function readMap(key: string): Map<string, string> {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as Record<string, string>;
    return new Map(Object.entries(parsed));
  } catch {
    return new Map();
  }
}

function writeMap(key: string, values: ReadonlyMap<string, string>): void {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(Object.fromEntries(values)));
  } catch {
    // Storage full or blocked: in-memory state above still applies.
  }
}

/**
 * Persistent status store: one instance per window, no globals.
 * Memory is authoritative; localStorage keeps failure/disabled states
 * consistent across restarts.
 */
export class ExtensionStatusStore {
  private readonly statuses = new Map<string, ExtensionStatus>();
  private readonly reasons = new Map<string, string>();
  private readonly listeners = new Set<(packageId: string, status: ExtensionStatus) => void>();

  constructor() {
    for (const [packageId, status] of readMap(STORAGE_KEY)) {
      this.statuses.set(packageId, status as ExtensionStatus);
    }
    for (const [packageId, reason] of readMap(REASON_KEY)) {
      this.reasons.set(packageId, reason);
    }
  }

  /** Current status, defaulting to DISCOVERED for unseen extensions. */
  get(packageId: string): ExtensionStatus {
    return this.statuses.get(packageId) ?? 'DISCOVERED';
  }

  /** Human-readable reason for the current status (failure detail). */
  reason(packageId: string): string | undefined {
    return this.reasons.get(packageId);
  }

  /** Every tracked extension id. */
  ids(): string[] {
    return [...this.statuses.keys()];
  }

  /** Set a status, persist failures/disabled states, and notify listeners. */
  set(packageId: string, status: ExtensionStatus, reason?: string): void {
    this.statuses.set(packageId, status);
    if (reason !== undefined) this.reasons.set(packageId, reason);
    else if (!isFailureStatus(status)) this.reasons.delete(packageId);
    const persistable = new Map<string, string>();
    const persistableReasons = new Map<string, string>();
    for (const [id, value] of this.statuses) {
      if (isFailureStatus(value) || value === 'DISABLED' || value === 'DEACTIVATED') {
        persistable.set(id, value);
        const failureReason = this.reasons.get(id);
        if (failureReason) persistableReasons.set(id, failureReason);
      }
    }
    writeMap(STORAGE_KEY, persistable);
    writeMap(REASON_KEY, persistableReasons);
    for (const listener of [...this.listeners]) listener(packageId, status);
  }

  /** Whether a user-disabled extension must stay skipped until re-enabled. */
  isDisabled(packageId: string): boolean {
    return this.get(packageId) === 'DISABLED';
  }

  /** Subscribe to status changes; returns a disposable. */
  onDidChange(listener: (packageId: string, status: ExtensionStatus) => void): { dispose(): void } {
    this.listeners.add(listener);
    return { dispose: () => void this.listeners.delete(listener) };
  }

  /** Drop all state (tests and full teardown). */
  reset(): void {
    this.statuses.clear();
    this.reasons.clear();
    try {
      globalThis.localStorage?.removeItem(STORAGE_KEY);
      globalThis.localStorage?.removeItem(REASON_KEY);
    } catch {
      // Ignored: memory above is already cleared.
    }
  }
}

let sharedStore: ExtensionStatusStore | null = null;

/** Window-shared status store (one per window). */
export function getExtensionStatuses(): ExtensionStatusStore {
  if (!sharedStore) sharedStore = new ExtensionStatusStore();
  return sharedStore;
}

/** Drop the shared store (tests and full teardown). */
export function resetExtensionStatuses(): void {
  sharedStore?.reset();
  sharedStore = null;
}
