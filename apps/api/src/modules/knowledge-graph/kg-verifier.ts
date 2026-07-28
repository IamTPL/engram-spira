import {
  GeminiProviderTimeoutError,
  type GeminiResult,
  type GeminiStructuredRequest,
} from '../ai/gemini-provider';
import { AppError, ValidationError } from '../../shared/errors';

export const MAX_VERIFIER_PAIRS_PER_REQUEST = 25;
export const MAX_VERIFIER_INPUT_CHARACTERS = 20_000;
const MAX_RETRY_PAIRS_PER_REQUEST = 12;
const MAX_REASON_CHARACTERS = 1_000;
const MAX_EVIDENCE_CHARACTERS = 1_000;
const VERIFIER_CONCURRENCY = 2;

export const RELATION_TYPES = [
  'synonym',
  'antonym',
  'is_a',
  'part_of',
  'derived_from',
  'collocation',
  'confused_with',
  'translation_of',
  'coordinate',
] as const;

export type RelationType = (typeof RELATION_TYPES)[number];
export type RelationDecision = 'relation' | 'none' | 'abstain';
export type RelationDirection =
  | 'source_to_target'
  | 'target_to_source'
  | 'symmetric';
export type ConfidenceBand = 'high' | 'medium' | 'low';

export type RelationVerdict = {
  candidateId: string;
  decision: RelationDecision;
  relationType: RelationType | null;
  direction: RelationDirection | null;
  confidenceBand: ConfidenceBand;
  reason: string;
  evidence: {
    source: string;
    target: string;
  } | null;
};

export type VerificationArtifact = {
  cardId: string | null;
  senseId: string | null;
  contentHash: string;
  material: string;
};

export type VerificationCandidate = {
  candidateId: string;
  source: VerificationArtifact;
  target: VerificationArtifact;
  retrievalSimilarity: number;
  mutualKnn: boolean;
};

export type VerifierStructuredProvider = {
  generateStructured<T>(
    request: GeminiStructuredRequest<T>,
  ): Promise<GeminiResult<T>>;
};

export type VerifierStats = {
  verifierRequests: number;
  verified: number;
  missingRetries: number;
  schemaInvalid: number;
  timeouts: number;
  providerErrors: number;
  inputTokens: number | null;
  outputTokens: number | null;
};

export type VerificationResult = {
  verdicts: RelationVerdict[];
  unresolvedCandidateIds: string[];
  partial: boolean;
  retryableFailures: unknown[];
  stats: VerifierStats;
};

const symmetricRelationTypes = new Set<RelationType>([
  'synonym',
  'antonym',
  'collocation',
  'confused_with',
  'translation_of',
  'coordinate',
]);
const directedRelationTypes = new Set<RelationType>([
  'is_a',
  'part_of',
  'derived_from',
]);
const relationTypeSet = new Set<string>(RELATION_TYPES);
const decisionSet = new Set<string>(['relation', 'none', 'abstain']);
const directionSet = new Set<string>([
  'source_to_target',
  'target_to_source',
  'symmetric',
]);
const confidenceBandSet = new Set<string>(['high', 'medium', 'low']);

const VERIFIER_INSTRUCTIONS = [
  'You are a conservative lexical relationship classifier for language learning.',
  'Classify only the supplied candidate IDs and use only the supplied artifact text.',
  'Return relation only when the evidence clearly supports exactly one taxonomy relation.',
  'Return none when the artifacts clearly have no useful lexical relation.',
  'Return abstain when the information is ambiguous or insufficient.',
  'Never invent an ID, quotation, definition, or relationship type.',
  'Evidence, when supplied, must be copied exactly from the corresponding artifact text.',
  'Symmetric types: synonym, antonym, collocation, confused_with, translation_of, coordinate.',
  'Directed types: is_a, part_of, derived_from.',
  'Return a JSON array that conforms exactly to the supplied schema.',
].join('\n');

export const RELATION_VERDICT_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: [
      'candidateId',
      'decision',
      'relationType',
      'direction',
      'confidenceBand',
      'reason',
      'evidence',
    ],
    properties: {
      candidateId: { type: 'string' },
      decision: {
        type: 'string',
        enum: ['relation', 'none', 'abstain'],
      },
      relationType: {
        type: ['string', 'null'],
        enum: [...RELATION_TYPES, null],
      },
      direction: {
        type: ['string', 'null'],
        enum: [
          'source_to_target',
          'target_to_source',
          'symmetric',
          null,
        ],
      },
      confidenceBand: {
        type: 'string',
        enum: ['high', 'medium', 'low'],
      },
      reason: {
        type: 'string',
        maxLength: MAX_REASON_CHARACTERS,
      },
      evidence: {
        anyOf: [
          { type: 'null' },
          {
            type: 'object',
            additionalProperties: false,
            required: ['source', 'target'],
            properties: {
              source: {
                type: 'string',
                maxLength: MAX_EVIDENCE_CHARACTERS,
              },
              target: {
                type: 'string',
                maxLength: MAX_EVIDENCE_CHARACTERS,
              },
            },
          },
        ],
      },
    },
  },
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: string[],
  label: string,
): void {
  const expectedKeys = new Set(expected);
  const actualKeys = Object.keys(value);
  if (
    actualKeys.length !== expectedKeys.size ||
    actualKeys.some((key) => !expectedKeys.has(key))
  ) {
    throw new ValidationError(`Invalid verifier ${label} properties`);
  }
}

function requiredString(
  value: unknown,
  field: string,
  maxLength?: number,
): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ValidationError(`Invalid verifier ${field}`);
  }
  if (maxLength !== undefined && value.length > maxLength) {
    throw new ValidationError(`Verifier ${field} exceeds ${maxLength} characters`);
  }
  return value;
}

function nullableEnum<T extends string>(
  value: unknown,
  field: string,
  allowed: Set<string>,
): T | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !allowed.has(value)) {
    throw new ValidationError(`Invalid verifier ${field}`);
  }
  return value as T;
}

function parseEvidence(
  value: unknown,
  candidate: VerificationCandidate,
): RelationVerdict['evidence'] {
  if (value === null) return null;
  if (!isRecord(value)) {
    throw new ValidationError('Invalid verifier evidence');
  }
  assertExactKeys(value, ['source', 'target'], 'evidence');
  const source = requiredString(
    value.source,
    'source evidence',
    MAX_EVIDENCE_CHARACTERS,
  );
  const target = requiredString(
    value.target,
    'target evidence',
    MAX_EVIDENCE_CHARACTERS,
  );
  if (!candidate.source.material.includes(source)) {
    throw new ValidationError('Verifier source evidence is not in the artifact');
  }
  if (!candidate.target.material.includes(target)) {
    throw new ValidationError('Verifier target evidence is not in the artifact');
  }
  return { source, target };
}

function parseVerdict(
  value: unknown,
  candidates: Map<string, VerificationCandidate>,
): RelationVerdict {
  if (!isRecord(value)) {
    throw new ValidationError('Invalid verifier verdict');
  }
  assertExactKeys(
    value,
    [
      'candidateId',
      'decision',
      'relationType',
      'direction',
      'confidenceBand',
      'reason',
      'evidence',
    ],
    'verdict',
  );
  const candidateId = requiredString(value.candidateId, 'candidate ID');
  const candidate = candidates.get(candidateId);
  if (!candidate) {
    throw new ValidationError('Verifier returned an unknown candidate ID');
  }
  const decision = requiredString(value.decision, 'decision');
  if (!decisionSet.has(decision)) {
    throw new ValidationError('Invalid verifier decision');
  }
  const relationType = nullableEnum<RelationType>(
    value.relationType,
    'relation type',
    relationTypeSet,
  );
  const direction = nullableEnum<RelationDirection>(
    value.direction,
    'direction',
    directionSet,
  );
  const confidenceBand = requiredString(
    value.confidenceBand,
    'confidence band',
  );
  if (!confidenceBandSet.has(confidenceBand)) {
    throw new ValidationError('Invalid verifier confidence band');
  }
  const reason = requiredString(
    value.reason,
    'reason',
    MAX_REASON_CHARACTERS,
  );
  const evidence = parseEvidence(value.evidence, candidate);

  if (decision === 'none' || decision === 'abstain') {
    if (relationType !== null || direction !== null) {
      throw new ValidationError(
        `${decision} verdicts require null relation metadata`,
      );
    }
  } else {
    if (relationType === null || direction === null) {
      throw new ValidationError(
        'Relation verdicts require a relation type and direction',
      );
    }
    if (
      symmetricRelationTypes.has(relationType) &&
      direction !== 'symmetric'
    ) {
      throw new ValidationError(
        `Relation ${relationType} requires symmetric direction`,
      );
    }
    if (
      directedRelationTypes.has(relationType) &&
      direction === 'symmetric'
    ) {
      throw new ValidationError(
        `Relation ${relationType} requires a directed orientation`,
      );
    }
  }

  return {
    candidateId,
    decision: decision as RelationDecision,
    relationType,
    direction,
    confidenceBand: confidenceBand as ConfidenceBand,
    reason,
    evidence,
  };
}

function assertCandidates(candidates: VerificationCandidate[]): void {
  const candidateIds = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate.candidateId || candidateIds.has(candidate.candidateId)) {
      throw new ValidationError(
        'Verifier candidates require unique non-empty IDs',
      );
    }
    candidateIds.add(candidate.candidateId);
    if (!candidate.source.material || !candidate.target.material) {
      throw new ValidationError('Verifier artifact material is required');
    }
    if (
      !Number.isFinite(candidate.retrievalSimilarity) ||
      candidate.retrievalSimilarity < 0 ||
      candidate.retrievalSimilarity > 1
    ) {
      throw new ValidationError('Invalid candidate retrieval similarity');
    }
  }
}

export function parseRelationVerdicts(
  value: unknown,
  candidates: VerificationCandidate[],
): {
  verdicts: RelationVerdict[];
  missingCandidateIds: string[];
} {
  assertCandidates(candidates);
  if (!Array.isArray(value)) {
    throw new ValidationError('Verifier response must be an array');
  }
  const candidateById = new Map(
    candidates.map((candidate) => [candidate.candidateId, candidate]),
  );
  const seen = new Set<string>();
  const verdicts = value.map((item) => {
    const verdict = parseVerdict(item, candidateById);
    if (seen.has(verdict.candidateId)) {
      throw new ValidationError('Verifier returned a duplicate candidate ID');
    }
    seen.add(verdict.candidateId);
    return verdict;
  });
  const missingCandidateIds = candidates
    .filter((candidate) => !seen.has(candidate.candidateId))
    .map((candidate) => candidate.candidateId);
  return { verdicts, missingCandidateIds };
}

function promptCandidate(candidate: VerificationCandidate) {
  return {
    candidateId: candidate.candidateId,
    source: {
      material: candidate.source.material,
    },
    target: {
      material: candidate.target.material,
    },
  };
}

export function buildVerifierPrompt(
  candidates: VerificationCandidate[],
): string {
  return [
    VERIFIER_INSTRUCTIONS,
    'CANDIDATES_JSON_START',
    JSON.stringify(candidates.map(promptCandidate)),
    'CANDIDATES_JSON_END',
  ].join('\n');
}

function partitionWithLimit(
  candidates: VerificationCandidate[],
  maxPairs: number,
): VerificationCandidate[][] {
  assertCandidates(candidates);
  const sorted = [...candidates].sort((left, right) =>
    left.candidateId.localeCompare(right.candidateId),
  );
  const batches: VerificationCandidate[][] = [];
  let current: VerificationCandidate[] = [];

  for (const candidate of sorted) {
    const next = [...current, candidate];
    if (
      next.length <= maxPairs &&
      buildVerifierPrompt(next).length <= MAX_VERIFIER_INPUT_CHARACTERS
    ) {
      current = next;
      continue;
    }
    if (current.length > 0) {
      batches.push(current);
      current = [];
    }
    if (
      buildVerifierPrompt([candidate]).length >
      MAX_VERIFIER_INPUT_CHARACTERS
    ) {
      throw new ValidationError(
        `Candidate ${candidate.candidateId} exceeds the ${MAX_VERIFIER_INPUT_CHARACTERS} character verifier request limit`,
      );
    }
    current = [candidate];
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

export function partitionVerifierCandidates(
  candidates: VerificationCandidate[],
): VerificationCandidate[][] {
  return partitionWithLimit(candidates, MAX_VERIFIER_PAIRS_PER_REQUEST);
}

type BatchOutcome = {
  verdicts: RelationVerdict[];
  missingCandidateIds: string[];
  error: 'schema' | 'timeout' | 'provider' | null;
  cause: unknown | null;
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
  } | null;
};

async function runWithConcurrency<T, R>(
  inputs: T[],
  limit: number,
  operation: (input: T) => Promise<R>,
): Promise<R[]> {
  if (inputs.length === 0) return [];
  const results = new Array<R>(inputs.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(limit, inputs.length) },
    async () => {
      while (true) {
        const index = cursor++;
        if (index >= inputs.length) return;
        results[index] = await operation(inputs[index]);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

async function verifyBatch(
  candidates: VerificationCandidate[],
  provider: VerifierStructuredProvider,
  signal?: AbortSignal,
): Promise<BatchOutcome> {
  try {
    const result = await provider.generateStructured({
      prompt: buildVerifierPrompt(candidates),
      schema: RELATION_VERDICT_SCHEMA,
      signal,
      parse(value) {
        return parseRelationVerdicts(value, candidates);
      },
    });
    return {
      verdicts: result.value.verdicts,
      missingCandidateIds: result.value.missingCandidateIds,
      error: null,
      cause: null,
      usage: result.usage,
    };
  } catch (error) {
    if (signal?.aborted) {
      throw signal.reason ?? error;
    }
    const kind =
      error instanceof ValidationError
        ? 'schema'
        : error instanceof GeminiProviderTimeoutError
          ? 'timeout'
          : 'provider';
    return {
      verdicts: [],
      missingCandidateIds: candidates.map(
        (candidate) => candidate.candidateId,
      ),
      error: kind,
      cause: error,
      usage: null,
    };
  }
}

function errorCause(error: unknown): unknown {
  if (
    error !== null &&
    typeof error === 'object' &&
    'cause' in error
  ) {
    return error.cause;
  }
  return null;
}

function errorHttpStatus(error: unknown): number | null {
  if (error === null || typeof error !== 'object') return null;
  const record = error as Record<string, unknown>;
  for (const key of ['status', 'statusCode'] as const) {
    const value = record[key];
    if (typeof value === 'number' && Number.isInteger(value)) return value;
  }
  if ('response' in error && isRecord(error.response)) {
    const status = error.response.status;
    if (typeof status === 'number' && Number.isInteger(status)) return status;
  }
  return null;
}

export function isRetryableVerifierProviderError(error: unknown): boolean {
  const visited = new Set<unknown>();
  let current: unknown = error;
  let status: number | null = null;
  while (
    current !== null &&
    current !== undefined &&
    !visited.has(current)
  ) {
    visited.add(current);
    if (current instanceof AppError) return false;
    status ??= errorHttpStatus(current);
    current = errorCause(current);
  }
  return status === 429 || (status !== null && status >= 500 && status <= 599);
}

function emptyStats(): VerifierStats {
  return {
    verifierRequests: 0,
    verified: 0,
    missingRetries: 0,
    schemaInvalid: 0,
    timeouts: 0,
    providerErrors: 0,
    inputTokens: null,
    outputTokens: null,
  };
}

type UsageAccumulator = {
  inputTotal: number;
  outputTotal: number;
  inputComplete: boolean;
  outputComplete: boolean;
};

function addOutcomeStats(
  stats: VerifierStats,
  usage: UsageAccumulator,
  outcome: BatchOutcome,
): void {
  stats.verifierRequests++;
  if (outcome.error === 'schema') stats.schemaInvalid++;
  if (outcome.error === 'timeout') stats.timeouts++;
  if (outcome.error === 'provider') stats.providerErrors++;
  if (outcome.usage?.inputTokens === null || outcome.usage === null) {
    usage.inputComplete = false;
  } else {
    usage.inputTotal += outcome.usage.inputTokens;
  }
  if (outcome.usage?.outputTokens === null || outcome.usage === null) {
    usage.outputComplete = false;
  } else {
    usage.outputTotal += outcome.usage.outputTokens;
  }
}

export async function verifyRelationshipCandidates(
  candidates: VerificationCandidate[],
  provider: VerifierStructuredProvider,
  signal?: AbortSignal,
): Promise<VerificationResult> {
  const batches = partitionVerifierCandidates(candidates);
  const stats = emptyStats();
  const usage: UsageAccumulator = {
    inputTotal: 0,
    outputTotal: 0,
    inputComplete: true,
    outputComplete: true,
  };
  const verdictByCandidateId = new Map<string, RelationVerdict>();
  const unresolved = new Set<string>();
  const retryableMissing = new Set<string>();
  const retryableFailures: unknown[] = [];

  const initialOutcomes = await runWithConcurrency(
    batches,
    VERIFIER_CONCURRENCY,
    (batch) => verifyBatch(batch, provider, signal),
  );
  for (const outcome of initialOutcomes) {
    addOutcomeStats(stats, usage, outcome);
    if (
      outcome.error === 'provider' &&
      isRetryableVerifierProviderError(outcome.cause)
    ) {
      retryableFailures.push(outcome.cause);
    }
    for (const verdict of outcome.verdicts) {
      verdictByCandidateId.set(verdict.candidateId, verdict);
    }
    for (const candidateId of outcome.missingCandidateIds) {
      unresolved.add(candidateId);
      if (outcome.error === null) retryableMissing.add(candidateId);
    }
  }

  const candidateById = new Map(
    candidates.map((candidate) => [candidate.candidateId, candidate]),
  );
  const retryCandidates = [...retryableMissing]
    .map((candidateId) => candidateById.get(candidateId))
    .filter((candidate): candidate is VerificationCandidate => Boolean(candidate));
  if (retryCandidates.length > 0) {
    const retryBatches = partitionWithLimit(
      retryCandidates,
      MAX_RETRY_PAIRS_PER_REQUEST,
    );
    stats.missingRetries = retryBatches.length;
    const retryOutcomes = await runWithConcurrency(
      retryBatches,
      VERIFIER_CONCURRENCY,
      (batch) => verifyBatch(batch, provider, signal),
    );
    for (const outcome of retryOutcomes) {
      addOutcomeStats(stats, usage, outcome);
      if (
        outcome.error === 'provider' &&
        isRetryableVerifierProviderError(outcome.cause)
      ) {
        retryableFailures.push(outcome.cause);
      }
      for (const verdict of outcome.verdicts) {
        verdictByCandidateId.set(verdict.candidateId, verdict);
        unresolved.delete(verdict.candidateId);
      }
    }
  }

  const orderedCandidates = [...candidates].sort((left, right) =>
    left.candidateId.localeCompare(right.candidateId),
  );
  const verdicts = orderedCandidates
    .map((candidate) => verdictByCandidateId.get(candidate.candidateId))
    .filter((verdict): verdict is RelationVerdict => Boolean(verdict));
  const unresolvedCandidateIds = orderedCandidates
    .filter((candidate) => !verdictByCandidateId.has(candidate.candidateId))
    .map((candidate) => candidate.candidateId);

  stats.verified = verdicts.length;
  stats.inputTokens = usage.inputComplete ? usage.inputTotal : null;
  stats.outputTokens = usage.outputComplete ? usage.outputTotal : null;

  return {
    verdicts,
    unresolvedCandidateIds,
    partial: unresolvedCandidateIds.length > 0,
    retryableFailures,
    stats,
  };
}
