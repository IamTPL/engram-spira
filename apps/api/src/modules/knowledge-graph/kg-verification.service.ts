import type { VocabularyArtifact } from './vocabulary-artifact';
import type {
  CandidateLexicalEvidence,
  CanonicalCandidate,
} from './kg-candidates';
import {
  verifyRelationshipCandidates,
  type RelationDecision,
  type RelationDirection,
  type RelationType,
  type VerificationArtifact,
  type VerificationCandidate,
  type VerifierStructuredProvider,
} from './kg-verifier';
import { ValidationError } from '../../shared/errors';

export type VerificationSuggestionEndpoint = VerificationArtifact & {
  artifact: VocabularyArtifact;
};

export type VerificationSuggestionCandidate = Omit<
  VerificationCandidate,
  'source' | 'target'
> & {
  fingerprint: string;
  source: VerificationSuggestionEndpoint;
  target: VerificationSuggestionEndpoint;
  lexicalEvidence: CandidateLexicalEvidence;
};

export type ExistingVerifierSuggestion = {
  fingerprint: string;
  runId: string;
  decision: RelationDecision;
  status:
    | 'pending'
    | 'accepted'
    | 'dismissed'
    | 'superseded'
    | 'rejected';
};

export type PersistedVerifierSuggestion = {
  runId: string;
  userId: string;
  sourceCardId: string | null;
  targetCardId: string | null;
  sourceSenseId: string | null;
  targetSenseId: string | null;
  sourceArtifact: VocabularyArtifact;
  targetArtifact: VocabularyArtifact;
  sourceContentHash: string;
  targetContentHash: string;
  decision: RelationDecision;
  relationType: RelationType | null;
  direction: RelationDirection | null;
  confidenceBand: 'high' | 'medium' | 'low';
  reason: string;
  evidence: {
    source: string;
    target: string;
  } | null;
  retrievalSimilarity: number;
  mutualKnn: boolean;
  fingerprint: string;
  status: 'pending' | 'rejected';
};

export type SuggestionPersistenceRepository = {
  loadExistingSuggestions(
    userId: string,
    fingerprints: string[],
  ): Promise<ExistingVerifierSuggestion[]>;
  persistSuggestions(
    fence: SuggestionPersistenceFence,
    records: PersistedVerifierSuggestion[],
  ): Promise<SuggestionPersistenceResult>;
};

export type SuggestionPersistenceFence = {
  runId: string;
  userId: string;
  deckId: string;
  workerId: string;
};

export type SuggestionPersistenceResult = {
  persisted: number;
  pending: number;
};

export type VerificationSuggestionStageInput = {
  runId: string;
  userId: string;
  deckId: string;
  workerId: string;
  candidates: VerificationSuggestionCandidate[];
  attemptCount: number;
  maxAttempts: number;
};

export type VerificationSuggestionStageResult = {
  nextStage: 'persistence';
  partial: boolean;
  retryableFailure: unknown | null;
  cached: number;
  persisted: number;
  suggestions: number;
  unresolvedCandidateIds: string[];
  progress: {
    verified: number;
    suggestions: number;
    unresolved: number;
  };
  statsPatch: {
    verifierRequests: number;
    verified: number;
    suggestions: number;
    schemaInvalid: number;
    timeouts: number;
    providerErrors: number;
    missingRetries: number;
    inputTokens: number | null;
    outputTokens: number | null;
  };
};

export function buildVerifierArtifactMaterial(
  artifact: VocabularyArtifact,
): string {
  return [
    `source_language: ${artifact.sourceLanguageTag}`,
    `definition_language: ${artifact.definitionLanguageTag}`,
    `lemma: ${artifact.lemma}`,
    `part_of_speech: ${artifact.partOfSpeech}`,
    `definition: ${artifact.definition}`,
    artifact.ipa === null ? null : `ipa: ${artifact.ipa}`,
    ...artifact.examples.map((example) => `example: ${example}`),
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}

export function toVerificationSuggestionCandidate(
  candidate: CanonicalCandidate,
): VerificationSuggestionCandidate {
  return {
    candidateId: candidate.candidateId,
    fingerprint: candidate.fingerprint,
    source: {
      cardId: candidate.source.cardId,
      senseId: candidate.source.senseId,
      contentHash: candidate.source.artifact.contentHash,
      material: buildVerifierArtifactMaterial(candidate.source.artifact),
      artifact: candidate.source.artifact,
    },
    target: {
      cardId: candidate.target.cardId,
      senseId: candidate.target.senseId,
      contentHash: candidate.target.artifact.contentHash,
      material: buildVerifierArtifactMaterial(candidate.target.artifact),
      artifact: candidate.target.artifact,
    },
    retrievalSimilarity: candidate.similarity,
    mutualKnn: candidate.mutualKnn,
    lexicalEvidence: candidate.lexicalEvidence,
  };
}

function assertStageInput(input: VerificationSuggestionStageInput): void {
  if (!input.deckId || !input.workerId.trim()) {
    throw new ValidationError('Verification persistence fence is required');
  }
  if (
    !Number.isInteger(input.attemptCount) ||
    !Number.isInteger(input.maxAttempts) ||
    input.attemptCount < 1 ||
    input.maxAttempts < 1 ||
    input.attemptCount > input.maxAttempts
  ) {
    throw new ValidationError('Invalid verification attempt');
  }
  const fingerprints = new Set<string>();
  for (const candidate of input.candidates) {
    if (
      !/^[a-f0-9]{64}$/.test(candidate.fingerprint) ||
      candidate.candidateId !== candidate.fingerprint ||
      fingerprints.has(candidate.fingerprint)
    ) {
      throw new ValidationError(
        'Verification candidates require unique stable fingerprints',
      );
    }
    fingerprints.add(candidate.fingerprint);
  }
}

function isResumeCacheHit(
  suggestion: ExistingVerifierSuggestion,
  runId: string,
): boolean {
  if (
    suggestion.status === 'pending' ||
    suggestion.status === 'accepted' ||
    suggestion.status === 'dismissed'
  ) {
    return true;
  }
  if (
    suggestion.status === 'rejected' &&
    suggestion.decision === 'none'
  ) {
    return true;
  }
  return (
    suggestion.status === 'rejected' &&
    suggestion.decision === 'abstain' &&
    suggestion.runId === runId
  );
}

function persistenceRecord(
  input: VerificationSuggestionStageInput,
  candidate: VerificationSuggestionCandidate,
  verdict: Awaited<
    ReturnType<typeof verifyRelationshipCandidates>
  >['verdicts'][number],
): PersistedVerifierSuggestion {
  return {
    runId: input.runId,
    userId: input.userId,
    sourceCardId: candidate.source.cardId,
    targetCardId: candidate.target.cardId,
    sourceSenseId: candidate.source.senseId,
    targetSenseId: candidate.target.senseId,
    sourceArtifact: candidate.source.artifact,
    targetArtifact: candidate.target.artifact,
    sourceContentHash: candidate.source.contentHash,
    targetContentHash: candidate.target.contentHash,
    decision: verdict.decision,
    relationType: verdict.relationType,
    direction: verdict.direction,
    confidenceBand: verdict.confidenceBand,
    reason: verdict.reason,
    evidence: verdict.evidence,
    retrievalSimilarity: candidate.retrievalSimilarity,
    mutualKnn: candidate.mutualKnn,
    fingerprint: candidate.fingerprint,
    status: verdict.decision === 'relation' ? 'pending' : 'rejected',
  };
}

export async function verifyAndPersistRelationshipSuggestions(
  input: VerificationSuggestionStageInput,
  repository: SuggestionPersistenceRepository,
  provider: VerifierStructuredProvider,
  signal?: AbortSignal,
): Promise<VerificationSuggestionStageResult> {
  assertStageInput(input);
  const existing =
    input.candidates.length === 0
      ? []
      : await repository.loadExistingSuggestions(
          input.userId,
          input.candidates.map((candidate) => candidate.fingerprint),
        );
  const existingByFingerprint = new Map(
    existing.map((suggestion) => [suggestion.fingerprint, suggestion]),
  );
  const uncached = input.candidates.filter((candidate) => {
    const suggestion = existingByFingerprint.get(candidate.fingerprint);
    return !suggestion || !isResumeCacheHit(suggestion, input.runId);
  });
  const cached = input.candidates.length - uncached.length;

  const verification = await verifyRelationshipCandidates(
    uncached,
    provider,
    signal,
  );
  const candidateById = new Map(
    uncached.map((candidate) => [candidate.candidateId, candidate]),
  );
  const records = verification.verdicts.map((verdict) => {
    const candidate = candidateById.get(verdict.candidateId);
    if (!candidate) {
      throw new ValidationError(
        'Verified suggestion no longer matches its candidate',
      );
    }
    return persistenceRecord(input, candidate, verdict);
  });
  if (signal?.aborted) {
    throw signal.reason ?? new Error('Knowledge graph verification aborted');
  }
  const persistence = await repository.persistSuggestions(
    {
      runId: input.runId,
      userId: input.userId,
      deckId: input.deckId,
      workerId: input.workerId,
    },
    records,
  );
  const persisted = persistence.persisted;
  const suggestions = persistence.pending;

  const retryableFailure =
    input.attemptCount < input.maxAttempts
      ? (verification.retryableFailures[0] ?? null)
      : null;

  const verified = cached + verification.verdicts.length;
  const progress = {
    verified,
    suggestions,
    unresolved: verification.unresolvedCandidateIds.length,
  };
  return {
    nextStage: 'persistence',
    partial: verification.partial,
    retryableFailure,
    cached,
    persisted,
    suggestions,
    unresolvedCandidateIds: verification.unresolvedCandidateIds,
    progress,
    statsPatch: {
      verifierRequests: verification.stats.verifierRequests,
      verified,
      suggestions,
      schemaInvalid: verification.stats.schemaInvalid,
      timeouts: verification.stats.timeouts,
      providerErrors: verification.stats.providerErrors,
      missingRetries: verification.stats.missingRetries,
      inputTokens: verification.stats.inputTokens,
      outputTokens: verification.stats.outputTokens,
    },
  };
}
