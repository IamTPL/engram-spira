import { describe, expect, test } from 'bun:test';

import {
  buildVerifierArtifactMaterial,
  toVerificationSuggestionCandidate,
  verifyAndPersistRelationshipSuggestions,
  type ExistingVerifierSuggestion,
  type SuggestionPersistenceRepository,
  type VerificationSuggestionCandidate,
} from '../../../src/modules/knowledge-graph/kg-verification.service';
import type { CanonicalCandidate } from '../../../src/modules/knowledge-graph/kg-candidates';
import type {
  GeminiResult,
  GeminiStructuredRequest,
} from '../../../src/modules/ai/gemini-provider';
import type {
  RelationVerdict,
  VerifierStructuredProvider,
} from '../../../src/modules/knowledge-graph/kg-verifier';

const id = (value: number) =>
  `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;

function candidate(index: number): VerificationSuggestionCandidate {
  const sourceArtifact = {
    cardId: id(index * 2 + 1),
    sourceLanguageTag: 'en',
    definitionLanguageTag: 'vi',
    lemma: `source ${index}`,
    normalizedLemma: `source ${index}`,
    partOfSpeech: 'noun',
    definition: `nghĩa nguồn ${index}`,
    normalizedDefinition: `nghĩa nguồn ${index}`,
    ipa: null,
    examples: [],
    contentHash: String(index * 2 + 1).padStart(64, 'a'),
    representationVersion: 'v1' as const,
  };
  const targetArtifact = {
    cardId: id(index * 2 + 2),
    sourceLanguageTag: 'en',
    definitionLanguageTag: 'vi',
    lemma: `target ${index}`,
    normalizedLemma: `target ${index}`,
    partOfSpeech: 'noun',
    definition: `nghĩa đích ${index}`,
    normalizedDefinition: `nghĩa đích ${index}`,
    ipa: null,
    examples: [],
    contentHash: String(index * 2 + 2).padStart(64, 'b'),
    representationVersion: 'v1' as const,
  };
  return {
    candidateId: String(index).padStart(64, 'c'),
    fingerprint: String(index).padStart(64, 'c'),
    source: {
      cardId: sourceArtifact.cardId,
      senseId: id(10_000 + index * 2 + 1),
      contentHash: sourceArtifact.contentHash,
      material: `${sourceArtifact.lemma}\n${sourceArtifact.partOfSpeech}\n${sourceArtifact.definition}`,
      artifact: sourceArtifact,
    },
    target: {
      cardId: targetArtifact.cardId,
      senseId: id(10_000 + index * 2 + 2),
      contentHash: targetArtifact.contentHash,
      material: `${targetArtifact.lemma}\n${targetArtifact.partOfSpeech}\n${targetArtifact.definition}`,
      artifact: targetArtifact,
    },
    retrievalSimilarity: 0.91,
    mutualKnn: true,
    lexicalEvidence: {
      matched: false,
      reason: null,
    },
  };
}

function verdict(
  item: VerificationSuggestionCandidate,
  overrides: Partial<RelationVerdict> = {},
): RelationVerdict {
  return {
    candidateId: item.candidateId,
    decision: 'relation',
    relationType: 'synonym',
    direction: 'symmetric',
    confidenceBand: 'high',
    reason: 'The supplied definitions overlap.',
    evidence: {
      source: item.source.artifact.definition,
      target: item.target.artifact.definition,
    },
    ...overrides,
  };
}

function input(
  candidates: VerificationSuggestionCandidate[],
  overrides: {
    attemptCount?: number;
    maxAttempts?: number;
  } = {},
) {
  return {
    runId: id(900),
    userId: id(901),
    deckId: id(902),
    workerId: 'kg-worker-test',
    candidates,
    attemptCount: overrides.attemptCount ?? 1,
    maxAttempts: overrides.maxAttempts ?? 5,
  };
}

function repository(
  existing: ExistingVerifierSuggestion[] = [],
): SuggestionPersistenceRepository & {
  persisted: Parameters<SuggestionPersistenceRepository['persistSuggestions']>[1][];
} {
  const persisted: Parameters<
    SuggestionPersistenceRepository['persistSuggestions']
  >[1][] = [];
  return {
    persisted,
    async loadExistingSuggestions() {
      return existing;
    },
    async persistSuggestions(_fence, records) {
      if (records.length > 0) persisted.push(records);
      return {
        persisted: records.length,
        pending:
          existing.filter(
            (suggestion) =>
              suggestion.status === 'pending' &&
              suggestion.decision === 'relation',
          ).length +
          records.filter((record) => record.status === 'pending').length,
      };
    },
  };
}

function provider(
  resolve: (request: { prompt: string }) => unknown,
): VerifierStructuredProvider & { calls: number } {
  const result = {
    calls: 0,
    async generateStructured<T>(
      request: GeminiStructuredRequest<T>,
    ): Promise<GeminiResult<T>> {
      result.calls++;
      const value = resolve(request);
      if (value instanceof Error) throw value;
      return {
        value: request.parse(value),
        usage: { inputTokens: 11, outputTokens: 7 },
      };
    },
  };
  return result;
}

function candidateVerdictsFromPrompt(
  candidates: VerificationSuggestionCandidate[],
  prompt: string,
) {
  return candidates
    .filter((item) => prompt.includes(item.candidateId))
    .map((item) => verdict(item));
}

describe('KG verification suggestion stage', () => {
  test('maps retrieval candidates to compact deterministic verifier material', () => {
    const item = candidate(1);
    const canonical: CanonicalCandidate = {
      candidateId: item.candidateId,
      fingerprint: item.fingerprint,
      source: {
        cardId: item.source.cardId!,
        senseId: item.source.senseId!,
        artifact: item.source.artifact,
      },
      target: {
        cardId: item.target.cardId!,
        senseId: item.target.senseId!,
        artifact: item.target.artifact,
      },
      similarity: item.retrievalSimilarity,
      mutualKnn: item.mutualKnn,
      retrievedDirections: ['source_to_target', 'target_to_source'],
      lexicalEvidence: item.lexicalEvidence,
    };

    const mapped = toVerificationSuggestionCandidate(canonical);

    expect(mapped).toMatchObject({
      candidateId: canonical.candidateId,
      fingerprint: canonical.fingerprint,
      retrievalSimilarity: canonical.similarity,
      mutualKnn: true,
    });
    expect(mapped.source.material).toBe(
      buildVerifierArtifactMaterial(canonical.source.artifact),
    );
    expect(mapped.source.material).toContain(
      canonical.source.artifact.definition,
    );
    expect(mapped.source.material).not.toContain(
      canonical.source.artifact.contentHash,
    );
  });

  test('uses pending/current-none cache with zero provider calls, but never negative-caches an old abstain', async () => {
    const candidates = [candidate(1), candidate(2), candidate(3)];
    const existing: ExistingVerifierSuggestion[] = [
      {
        fingerprint: candidates[0].fingerprint,
        runId: id(800),
        decision: 'relation',
        status: 'pending',
      },
      {
        fingerprint: candidates[1].fingerprint,
        runId: id(801),
        decision: 'none',
        status: 'rejected',
      },
      {
        fingerprint: candidates[2].fingerprint,
        runId: id(802),
        decision: 'abstain',
        status: 'rejected',
      },
    ];
    const store = repository(existing);
    const gemini = provider((request) =>
      candidateVerdictsFromPrompt(candidates, request.prompt),
    );

    const result = await verifyAndPersistRelationshipSuggestions(
      input(candidates),
      store,
      gemini,
    );

    expect(gemini.calls).toBe(1);
    expect(result.cached).toBe(2);
    expect(result.persisted).toBe(1);
    expect(store.persisted[0]?.[0]).toMatchObject({
      fingerprint: candidates[2].fingerprint,
      status: 'pending',
      retrievalSimilarity: 0.91,
      mutualKnn: true,
      confidenceBand: 'high',
    });
  });

  test('treats an abstain already persisted by the same run as a resume cache hit', async () => {
    const item = candidate(1);
    const store = repository([
      {
        fingerprint: item.fingerprint,
        runId: id(900),
        decision: 'abstain',
        status: 'rejected',
      },
    ]);
    const gemini = provider(() => {
      throw new Error('provider must not be called');
    });

    const result = await verifyAndPersistRelationshipSuggestions(
      input([item]),
      store,
      gemini,
    );

    expect(gemini.calls).toBe(0);
    expect(result.cached).toBe(1);
    expect(result.persisted).toBe(0);
    expect(result.partial).toBe(false);
  });

  test('reattaches and counts an existing pending deck suggestion when no candidate needs verification', async () => {
    const store = repository([
      {
        fingerprint: '1'.repeat(64),
        runId: id(800),
        decision: 'relation',
        status: 'pending',
      },
    ]);
    const gemini = provider(() => {
      throw new Error('provider must not be called');
    });

    const result = await verifyAndPersistRelationshipSuggestions(
      input([]),
      store,
      gemini,
    );

    expect(result).toMatchObject({
      cached: 0,
      persisted: 0,
      suggestions: 1,
      progress: {
        verified: 0,
        suggestions: 1,
        unresolved: 0,
      },
      statsPatch: {
        verifierRequests: 0,
        suggestions: 1,
      },
    });
    expect(gemini.calls).toBe(0);
  });

  test('persists relation as pending and none/abstain as rejected without blending signals', async () => {
    const candidates = [candidate(1), candidate(2), candidate(3)];
    const store = repository();
    const gemini = provider(() => [
      verdict(candidates[0]),
      verdict(candidates[1], {
        decision: 'none',
        relationType: null,
        direction: null,
        evidence: null,
        confidenceBand: 'medium',
      }),
      verdict(candidates[2], {
        decision: 'abstain',
        relationType: null,
        direction: null,
        evidence: null,
        confidenceBand: 'low',
      }),
    ]);

    const result = await verifyAndPersistRelationshipSuggestions(
      input(candidates),
      store,
      gemini,
    );

    expect(result).toMatchObject({
      partial: false,
      persisted: 3,
      suggestions: 1,
      statsPatch: {
        verifierRequests: 1,
        verified: 3,
        suggestions: 1,
        inputTokens: 11,
        outputTokens: 7,
      },
    });
    expect(store.persisted[0]?.map((record) => record.status)).toEqual([
      'pending',
      'rejected',
      'rejected',
    ]);
    expect(store.persisted[0]?.[0]).toMatchObject({
      sourceArtifact: candidates[0].source.artifact,
      targetArtifact: candidates[0].target.artifact,
      sourceContentHash: candidates[0].source.contentHash,
      targetContentHash: candidates[0].target.contentHash,
      retrievalSimilarity: candidates[0].retrievalSimilarity,
      mutualKnn: candidates[0].mutualKnn,
    });
    expect(store.persisted[0]?.[0]).not.toHaveProperty('confidence');
  });

  test('persists valid verdicts and returns partial when a missing retry is exhausted', async () => {
    const candidates = [candidate(1), candidate(2)];
    let call = 0;
    const gemini = provider(() => {
      call++;
      return call === 1 ? [verdict(candidates[0])] : [];
    });
    const store = repository();

    const result = await verifyAndPersistRelationshipSuggestions(
      input(candidates),
      store,
      gemini,
    );

    expect(result.partial).toBe(true);
    expect(result.unresolvedCandidateIds).toEqual([
      candidates[1].candidateId,
    ]);
    expect(result.persisted).toBe(1);
    expect(store.persisted[0]?.[0]?.fingerprint).toBe(
      candidates[0].fingerprint,
    );
  });

  test('returns retryable 5xx with complete attempt stats after persisting successful batches', async () => {
    const candidates = Array.from({ length: 26 }, (_, index) =>
      candidate(index + 1),
    );
    const store = repository();
    const transient = Object.assign(new Error('provider unavailable'), {
      status: 503,
    });
    const failingCandidate = [...candidates].sort((left, right) =>
      left.candidateId.localeCompare(right.candidateId),
    ).at(-1)!;
    const gemini = provider((request) =>
      request.prompt.includes(failingCandidate.candidateId)
        ? transient
        : candidateVerdictsFromPrompt(candidates, request.prompt),
    );

    const result = await verifyAndPersistRelationshipSuggestions(
      input(candidates, { attemptCount: 1, maxAttempts: 5 }),
      store,
      gemini,
    );

    expect(result.retryableFailure).toBe(transient);
    expect(result.statsPatch).toMatchObject({
      verifierRequests: 2,
      verified: 25,
      providerErrors: 1,
      inputTokens: null,
      outputTokens: null,
    });
    expect(store.persisted.flat().length).toBeGreaterThan(0);
    expect(store.persisted.flat().length).toBeLessThan(candidates.length);
  });

  test('returns partial instead of throwing after the final provider attempt', async () => {
    const item = candidate(1);
    const store = repository();
    const gemini = provider(() =>
      Object.assign(new Error('provider unavailable'), { status: 429 }),
    );

    const result = await verifyAndPersistRelationshipSuggestions(
      input([item], { attemptCount: 5, maxAttempts: 5 }),
      store,
      gemini,
    );

    expect(result.partial).toBe(true);
    expect(result.unresolvedCandidateIds).toEqual([item.candidateId]);
    expect(result.statsPatch.providerErrors).toBe(1);
    expect(result.retryableFailure).toBeNull();
  });

  test('honors cancellation immediately before suggestion persistence', async () => {
    const item = candidate(1);
    const controller = new AbortController();
    const store = repository();
    const gemini = provider(() => {
      controller.abort(new DOMException('cancelled', 'AbortError'));
      return [verdict(item)];
    });

    await expect(
      verifyAndPersistRelationshipSuggestions(
        input([item]),
        store,
        gemini,
        controller.signal,
      ),
    ).rejects.toHaveProperty('name', 'AbortError');
    expect(store.persisted).toEqual([]);
  });
});
