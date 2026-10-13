import { useEffect, useState } from 'react';
import type { Engine } from '../../hooks/useEngine';
import { getProjectStore } from '../../platform/projects/projectService';
import {
  normalizeProjectCanvas,
  normalizeProjectKind,
  parseProjectError,
  type ProjectCanvas,
  type ProjectError,
  type ProjectKind,
} from '../../platform/projects/types';

/** Open pipeline stage, identifying where a failure happened. */
export type ProjectOpenStage =
  | 'resolve'
  | 'read'
  | 'validate'
  | 'migrate'
  | 'initialize'
  | 'ready';

/** Explicit project opening pipeline states. */
export type ProjectSession =
  | { kind: 'opening'; stage: ProjectOpenStage }
  | { kind: 'ready'; name: string; projectKind: ProjectKind; canvas: ProjectCanvas; empty: boolean }
  | { kind: 'failed'; error: ProjectError; stage: ProjectOpenStage };

/** Maps a typed project error to the pipeline stage that produced it. */
export function stageFor(code: string): ProjectOpenStage {
  if (code === 'not-found' || code === 'invalid-id') return 'resolve';
  if (code === 'missing-document' || code === 'storage-unavailable') return 'read';
  if (code === 'invalid-data' || code === 'unreadable') return 'validate';
  if (code === 'unsupported-version') return 'migrate';
  return 'read';
}

function unreadableError(): ProjectError {
  return {
    code: 'unreadable',
    messageKey: 'projects.errors.unreadable',
    recoverable: false,
  };
}

function engineUnavailableError(raw: unknown): ProjectError {
  const parsed = parseProjectError(raw);
  return {
    code: 'storage-unavailable',
    messageKey: 'errors.engineUnavailable',
    details: parsed.details,
    recoverable: true,
  };
}

/**
 * Opens one project into the engine following the explicit pipeline:
 * resolve the reference, read the payload, validate it through engine
 * import, then report readiness. Empty documents (`imported === 0`) are
 * ready — distinct from failed loads — so the editor can show the blank
 * hint instead of an error. Runs only after the engine transport is up
 * so creation never races the import.
 */
export function useProjectSession(engine: Engine, projectId: string): {
  session: ProjectSession;
  retry: () => void;
} {
  const [attempt, setAttempt] = useState(0);
  const [session, setSession] = useState<ProjectSession>({ kind: 'opening', stage: 'resolve' });

  useEffect(() => {
    let cancelled = false;
    setSession({ kind: 'opening', stage: 'resolve' });

    async function run(): Promise<void> {
      if (engine.failed) {
        if (!cancelled) {
          setSession({
            kind: 'failed',
            error: engineUnavailableError(engine.failure),
            stage: 'initialize',
          });
        }
        return;
      }
      if (!engine.ready) return;
      try {
        if (!cancelled) setSession({ kind: 'opening', stage: 'read' });
        const { summary, sceneJson } = await getProjectStore().open(projectId);
        if (cancelled) return;
        setSession({ kind: 'opening', stage: 'validate' });
        const raw = await engine.importScene(sceneJson, false);
        if (cancelled) return;
        let failed = false;
        let empty = false;
        try {
          const parsed: unknown = JSON.parse(raw);
          if (typeof parsed === 'object' && parsed !== null) {
            const record = parsed as Record<string, unknown>;
            if (record.ok === false) {
              failed = true;
            } else if (typeof record.imported === 'number') {
              empty = record.imported === 0;
            }
          }
        } catch {
          failed = true;
        }
        if (failed) {
          setSession({ kind: 'failed', error: unreadableError(), stage: 'initialize' });
          return;
        }
        setSession({ kind: 'opening', stage: 'initialize' });
        setSession({
          kind: 'ready',
          name: summary.name,
          projectKind: normalizeProjectKind(summary.kind),
          canvas: normalizeProjectCanvas(summary.canvas),
          empty,
        });
      } catch (rawError) {
        if (!cancelled) {
          const error = parseProjectError(rawError);
          setSession({ kind: 'failed', error, stage: stageFor(error.code) });
        }
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [engine, engine.ready, engine.failed, projectId, attempt]);

  return { session, retry: () => setAttempt((n) => n + 1) };
}
