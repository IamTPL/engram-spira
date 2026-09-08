import { createHash } from 'node:crypto';
import { ValidationError } from '../../shared/errors';

/** RFC 4122 URL namespace; every deterministic FSRS id is derived from it. */
export const FSRS_UUID_NAMESPACE = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export function validateUuid(value: unknown, name: string): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new ValidationError(`${name} must be a canonical lowercase UUID`);
  }
  return value;
}

export function asciiCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function serializeCanonical(
  value: unknown,
  ancestors: WeakSet<object>,
): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) {
        throw new ValidationError('Canonical JSON requires finite numbers');
      }
      return JSON.stringify(Object.is(value, -0) ? 0 : value);
    case 'undefined':
    case 'bigint':
    case 'symbol':
    case 'function':
      throw new ValidationError('Canonical JSON contains unsupported values');
    case 'object':
      break;
  }

  const objectValue = value as object;
  if (ancestors.has(objectValue)) {
    throw new ValidationError('Canonical JSON cannot contain cycles');
  }
  ancestors.add(objectValue);
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) {
          throw new ValidationError(
            'Canonical JSON cannot contain sparse arrays',
          );
        }
      }
      return `[${value
        .map((item) => serializeCanonical(item, ancestors))
        .join(',')}]`;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new ValidationError(
        'Canonical JSON requires plain objects',
      );
    }
    const record = value as Record<string, unknown>;
    const ownKeys = Reflect.ownKeys(record);
    if (ownKeys.some((key) => typeof key === 'symbol')) {
      throw new ValidationError(
        'Canonical JSON cannot contain symbol keys',
      );
    }
    for (const key of ownKeys as string[]) {
      const descriptor = Object.getOwnPropertyDescriptor(record, key);
      if (
        !descriptor ||
        !descriptor.enumerable ||
        !Object.hasOwn(descriptor, 'value')
      ) {
        throw new ValidationError(
          'Canonical JSON requires enumerable data properties',
        );
      }
    }
    const keys = Object.keys(record).sort(asciiCompare);
    return `{${keys
      .map(
        (key) =>
          `${JSON.stringify(key)}:${serializeCanonical(
            record[key],
            ancestors,
          )}`,
      )
      .join(',')}}`;
  } finally {
    ancestors.delete(objectValue);
  }
}

export function canonicalJson(value: unknown): string {
  return serializeCanonical(value, new WeakSet<object>());
}

export function sha256Canonical(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export function uuidV5(name: string, namespace: string): string {
  if (typeof name !== 'string') {
    throw new ValidationError('UUIDv5 name must be a string');
  }
  validateUuid(namespace, 'UUIDv5 namespace');
  const namespaceBytes = Buffer.from(namespace.replaceAll('-', ''), 'hex');
  const digest = createHash('sha1')
    .update(namespaceBytes)
    .update(Buffer.from(name, 'utf8'))
    .digest();
  digest[6] = (digest[6]! & 0x0f) | 0x50;
  digest[8] = (digest[8]! & 0x3f) | 0x80;
  const hex = digest.subarray(0, 16).toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}
