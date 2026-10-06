import { detectEnvelopeVersion } from './documentEnvelope';

/**
 * Ephemeral recovery state: unsaved work kept outside the project file so
 * a crash or failed save never silently loses in-memory edits.
 *
 * Separate from the project index (metadata), the document payload, and
 * user preferences. Snapshots live in `localStorage` under a per-project
 * key, are cleared on successful save/close, and are only ever restored
 * after an explicit user choice — never auto-overwritten into the project.
 */

export interface RecoverySnapshot {
  projectId: string;
  sceneJson: string;
  savedAtMs: number;
  schemaVersion: number;
  reason: 'dirty' | 'save-failed';
}

const recoveryKey = (projectId: string): string => `opennary:projects:recovery:${projectId}`;

function isSnapshot(value: unknown): value is RecoverySnapshot {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.projectId === 'string' &&
    typeof record.sceneJson === 'string' &&
    typeof record.savedAtMs === 'number' &&
    typeof record.schemaVersion === 'number'
  );
}

/** Reads the pending recovery snapshot for a project, if any is usable. */
export function loadRecoverySnapshot(projectId: string): RecoverySnapshot | null {
  try {
    const raw = window.localStorage.getItem(recoveryKey(projectId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isSnapshot(parsed) || parsed.projectId !== projectId) return null;
    // Drop snapshots whose envelope no longer parses — restoring garbage
    // is worse than reporting no recovery available.
    try {
      detectEnvelopeVersion(parsed.sceneJson);
    } catch {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Stages unsaved work for later recovery; never touches the project file. */
export function saveRecoverySnapshot(snapshot: RecoverySnapshot): void {
  try {
    window.localStorage.setItem(recoveryKey(snapshot.projectId), JSON.stringify(snapshot));
  } catch {
    // Storage full or unavailable: recovery stays in memory only.
  }
}

/** Clears recovery after a successful save, restore, or explicit discard. */
export function clearRecoverySnapshot(projectId: string): void {
  try {
    window.localStorage.removeItem(recoveryKey(projectId));
  } catch {
    // Best-effort cleanup only.
  }
}

/** Whether a restorable snapshot is staged for this project. */
export function hasRecoverySnapshot(projectId: string): boolean {
  return loadRecoverySnapshot(projectId) !== null;
}
