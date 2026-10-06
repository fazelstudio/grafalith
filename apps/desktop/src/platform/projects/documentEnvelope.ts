import { parseProjectError } from './types';

/**
 * Versioned document envelope shared by every desktop storage backend.
 *
 * Mirrors the engine interchange (`schemaVersion ?? version ?? 1`) and the
 * Tauri backend rule: only the current schema version loads as-is, anything
 * else is a migration decision — never a silent overwrite. The Tauri/Rust
 * side remains the canonical validator for file storage; this module keeps
 * the browser fallback and all UI-side guards on the same rule so the two
 * backends cannot drift.
 */

/** Engine schema version readable by this desktop build. */
export const SUPPORTED_SCHEMA_VERSION = 1;

/** Host metadata envelope version written beside each scene payload. */
export const PROJECT_FORMAT_VERSION = 1;

export type MigrationDecision =
  | { status: 'current'; version: number }
  | { status: 'needs-migration'; version: number };

/** Extracts the envelope version leniently; malformed payloads throw. */
export function detectEnvelopeVersion(sceneJson: string): number {
  let parsed: unknown;
  try {
    parsed = JSON.parse(sceneJson);
  } catch {
    throw parseProjectError(
      JSON.stringify({
        code: 'invalid-data',
        messageKey: 'projects.errors.unreadable',
        recoverable: false,
      }),
    );
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw parseProjectError(
      JSON.stringify({
        code: 'invalid-data',
        messageKey: 'projects.errors.unreadable',
        recoverable: false,
      }),
    );
  }
  const record = parsed as Record<string, unknown>;
  const version = record.schemaVersion ?? record.version ?? 1;
  return typeof version === 'number' ? version : 1;
}

/** Migration gate: v1 loads, anything else needs an explicit migration. */
export function migrationDecision(version: number): MigrationDecision {
  if (version === SUPPORTED_SCHEMA_VERSION) return { status: 'current', version };
  return { status: 'needs-migration', version };
}

/**
 * Validates a scene payload before it is committed: valid envelope,
 * supported version, and an `elements` array when present. Throws a typed
 * `ProjectError` on malformed, unsupported, or misshapen payloads.
 */
export function validateScenePayload(sceneJson: string): number {
  const version = detectEnvelopeVersion(sceneJson);
  const decision = migrationDecision(version);
  if (decision.status !== 'current') {
    throw parseProjectError(
      JSON.stringify({
        code: 'unsupported-version',
        messageKey: 'projects.errors.migrationRequired',
        details: String(version),
        recoverable: true,
      }),
    );
  }
  const parsed: unknown = JSON.parse(sceneJson);
  const record = parsed as Record<string, unknown>;
  if ('elements' in record && !Array.isArray(record.elements)) {
    throw parseProjectError(
      JSON.stringify({
        code: 'invalid-data',
        messageKey: 'projects.errors.unreadable',
        recoverable: false,
      }),
    );
  }
  return version;
}

/** Empty scene envelope matching the engine export shape. */
export function buildBlankSceneEnvelope(): string {
  return JSON.stringify({
    schemaVersion: SUPPORTED_SCHEMA_VERSION,
    version: SUPPORTED_SCHEMA_VERSION,
    elements: [],
    elementOrder: [],
  });
}
