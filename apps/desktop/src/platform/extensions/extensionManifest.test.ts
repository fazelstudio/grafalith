import { describe, expect, test } from 'bun:test';
import {
  ONRY_EXTENSION,
  ONRY_FORMAT_VERSION,
  ONRY_MANIFEST_FILENAME,
  onryPackageId,
  validateOnryManifest,
} from './extensionManifest';

function manifest() {
  return {
    formatVersion: ONRY_FORMAT_VERSION,
    id: 'sticker',
    publisher: 'acme',
    name: 'Sticker Pack',
    version: '1.2.3',
    engines: { opennary: '^0.1.0' },
    activationEvents: ['onStartup'],
  };
}

describe('onry extension manifest', () => {
  test('suffix and manifest filename are locked', () => {
    expect(ONRY_EXTENSION).toBe('.onry');
    expect(ONRY_MANIFEST_FILENAME).toBe('opennary.extension.json');
  });

  test('valid manifests pass', () => {
    const { manifest: parsed, errors } = validateOnryManifest(manifest());
    expect(errors).toEqual([]);
    expect(parsed?.id).toBe('sticker');
    expect(onryPackageId({ publisher: 'acme', id: 'sticker' })).toBe('acme.sticker');
  });

  test('format version, id, and semver are enforced', () => {
    expect(validateOnryManifest({ ...manifest(), formatVersion: 99 }).errors.length).toBeGreaterThan(0);
    expect(validateOnryManifest({ ...manifest(), id: 'Bad ID' }).errors.length).toBeGreaterThan(0);
    expect(validateOnryManifest({ ...manifest(), version: '1.2' }).errors.length).toBeGreaterThan(0);
    expect(validateOnryManifest({ ...manifest(), engines: {} }).errors.length).toBeGreaterThan(0);
  });

  test('non-objects fail with one clear error', () => {
    expect(validateOnryManifest(null).errors).toEqual(['manifest must be a JSON object']);
  });
});
