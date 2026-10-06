import { describe, expect, test } from 'bun:test';
import { projectTemplateRegistry } from './templateRegistry';
import { filterProjects } from './search';
import { validateProjectName } from './projectNames';
import { deriveHomeListState, toProjectOpenError } from '../home/homeState';
import type { ProjectSummary } from '../../platform/projects/types';

function summary(name: string): ProjectSummary {
  return {
    id: `p-${name}`,
    name,
    createdAtMs: 1,
    updatedAtMs: 2,
    schemaVersion: 1,
    documentExists: true,
    storage: 'local',
  };
}

describe('project template registry', () => {
  test('exposes a default template built from descriptors', () => {
    const all = projectTemplateRegistry.all();
    expect(all.length).toBeGreaterThan(0);
    const blank = projectTemplateRegistry.get('blank');
    expect(blank?.labelKey).toBe('projects.templates.blank');
  });

  test('blank template builds a loadable empty scene envelope', () => {
    const scene = projectTemplateRegistry.get('blank')!.buildScene();
    const parsed = JSON.parse(scene) as Record<string, unknown>;
    expect(parsed.elements).toEqual([]);
    expect(parsed.elementOrder).toEqual([]);
  });
});

describe('project search', () => {
  const projects = [summary('Site plan'), summary('Logo draft'), summary('site audit')];

  test('matches names case-insensitively', () => {
    expect(filterProjects(projects, 'site').map((p) => p.name)).toEqual([
      'Site plan',
      'site audit',
    ]);
  });

  test('blank queries return everything without reordering', () => {
    expect(filterProjects(projects, '   ').map((p) => p.name)).toEqual([
      'Site plan',
      'Logo draft',
      'site audit',
    ]);
  });

  test('unmatched queries return an empty list', () => {
    expect(filterProjects(projects, 'zzz')).toEqual([]);
  });
});

describe('project name validation', () => {
  test('trims surrounding whitespace', () => {
    expect(validateProjectName('  Plan  ')).toEqual({ ok: true, value: 'Plan' });
  });

  test('rejects blank names with a locale key', () => {
    expect(validateProjectName('   ')).toEqual({
      ok: false,
      errorKey: 'projects.errors.invalidName',
    });
  });

  test('accepts names up to 50 characters and rejects longer names', () => {
    expect(validateProjectName('a'.repeat(50))).toEqual({
      ok: true,
      value: 'a'.repeat(50),
    });
    expect(validateProjectName('a'.repeat(51))).toEqual({
      ok: false,
      errorKey: 'projects.errors.nameTooLong',
    });
  });
});

describe('home list states', () => {
  test('empty projects resolve to the empty state', () => {
    expect(deriveHomeListState([], '', []).kind).toBe('empty');
  });

  test('populated projects resolve to the populated state', () => {
    const projects = [summary('A')];
    const state = deriveHomeListState(projects, '', projects);
    expect(state.kind).toBe('populated');
  });

  test('queries with matches resolve to search-results', () => {
    const projects = [summary('A'), summary('B')];
    const state = deriveHomeListState(projects, 'a', [projects[0]]);
    expect(state).toEqual({
      kind: 'search-results',
      projects: [projects[0]],
      query: 'a',
      total: 2,
    });
  });

  test('queries without matches resolve to search-empty', () => {
    expect(deriveHomeListState([summary('A')], 'zzz', []).kind).toBe('search-empty');
  });
});

describe('open error mapping', () => {
  test('missing documents map to the missing kind', () => {
    const error = toProjectOpenError(
      { code: 'missing-document', messageKey: 'projects.errors.missing', recoverable: false },
      'Plan',
    );
    expect(error.kind).toBe('missing');
    expect(error.projectName).toBe('Plan');
  });

  test('unsupported versions map to migration-required', () => {
    const error = toProjectOpenError(
      {
        code: 'unsupported-version',
        messageKey: 'projects.errors.migrationRequired',
        recoverable: true,
      },
      'Plan',
    );
    expect(error.kind).toBe('migration-required');
  });
});
