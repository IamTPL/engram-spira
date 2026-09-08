import { describe, expect, test } from 'bun:test';
import {
  FSRS_UUID_NAMESPACE,
  canonicalJson,
  sha256Canonical,
  uuidV5,
} from '../../../src/modules/study/fsrs-canonical';
import { ValidationError } from '../../../src/shared/errors';

describe('fsrs canonical helpers', () => {
  test('canonical JSON sorts keys, normalises -0 and rejects non-finite numbers', () => {
    expect(canonicalJson({ b: [1, { d: 2, c: -0 }], a: 'x' })).toBe(
      '{"a":"x","b":[1,{"c":0,"d":2}]}',
    );
    expect(() => canonicalJson({ a: Number.NaN })).toThrow(ValidationError);
  });

  test('sha256 is stable across key order', () => {
    expect(sha256Canonical({ a: 1, b: 2 })).toBe(sha256Canonical({ b: 2, a: 1 }));
    expect(sha256Canonical({ a: 1 })).toMatch(/^[0-9a-f]{64}$/u);
  });

  test('uuidV5 is deterministic and RFC 4122 shaped', () => {
    const id = uuidV5('parameter-revision/x', FSRS_UUID_NAMESPACE);
    expect(id).toBe(uuidV5('parameter-revision/x', FSRS_UUID_NAMESPACE));
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(FSRS_UUID_NAMESPACE).toBe('6ba7b811-9dad-11d1-80b4-00c04fd430c8');
  });
});
