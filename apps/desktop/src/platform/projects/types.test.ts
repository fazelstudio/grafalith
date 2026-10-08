import { describe, expect, test } from 'bun:test';
import { parseProjectError } from './types';

describe('parseProjectError', () => {
  test('parses a Tauri rejection whose message contains an error envelope', () => {
    const error = parseProjectError({
      message: JSON.stringify({
        code: 'missing-document',
        messageKey: 'projects.errors.missing',
        details: 'demo',
        recoverable: false,
      }),
    });

    expect(error).toEqual({
      code: 'missing-document',
      messageKey: 'projects.errors.missing',
      details: 'demo',
      recoverable: false,
    });
  });

  test('keeps plain IPC rejection text as diagnostics', () => {
    const error = parseProjectError({ message: 'invoke failed' });

    expect(error.code).toBe('storage-unavailable');
    expect(error.details).toBe('invoke failed');
  });
});
