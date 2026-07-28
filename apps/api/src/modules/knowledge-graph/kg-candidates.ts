import { createHash } from 'node:crypto';

import type { VocabularyArtifact } from './vocabulary-artifact';

const MAX_VERIFICATION_BUDGET = 300;
const MIN_VERIFICATION_BUDGET = 40;
const INCIDENT_CAP = 4;

export type CandidateDirection =
  | 'source_to_target'
  | 'target_to_source';

export type CandidateLexicalEvidence = {
  matched: boolean;
  reason: 'same_normalized_lemma' | 'shared_lemma_token' | null;
};

export type CandidateEndpoint = {
  cardId: string;
  senseId: string;
  artifact: VocabularyArtifact;
};

export type DirectedCandidateRow = {
  source: CandidateEndpoint;
  target: CandidateEndpoint;
  similarity: number;
  compatible: boolean;
  acceptedRelation: boolean;
};

export type CanonicalCandidate = {
  candidateId: string;
  fingerprint: string;
  source: CandidateEndpoint;
  target: CandidateEndpoint;
  similarity: number;
  mutualKnn: boolean;
  retrievedDirections: CandidateDirection[];
  lexicalEvidence: CandidateLexicalEvidence;
};

export type CandidateStageInput = {
  runId: string;
  userId: string;
  deckId: string;
  embeddingModel: string;
  representationVersion: string;
  promptVersion: string;
  taxonomyVersion: string;
};

export type CandidateRetrieval = {
  cardCount: number;
  /**
   * Number of source cards whose global HNSW scan could not fill the requested
   * in-deck neighborhood and therefore required the exact deck-local fallback.
   * Optional keeps injectable repositories source-compatible; production
   * PostgreSQL retrieval always supplies it.
   */
  fallbackSourceCount?: number;
  rows: DirectedCandidateRow[];
};

export type CandidateRepository = {
  retrieveDirectedCandidates(
    input: CandidateStageInput,
  ): Promise<CandidateRetrieval>;
  loadSuppressedFingerprints(
    input: CandidateStageInput,
    candidates: CanonicalCandidate[],
  ): Promise<Set<string>>;
};

export type CandidateSelection = {
  candidates: CanonicalCandidate[];
  budget: number;
  coveredNodeCount: number;
};

type CanonicalCandidateAccumulator = {
  source: CandidateEndpoint;
  target: CandidateEndpoint;
  similarity: number;
  directions: Set<CandidateDirection>;
};

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function candidateFingerprint(
  input: CandidateStageInput,
  source: CandidateEndpoint,
  target: CandidateEndpoint,
): string {
  return createHash('sha256')
    .update(
      canonicalJson({
        kind: 'kg-relation-candidate-v1',
        userId: input.userId,
        sourceCardId: source.cardId,
        targetCardId: target.cardId,
        sourceSenseId: source.senseId,
        targetSenseId: target.senseId,
        sourceContentHash: source.artifact.contentHash,
        targetContentHash: target.artifact.contentHash,
        embeddingModel: input.embeddingModel,
        representationVersion: input.representationVersion,
        promptVersion: input.promptVersion,
        taxonomyVersion: input.taxonomyVersion,
      }),
    )
    .digest('hex');
}

function lexicalTokens(value: string): Set<string> {
  return new Set(
    (value.match(/[\p{L}\p{N}]+/gu) ?? []).filter(
      (token) => [...token].length >= 3,
    ),
  );
}

function lexicalEvidence(
  source: CandidateEndpoint,
  target: CandidateEndpoint,
): CandidateLexicalEvidence {
  if (
    source.artifact.normalizedLemma &&
    source.artifact.normalizedLemma === target.artifact.normalizedLemma
  ) {
    return { matched: true, reason: 'same_normalized_lemma' };
  }

  const sourceTokens = lexicalTokens(source.artifact.normalizedLemma);
  const targetTokens = lexicalTokens(target.artifact.normalizedLemma);
  if ([...sourceTokens].some((token) => targetTokens.has(token))) {
    return { matched: true, reason: 'shared_lemma_token' };
  }
  return { matched: false, reason: null };
}

function compareEndpointPair(
  left: Pick<CanonicalCandidate, 'source' | 'target'>,
  right: Pick<CanonicalCandidate, 'source' | 'target'>,
): number {
  if (left.source.cardId < right.source.cardId) return -1;
  if (left.source.cardId > right.source.cardId) return 1;
  if (left.target.cardId < right.target.cardId) return -1;
  if (left.target.cardId > right.target.cardId) return 1;
  return 0;
}

function directedRowKey(row: DirectedCandidateRow): string {
  return [
    row.source.cardId,
    row.source.senseId,
    row.target.cardId,
    row.target.senseId,
  ].join(':');
}

function canonicalPair(
  row: DirectedCandidateRow,
): {
  source: CandidateEndpoint;
  target: CandidateEndpoint;
  direction: CandidateDirection;
} {
  if (row.source.cardId < row.target.cardId) {
    return {
      source: row.source,
      target: row.target,
      direction: 'source_to_target',
    };
  }
  return {
    source: row.target,
    target: row.source,
    direction: 'target_to_source',
  };
}

export function canonicalizeDirectedCandidates(
  rows: DirectedCandidateRow[],
  input: CandidateStageInput,
): CanonicalCandidate[] {
  const bestDirectedRows = new Map<string, DirectedCandidateRow>();
  for (const row of rows) {
    if (
      !row.compatible ||
      row.acceptedRelation ||
      !Number.isFinite(row.similarity) ||
      row.source.cardId === row.target.cardId ||
      row.source.senseId === row.target.senseId
    ) {
      continue;
    }
    const key = directedRowKey(row);
    const existing = bestDirectedRows.get(key);
    if (!existing || row.similarity > existing.similarity) {
      bestDirectedRows.set(key, row);
    }
  }

  const pairAccumulators = new Map<string, CanonicalCandidateAccumulator>();
  for (const row of bestDirectedRows.values()) {
    const pair = canonicalPair(row);
    const key = [
      pair.source.cardId,
      pair.source.senseId,
      pair.target.cardId,
      pair.target.senseId,
    ].join(':');
    const existing = pairAccumulators.get(key);
    if (existing) {
      existing.similarity = Math.max(existing.similarity, row.similarity);
      existing.directions.add(pair.direction);
    } else {
      pairAccumulators.set(key, {
        source: pair.source,
        target: pair.target,
        similarity: row.similarity,
        directions: new Set([pair.direction]),
      });
    }
  }

  return [...pairAccumulators.values()]
    .map((candidate) => {
      const retrievedDirections = [...candidate.directions].sort(
        (left, right) =>
          left === right ? 0 : left === 'source_to_target' ? -1 : 1,
      );
      const fingerprint = candidateFingerprint(
        input,
        candidate.source,
        candidate.target,
      );
      return {
        candidateId: fingerprint,
        fingerprint,
        source: candidate.source,
        target: candidate.target,
        similarity: Math.max(0, Math.min(1, candidate.similarity)),
        mutualKnn: retrievedDirections.length === 2,
        retrievedDirections,
        lexicalEvidence: lexicalEvidence(candidate.source, candidate.target),
      };
    })
    .sort(compareEndpointPair);
}

export function calculateCandidateBudget(cardCount: number): number {
  const normalizedCount = Math.max(0, Math.floor(cardCount));
  return Math.min(
    MAX_VERIFICATION_BUDGET,
    Math.max(MIN_VERIFICATION_BUDGET, Math.ceil(normalizedCount * 0.6)),
  );
}

function incident(
  candidate: CanonicalCandidate,
  cardId: string,
): boolean {
  return (
    candidate.source.cardId === cardId || candidate.target.cardId === cardId
  );
}

function uncoveredEndpointCount(
  candidate: CanonicalCandidate,
  covered: ReadonlySet<string>,
): number {
  return (
    Number(!covered.has(candidate.source.cardId)) +
    Number(!covered.has(candidate.target.cardId))
  );
}

function compareRankedCandidates(
  left: CanonicalCandidate,
  right: CanonicalCandidate,
  covered: ReadonlySet<string>,
): number {
  const leftCoverage = uncoveredEndpointCount(left, covered);
  const rightCoverage = uncoveredEndpointCount(right, covered);
  if (leftCoverage !== rightCoverage) return rightCoverage - leftCoverage;
  if (left.mutualKnn !== right.mutualKnn) {
    return Number(right.mutualKnn) - Number(left.mutualKnn);
  }
  if (left.lexicalEvidence.matched !== right.lexicalEvidence.matched) {
    return (
      Number(right.lexicalEvidence.matched) -
      Number(left.lexicalEvidence.matched)
    );
  }
  if (left.similarity !== right.similarity) {
    return right.similarity - left.similarity;
  }
  return compareEndpointPair(left, right);
}

function isSoleRemainingCoverageEdge(
  candidate: CanonicalCandidate,
  remaining: CanonicalCandidate[],
  covered: ReadonlySet<string>,
): boolean {
  for (const cardId of [
    candidate.source.cardId,
    candidate.target.cardId,
  ]) {
    if (covered.has(cardId)) continue;
    if (
      remaining.filter((remainingCandidate) =>
        incident(remainingCandidate, cardId),
      ).length === 1
    ) {
      return true;
    }
  }
  return false;
}

export function selectVerificationCandidates(
  candidates: CanonicalCandidate[],
  options: {
    cardCount: number;
    suppressedFingerprints: ReadonlySet<string>;
    limit?: number;
  },
): CandidateSelection {
  const budget = calculateCandidateBudget(options.cardCount);
  const eligible = candidates.filter(
    (candidate) =>
      !options.suppressedFingerprints.has(candidate.fingerprint),
  );
  const selectionLimit = Math.min(
    budget,
    Math.max(0, Math.floor(options.limit ?? budget)),
    eligible.length,
  );
  const remaining = [...eligible];
  const selected: CanonicalCandidate[] = [];
  const covered = new Set<string>();
  const incidentCounts = new Map<string, number>();
  const coverableNodes = new Set(
    eligible.flatMap((candidate) => [
      candidate.source.cardId,
      candidate.target.cardId,
    ]),
  );
  let enforceIncidentCap = true;

  while (selected.length < selectionLimit && remaining.length > 0) {
    remaining.sort((left, right) =>
      compareRankedCandidates(left, right, covered),
    );
    const allCoverableNodesCovered = [...coverableNodes].every((cardId) =>
      covered.has(cardId),
    );
    if (allCoverableNodesCovered) enforceIncidentCap = false;

    let selectedIndex = remaining.findIndex((candidate) => {
      if (!enforceIncidentCap) return true;
      if (uncoveredEndpointCount(candidate, covered) === 0) return false;
      const sourceCount = incidentCounts.get(candidate.source.cardId) ?? 0;
      const targetCount = incidentCounts.get(candidate.target.cardId) ?? 0;
      if (sourceCount < INCIDENT_CAP && targetCount < INCIDENT_CAP) return true;
      return isSoleRemainingCoverageEdge(candidate, remaining, covered);
    });

    if (selectedIndex < 0) {
      const uncoveredIndex = remaining.findIndex(
        (candidate) => uncoveredEndpointCount(candidate, covered) > 0,
      );
      if (uncoveredIndex >= 0) {
        // Every remaining route to this endpoint is incident on a saturated
        // node. Preserve the coverage-first contract by taking the
        // deterministically best route before any zero-coverage dense edge.
        selectedIndex = uncoveredIndex;
      } else {
        enforceIncidentCap = false;
        selectedIndex = 0;
      }
    }

    const [candidate] = remaining.splice(selectedIndex, 1);
    if (!candidate) break;
    selected.push(candidate);
    for (const cardId of [
      candidate.source.cardId,
      candidate.target.cardId,
    ]) {
      covered.add(cardId);
      incidentCounts.set(cardId, (incidentCounts.get(cardId) ?? 0) + 1);
    }
  }

  return {
    candidates: selected,
    budget,
    coveredNodeCount: covered.size,
  };
}

export async function generateDeckCandidates(
  input: CandidateStageInput,
  repository: CandidateRepository,
): Promise<{
  candidates: CanonicalCandidate[];
  nextStage: 'verification';
  progress: {
    candidateCount: number;
    coveredNodeCount: number;
    candidateBudget: number;
  };
  statsPatch: {
    candidateCount: number;
    coveredNodeCount: number;
    candidateBudget: number;
    candidateFallbackSources: number;
  };
}> {
  const retrieval = await repository.retrieveDirectedCandidates(input);
  const canonical = canonicalizeDirectedCandidates(retrieval.rows, input);
  const suppressedFingerprints =
    await repository.loadSuppressedFingerprints(input, canonical);
  const selection = selectVerificationCandidates(canonical, {
    cardCount: retrieval.cardCount,
    suppressedFingerprints,
  });
  const progress = {
    candidateCount: selection.candidates.length,
    coveredNodeCount: selection.coveredNodeCount,
    candidateBudget: selection.budget,
  };
  return {
    candidates: selection.candidates,
    nextStage: 'verification',
    progress,
    statsPatch: {
      ...progress,
      candidateFallbackSources: Math.max(
        0,
        Math.floor(retrieval.fallbackSourceCount ?? 0),
      ),
    },
  };
}
