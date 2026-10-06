import { describe, expect, test } from 'bun:test';
import {
  buildBlankSceneEnvelope,
  detectEnvelopeVersion,
  migrationDecision,
  validateScenePayload,
} from './documentEnvelope';

describe('document envelope', () => {
  test('blank envelope validates at the supported version', () => {
    expect(validateScenePayload(buildBlankSceneEnvelope())).toBe(1);
  });

  test('version resolves leniently across aliases', () => {
    expect(detectEnvelopeVersion('{"elements":[]}')).toBe(1);
    expect(detectEnvelopeVersion('{"version":1,"elements":[]}')).toBe(1);
    expect(detectEnvelopeVersion('{"schemaVersion":1,"elements":[]}')).toBe(1);
    expect(detectEnvelopeVersion('{"schemaVersion":999,"elements":[]}')).toBe(999);
  });

  test('malformed and non-object payloads are invalid data', () => {
    for (const bad of ['{not json', '[1,2,3]']) {
      try {
        validateScenePayload(bad);
        throw new Error('should have thrown');
      } catch (error) {
        expect(error).toMatchObject({ code: 'invalid-data' });
      }
    }
  });

  test('non-array elements are rejected before commit', () => {
    try {
      validateScenePayload('{"schemaVersion":1,"elements":{}}');
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toMatchObject({ code: 'invalid-data' });
    }
  });

  test('future versions need migration instead of loading', () => {
    const decision = migrationDecision(999);
    expect(decision.status).toBe('needs-migration');
    try {
      validateScenePayload('{"schemaVersion":999,"version":999,"elements":[]}');
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toMatchObject({ code: 'unsupported-version', recoverable: true });
    }
  });
});
