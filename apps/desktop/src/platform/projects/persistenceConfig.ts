/** Centralized persistence tuning; components read these instead of literals. */
export const persistenceConfig = {
  /** Debounce between the last engine change and the next autosave. */
  autosaveDelayMs: 2000,
  /** Smallest autosave debounce users may configure in settings. */
  autosaveDelayMinMs: 250,
  /** Largest autosave debounce users may configure in settings. */
  autosaveDelayMaxMs: 30000,
  /** Autosave runs unless the user disables it in settings. */
  autosaveEnabled: true,
  /** How often the engine nonce is polled for dirty detection. */
  dirtyPollIntervalMs: 500,
  /** Display-name ceiling shared with the storage backend rule. */
  maxNameLength: 50,
  /** Trash entries are permanently removed after this many days. */
  trashRetentionDays: 30,
  trashRetentionMs: 30 * 24 * 60 * 60 * 1000,
  trashPurgeIntervalMs: 60 * 60 * 1000,
} as const;
