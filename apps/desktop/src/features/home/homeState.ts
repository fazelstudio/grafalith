import type { ProjectError, ProjectSummary } from '../../platform/projects/types';

/** Explicit home list states; no boolean combinations stand in for these. */
export type HomeListState =
  | { kind: 'loading' }
  | { kind: 'storage-error'; error: ProjectError }
  | { kind: 'empty' }
  | { kind: 'populated'; projects: ProjectSummary[] }
  | { kind: 'search-results'; projects: ProjectSummary[]; query: string; total: number }
  | { kind: 'search-empty'; query: string };

/** Opening failures surfaced without leaving the home list behind. */
export type ProjectOpenErrorKind =
  | 'missing'
  | 'unreadable'
  | 'migration-required'
  | 'storage-unavailable';

export interface ProjectOpenError {
  kind: ProjectOpenErrorKind;
  projectName: string;
  messageKey: string;
  details?: string;
  recoverable: boolean;
}

function openKindFor(code: string): ProjectOpenErrorKind {
  if (code === 'not-found' || code === 'missing-document') return 'missing';
  if (code === 'unsupported-version') return 'migration-required';
  if (code === 'invalid-data' || code === 'unreadable') return 'unreadable';
  return 'storage-unavailable';
}

/** Maps a storage failure onto the opening vocabulary the UI renders. */
export function toProjectOpenError(error: ProjectError, projectName: string): ProjectOpenError {
  return {
    kind: openKindFor(error.code),
    projectName,
    messageKey: error.messageKey,
    details: error.details,
    recoverable: error.recoverable,
  };
}

/** Derives the list state from loaded summaries and the current query. */
export function deriveHomeListState(
  projects: readonly ProjectSummary[],
  query: string,
  filtered: readonly ProjectSummary[],
): HomeListState {
  if (query.trim() !== '') {
    if (filtered.length > 0) {
      return {
        kind: 'search-results',
        projects: [...filtered],
        query: query.trim(),
        total: projects.length,
      };
    }
    return { kind: 'search-empty', query: query.trim() };
  }
  if (projects.length === 0) return { kind: 'empty' };
  return { kind: 'populated', projects: [...projects] };
}
