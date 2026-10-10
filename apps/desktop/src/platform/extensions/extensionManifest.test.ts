import { describe, expect, test } from 'bun:test';
import {
  GRLT_EXTENSION,
  GRLT_FORMAT_VERSION,
  GRLT_MANIFEST_FILENAME,
  grltPackageId,
  validateGrltManifest,
} from './extensionManifest';

function manifest() {
  return {
    formatVersion: GRLT_FORMAT_VERSION,
    id: 'sticker',
    publisher: 'acme',
    name: 'Sticker Pack',
    version: '1.2.3',
    engines: { grafalith: '^0.1.0' },
    activationEvents: ['onStartup'],
  };
}

describe('grlt extension manifest', () => {
  test('suffix and manifest filename are locked', () => {
    expect(GRLT_EXTENSION).toBe('.grlt');
    expect(GRLT_MANIFEST_FILENAME).toBe('grafalith.extension.json');
  });

  test('valid manifests pass', () => {
    const { manifest: parsed, errors } = validateGrltManifest(manifest());
    expect(errors).toEqual([]);
    expect(parsed?.id).toBe('sticker');
    expect(grltPackageId({ publisher: 'acme', id: 'sticker' })).toBe('acme.sticker');
  });

  test('format version, id, and semver are enforced', () => {
    expect(validateGrltManifest({ ...manifest(), formatVersion: 99 }).errors.length).toBeGreaterThan(0);
    expect(validateGrltManifest({ ...manifest(), id: 'Bad ID' }).errors.length).toBeGreaterThan(0);
    expect(validateGrltManifest({ ...manifest(), version: '1.2' }).errors.length).toBeGreaterThan(0);
    expect(validateGrltManifest({ ...manifest(), engines: {} }).errors.length).toBeGreaterThan(0);
  });

  test('non-objects fail with one clear error', () => {
    expect(validateGrltManifest(null).errors).toEqual(['manifest must be a JSON object']);
  });
});
