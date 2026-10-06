/** Centralized persistence tuning; components read these instead of literals. */
export const persistenceConfig = {
  /** Debounce between the last engine change and the next project save. */
  autosaveDelayMs: 1500,
  /** How often the engine nonce is polled for dirty detection. */
  dirtyPollIntervalMs: 500,
  /** Debounce between the last engine change and the recovery snapshot. */
  recoveryDelayMs: 1000,
  /** Recovery snapshots stay enabled; disable only for isolated tests. */
  recoveryEnabled: true,
  /** Display-name ceiling shared with the storage backend rule. */
  maxNameLength: 50,
  /** Trash entries are permanently removed after this many days. */
  trashRetentionDays: 30,
  trashRetentionMs: 30 * 24 * 60 * 60 * 1000,
  trashPurgeIntervalMs: 60 * 60 * 1000,
} as const;
