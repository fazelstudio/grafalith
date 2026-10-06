import { useCallback, useEffect, useRef, useState } from 'react';
import type { Engine } from '../../hooks/useEngine';
import { detectEnvelopeVersion } from '../../platform/projects/documentEnvelope';
import { persistenceConfig } from '../../platform/projects/persistenceConfig';
import { getProjectStore } from '../../platform/projects/projectService';
import {
  clearRecoverySnapshot,
  loadRecoverySnapshot,
  saveRecoverySnapshot,
  type RecoverySnapshot,
} from '../../platform/projects/recovery';

/**
 * Explicit save states; no boolean trio stands in for these. `recovering`
 * covers the restore-from-snapshot flow so the status line never claims
 * `saved` while a recovery import is in flight.
 */
export type SaveState =
  | { kind: 'saved' }
  | { kind: 'dirty' }
  | { kind: 'saving' }
  | { kind: 'save-failed' }
  | { kind: 'recovering' };

/**
 * Debounced project persistence with crash recovery.
 *
 * Dirty tracking derives from the engine `sceneNonce`: the poll loop
 * observes the nonce and only schedules work when it actually changes, so
 * high-frequency pointer updates coalesce into one debounced save — never
 * a write per pointer event. Save failures keep in-memory edits intact,
 * stage a recovery snapshot, and report a retryable state.
 */
export function useProjectPersistence(
  engine: Engine,
  projectId: string,
  active: boolean,
): {
  saveState: SaveState;
  saveNow: () => void;
  flushForClose: () => Promise<boolean>;
  recovery: RecoverySnapshot | null;
  restoreRecovery: () => Promise<boolean>;
  discardRecovery: () => void;
} {
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'saved' });
  const [recovery, setRecovery] = useState<RecoverySnapshot | null>(null);
  const nonceRef = useRef<number | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  const stateRef = useRef<SaveState>({ kind: 'saved' });
  stateRef.current = saveState;

  const clearTimers = useCallback(() => {
    if (saveTimerRef.current !== null) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (recoveryTimerRef.current !== null) {
      clearTimeout(recoveryTimerRef.current);
      recoveryTimerRef.current = null;
    }
  }, []);

  const refreshRecovery = useCallback(() => {
    if (!persistenceConfig.recoveryEnabled) {
      setRecovery(null);
      return;
    }
    setRecovery(loadRecoverySnapshot(projectId));
  }, [projectId]);

  const stageRecovery = useCallback(
    async (reason: RecoverySnapshot['reason']) => {
      if (!persistenceConfig.recoveryEnabled || !active) return;
      try {
        const sceneJson = await engine.exportScene();
        const schemaVersion = detectEnvelopeVersion(sceneJson);
        saveRecoverySnapshot({
          projectId,
          sceneJson,
          savedAtMs: Date.now(),
          schemaVersion,
          reason,
        });
        setRecovery(loadRecoverySnapshot(projectId));
      } catch {
        // Recovery is best-effort; the project save path reports errors.
      }
    },
    [active, engine, projectId],
  );

  const doSave = useCallback(async (): Promise<boolean> => {
    if (savingRef.current || !active) return false;
    savingRef.current = true;
    if (saveTimerRef.current !== null) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
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
      clearRecoverySnapshot(projectId);
      setRecovery(null);
      setSaveState({ kind: 'saved' });
      return true;
    } catch {
      // In-memory edits stay untouched; stage recovery so a reload can
      // offer the unsaved work back instead of losing it.
      try {
        const sceneJson = await engine.exportScene();
        const schemaVersion = detectEnvelopeVersion(sceneJson);
        saveRecoverySnapshot({
          projectId,
          sceneJson,
          savedAtMs: Date.now(),
          schemaVersion,
          reason: 'save-failed',
        });
        setRecovery(loadRecoverySnapshot(projectId));
      } catch {
        // Snapshot is opportunistic; the failed state is still reported.
      }
      setSaveState({ kind: 'save-failed' });
      return false;
    } finally {
      savingRef.current = false;
    }
  }, [active, engine, projectId]);

  const saveNow = useCallback(() => {
    void doSave();
  }, [doSave]);

  /** Close lifecycle helper: finishes a pending save so close can decide. */
  const flushForClose = useCallback(async (): Promise<boolean> => {
    const current = stateRef.current;
    if (current.kind === 'saved') return true;
    if (current.kind === 'recovering' || current.kind === 'saving') {
      // A save is in flight; wait for it to settle instead of racing it.
      for (let i = 0; i < 40 && savingRef.current; i++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return stateRef.current.kind === 'saved';
    }
    return doSave();
  }, [doSave]);

  const restoreRecovery = useCallback(async (): Promise<boolean> => {
    const snapshot = loadRecoverySnapshot(projectId);
    if (!snapshot) return false;
    setSaveState({ kind: 'recovering' });
    try {
      const raw = await engine.importScene(snapshot.sceneJson, true);
      let failed = false;
      try {
        const parsed: unknown = JSON.parse(raw);
        failed =
          typeof parsed === 'object' &&
          parsed !== null &&
          (parsed as Record<string, unknown>).ok === false;
      } catch {
        failed = true;
      }
      if (failed) {
        setSaveState({ kind: 'save-failed' });
        return false;
      }
      clearRecoverySnapshot(projectId);
      setRecovery(null);
      try {
        const status = await engine.getStatus();
        nonceRef.current = status.sceneNonce;
      } catch {
        nonceRef.current = null;
      }
      // Restored content is not yet persisted — mark dirty so autosave
      // (and the close flow) treat it as unsaved work.
      setSaveState({ kind: 'dirty' });
      return true;
    } catch {
      setSaveState({ kind: 'save-failed' });
      return false;
    }
  }, [engine, projectId]);

  const discardRecovery = useCallback(() => {
    clearRecoverySnapshot(projectId);
    setRecovery(null);
  }, [projectId]);

  useEffect(() => {
    refreshRecovery();
  }, [refreshRecovery, projectId]);

  // Reset per-document baselines when switching projects.
  useEffect(() => {
    nonceRef.current = null;
    setSaveState({ kind: 'saved' });
    setRecovery(loadRecoverySnapshot(projectId));
    clearTimers();
  }, [clearTimers, projectId]);

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
          if (stateRef.current.kind !== 'saving' && stateRef.current.kind !== 'recovering') {
            setSaveState({ kind: 'dirty' });
          }
          if (saveTimerRef.current !== null) clearTimeout(saveTimerRef.current);
          saveTimerRef.current = setTimeout(() => {
            void doSave();
          }, persistenceConfig.autosaveDelayMs);
          if (persistenceConfig.recoveryEnabled) {
            if (recoveryTimerRef.current !== null) clearTimeout(recoveryTimerRef.current);
            recoveryTimerRef.current = setTimeout(() => {
              void stageRecovery('dirty');
            }, persistenceConfig.recoveryDelayMs);
          }
        }
      } catch {
        // Transport hiccup: keep the last state, retry on the next tick.
      }
    }, persistenceConfig.dirtyPollIntervalMs);
    return () => {
      cancelled = true;
      clearInterval(interval);
      if (saveTimerRef.current !== null) clearTimeout(saveTimerRef.current);
      if (recoveryTimerRef.current !== null) clearTimeout(recoveryTimerRef.current);
    };
  }, [active, doSave, engine, stageRecovery]);

  return { saveState, saveNow, flushForClose, recovery, restoreRecovery, discardRecovery };
}
