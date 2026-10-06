import type { ProjectSummary } from '../../platform/projects/types';

/** Case-insensitive substring match over project names. */
export function normalizeQuery(query: string): string {
  return query.trim().toLocaleLowerCase();
}

/** Local metadata filter; the full scene payload is never touched here. */
export function filterProjects(
  projects: readonly ProjectSummary[],
  query: string,
): ProjectSummary[] {
  const needle = normalizeQuery(query);
  if (needle === '') return [...projects];
  return projects.filter((project) =>
    project.name.toLocaleLowerCase().includes(needle),
  );
}
