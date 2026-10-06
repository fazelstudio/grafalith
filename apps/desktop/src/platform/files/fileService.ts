import { parseProjectError, type ProjectError } from '../projects/types';

/**
 * FileService: platform file-manager integration.
 *
 * Only operations with a real backend are advertised. Neither the Tauri
 * file backend nor the browser fallback implements archive or reveal, so
 * both stay explicitly unsupported instead of failing with raw OS errors.
 * Callers gate UI on `fileCapabilities` rather than probing the runtime.
 */

export const fileCapabilities = {
  supportsArchive: false,
  supportsReveal: false,
} as const;

function unsupported(operation: string): ProjectError {
  return parseProjectError(
    JSON.stringify({
      code: 'unsupported',
      messageKey: 'projects.errors.unsupportedOperation',
      details: operation,
      recoverable: false,
    }),
  );
}

/** File-manager integration; every method rejects until a backend exists. */
export const fileService = {
  async revealInFileManager(_projectId: string): Promise<void> {
    throw unsupported('reveal');
  },
  async archiveProject(_projectId: string): Promise<void> {
    throw unsupported('archive');
  },
};
