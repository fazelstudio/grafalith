import { persistenceConfig } from '../../platform/projects/persistenceConfig';

export type NameValidation =
  | { ok: true; value: string }
  | { ok: false; errorKey: string };

/** Instant UI feedback mirroring the backend rule; the backend revalidates. */
export function validateProjectName(name: string): NameValidation {
  const trimmed = name.trim();
  if (trimmed === '') return { ok: false, errorKey: 'projects.errors.invalidName' };
  if ([...trimmed].length > persistenceConfig.maxNameLength) {
    return { ok: false, errorKey: 'projects.errors.nameTooLong' };
  }
  return { ok: true, value: trimmed };
}
