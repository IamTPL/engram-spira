import { ValidationError } from '../../shared/errors';
import { canonicalUuid } from './fsrs-live.domain';
import {
  FSRS_UUID_NAMESPACE,
  canonicalJson,
  sha256Canonical,
  uuidV5,
} from './fsrs-canonical';
import {
  FSRS_ALGORITHM_VERSION,
  FSRS_LIBRARY_VERSION,
  FSRS_POLICY_VERSION,
  normalizeFsrsParameters,
} from './fsrs.engine';

const HASH_PATTERN = /^[0-9a-f]{64}$/u;
const REVISION_SOURCES = new Set([
  'default',
  'manual',
  'optimized',
  'migration',
]);

export interface FsrsParameterRevisionIdentity {
  id: string;
  revision: number;
  engineVersion: string;
  algorithmVersion: string;
  policyVersion: string;
  parameters: unknown;
  paramsHash: string;
  source: string;
}

export function canonicalFsrsParameters(
  value?: unknown,
): Record<string, unknown> {
  return JSON.parse(
    canonicalJson(normalizeFsrsParameters(value)),
  ) as Record<string, unknown>;
}

export function canonicalDefaultFsrsParameters(): Record<string, unknown> {
  return canonicalFsrsParameters(undefined);
}

export function deterministicFsrsParameterRevisionId(
  userId: string,
  paramsHash: string,
): string {
  const canonicalUserId = canonicalUuid(userId, 'FSRS revision user id');
  if (!HASH_PATTERN.test(paramsHash)) {
    throw new ValidationError('FSRS parameter revision hash is invalid');
  }
  return uuidV5(
    [
      'parameter-revision',
      canonicalUserId,
      FSRS_LIBRARY_VERSION,
      FSRS_ALGORITHM_VERSION,
      FSRS_POLICY_VERSION,
      paramsHash,
    ].join('/'),
    FSRS_UUID_NAMESPACE,
  );
}

export function validateFsrsParameterRevisionIdentity(
  userId: string,
  revision: FsrsParameterRevisionIdentity,
): Record<string, unknown> {
  const canonicalUserId = canonicalUuid(userId, 'FSRS revision user id');
  const canonicalRevisionId = canonicalUuid(
    revision.id,
    'FSRS parameter revision id',
  );
  if (
    revision.engineVersion !== FSRS_LIBRARY_VERSION ||
    revision.algorithmVersion !== FSRS_ALGORITHM_VERSION ||
    revision.policyVersion !== FSRS_POLICY_VERSION
  ) {
    throw new ValidationError(
      'FSRS parameter revision has unsupported scheduler provenance',
    );
  }
  if (
    !Number.isInteger(revision.revision) ||
    revision.revision <= 0 ||
    revision.revision > 2_147_483_647
  ) {
    throw new ValidationError(
      'FSRS parameter revision number must be a positive integer',
    );
  }
  if (!REVISION_SOURCES.has(revision.source)) {
    throw new ValidationError('FSRS parameter revision source is invalid');
  }
  if (!HASH_PATTERN.test(revision.paramsHash)) {
    throw new ValidationError('FSRS parameter revision hash is invalid');
  }

  const rawCanonicalJson = canonicalJson(revision.parameters);
  const parameters = canonicalFsrsParameters(revision.parameters);
  if (rawCanonicalJson !== canonicalJson(parameters)) {
    throw new ValidationError(
      'FSRS parameter revision parameters are not canonical',
    );
  }
  const paramsHash = sha256Canonical(parameters);
  if (revision.paramsHash !== paramsHash) {
    throw new ValidationError('FSRS parameter revision hash mismatch');
  }
  if (
    revision.source === 'default' &&
    canonicalRevisionId !==
      deterministicFsrsParameterRevisionId(canonicalUserId, paramsHash)
  ) {
    throw new ValidationError('FSRS default revision identity mismatch');
  }
  return parameters;
}
