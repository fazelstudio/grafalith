import { useCallback, useEffect, useRef, useState } from 'react';
import type { Engine } from '../../hooks/useEngine';
import { persistenceConfig } from '../../platform/projects/persistenceConfig';
import { preferenceService } from '../../platform/preferences/preferenceService';
import { getProjectStore } from '../../platform/projects/projectService';

/**
 * Explicit save states; no boolean trio stands in for these.
 */
export type SaveState =
  | { kind: 'saved' }
  | { kind: 'dirty' }
  | { kind: 'saving' }
  | { kind: 'save-failed' };

/**
 * Debounced project persistence with manual save.
 *
 * Dirty tracking derives from the engine `sceneNonce`: the poll loop
 * observes the nonce and only schedules work when it actually changes, so
 * high-frequency pointer updates coalesce into one debounced autosave —
 * never a write per pointer event. Manual saves through `saveNow` (File >
 * Save or Ctrl+S) run immediately. Autosave itself follows the user
 * preference (Settings > Editor): when disabled, only manual saves write.
 * Save failures keep in-memory edits intact and report a retryable state.
 */
export function useProjectPersistence(
  engine: Engine,
  projectId: string,
  active: boolean,
): {
  saveState: SaveState;
  saveNow: () => void;
  flushForClose: () => Promise<boolean>;
} {
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'saved' });
  const nonceRef = useRef<number | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  const stateRef = useRef<SaveState>({ kind: 'saved' });
  stateRef.current = saveState;

  const clearSaveTimer = useCallback(() => {
    if (saveTimerRef.current !== null) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
  }, []);

  const doSave = useCallback(async (): Promise<boolean> => {
    if (savingRef.current || !active) return false;
    savingRef.current = true;
    clearSaveTimer();
    setSaveState({ kind: 'saving' });
    try {
      const sceneJson = await engine.exportScene();
      await getProjectStore().save(projectId, sceneJson);
      try {
        const status = await engine.getStatus();
        nonceRef.current = status.sceneNonce;
      } catch {
        // Baseline refresh is best-effort; the save already succeeded.
      }
      setSaveState({ kind: 'saved' });
      return true;
    } catch {
      // In-memory edits stay untouched so the user can retry the save.
      setSaveState({ kind: 'save-failed' });
      return false;
    } finally {
      savingRef.current = false;
    }
  }, [active, clearSaveTimer, engine, projectId]);

  const saveNow = useCallback(() => {
    void doSave();
  }, [doSave]);

  /** Close lifecycle helper: finishes a pending save so close can decide. */
  const flushForClose = useCallback(async (): Promise<boolean> => {
    const current = stateRef.current;
    if (current.kind === 'saved') return true;
    if (current.kind === 'saving') {
      // A save is in flight; wait for it to settle instead of racing it.
      for (let i = 0; i < 40 && savingRef.current; i++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return stateRef.current.kind === 'saved';
    }
    return doSave();
  }, [doSave]);

  // Reset per-document baselines when switching projects.
  useEffect(() => {
    nonceRef.current = null;
    setSaveState({ kind: 'saved' });
    clearSaveTimer();
  }, [clearSaveTimer, projectId]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const interval = setInterval(async () => {
      if (cancelled || savingRef.current) return;
      try {
        const status = await engine.getStatus();
        if (cancelled || savingRef.current) return;
        if (nonceRef.current === null) {
          nonceRef.current = status.sceneNonce;
          return;
        }
        if (status.sceneNonce !== nonceRef.current) {
          nonceRef.current = status.sceneNonce;
          if (stateRef.current.kind !== 'saving') {
            setSaveState({ kind: 'dirty' });
          }
          clearSaveTimer();
          if (!preferenceService.getAutosaveEnabled()) return;
          const delayMs = preferenceService.getAutosaveDelayMs();
          saveTimerRef.current = setTimeout(() => {
            void doSave();
          }, delayMs);
        }
      } catch {
        // Transport hiccup: keep the last state, retry on the next tick.
      }
    }, persistenceConfig.dirtyPollIntervalMs);
    return () => {
      cancelled = true;
      clearInterval(interval);
      clearSaveTimer();
    };
  }, [active, clearSaveTimer, doSave, engine]);

  return { saveState, saveNow, flushForClose };
}
