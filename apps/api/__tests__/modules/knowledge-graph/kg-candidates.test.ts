import { describe, expect, it } from 'bun:test';

import {
  calculateCandidateBudget,
  canonicalizeDirectedCandidates,
  generateDeckCandidates,
  selectVerificationCandidates,
  type CandidateEndpoint,
  type CandidateRepository,
  type CandidateStageInput,
  type DirectedCandidateRow,
} from '../../../src/modules/knowledge-graph/kg-candidates';

const id = (value: number) =>
  `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;

const stageInput: CandidateStageInput = {
  runId: id(900),
  userId: id(901),
  deckId: id(902),
  embeddingModel: 'gemini-embedding-2',
  representationVersion: 'v1',
  promptVersion: 'relations-v1',
  taxonomyVersion: 'taxonomy-v1',
};

function endpoint(value: number, lemma = `term${value}`): CandidateEndpoint {
  return {
    cardId: id(value),
    senseId: id(value + 1_000),
    artifact: {
      cardId: id(value),
      sourceLanguageTag: 'en',
      definitionLanguageTag: 'en',
      lemma,
      normalizedLemma: lemma.toLowerCase(),
      partOfSpeech: 'noun',
      definition: `definition ${value}`,
      normalizedDefinition: `definition ${value}`,
      ipa: null,
      examples: [],
      contentHash: String(value).padStart(64, 'a'),
      representationVersion: 'v1',
    },
  };
}

function directed(
  source: number,
  target: number,
  similarity: number,
  options: {
    sourceLemma?: string;
    targetLemma?: string;
    acceptedRelation?: boolean;
    compatible?: boolean;
  } = {},
): DirectedCandidateRow {
  return {
    source: endpoint(source, options.sourceLemma),
    target: endpoint(target, options.targetLemma),
    similarity,
    compatible: options.compatible ?? true,
    acceptedRelation: options.acceptedRelation ?? false,
  };
}

describe('KG candidate canonicalization', () => {
  it('collapses physical duplicates and reverse neighbors while retaining best similarity and mutual direction evidence', () => {
    const candidates = canonicalizeDirectedCandidates(
      [
        directed(2, 1, 0.7),
        directed(1, 2, 0.8),
        directed(1, 2, 0.95),
      ],
      stageInput,
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      source: { cardId: id(1) },
      target: { cardId: id(2) },
      similarity: 0.95,
      mutualKnn: true,
      retrievedDirections: ['source_to_target', 'target_to_source'],
    });
    expect(candidates[0]!.candidateId).toMatch(/^[a-f0-9]{64}$/);
    expect(candidates[0]!.fingerprint).toBe(candidates[0]!.candidateId);
  });

  it('filters stale metadata, self pairs, same senses, and only the accepted directed orientation before canonicalization', () => {
    const sameSense = directed(5, 6, 0.9);
    sameSense.target.senseId = sameSense.source.senseId;

    const candidates = canonicalizeDirectedCandidates(
      [
        directed(1, 2, 0.99, { acceptedRelation: true }),
        directed(2, 1, 0.98),
        directed(3, 3, 0.97),
        sameSense,
        directed(7, 8, 0.96, { compatible: false }),
      ],
      stageInput,
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      source: { cardId: id(1) },
      target: { cardId: id(2) },
      mutualKnn: false,
      retrievedDirections: ['target_to_source'],
    });
  });

  it('keeps lexical evidence separate from cosine similarity', () => {
    const [sameLemma, sharedToken, none] = canonicalizeDirectedCandidates(
      [
        directed(1, 2, 0.2, {
          sourceLemma: 'run',
          targetLemma: 'run',
        }),
        directed(3, 4, 0.99, {
          sourceLemma: 'family tree',
          targetLemma: 'family member',
        }),
        directed(5, 6, 1, {
          sourceLemma: 'alpha',
          targetLemma: 'omega',
        }),
      ],
      stageInput,
    );

    expect(sameLemma!.lexicalEvidence).toEqual({
      matched: true,
      reason: 'same_normalized_lemma',
    });
    expect(sharedToken!.lexicalEvidence).toEqual({
      matched: true,
      reason: 'shared_lemma_token',
    });
    expect(none!.lexicalEvidence).toEqual({ matched: false, reason: null });
    expect(none!.similarity).toBe(1);
  });

  it('keeps fingerprints stable across runs and retrieval evidence but changes them for hashes or versions', () => {
    const [base] = canonicalizeDirectedCandidates(
      [directed(1, 2, 0.9)],
      stageInput,
    );
    const [newRun] = canonicalizeDirectedCandidates(
      [directed(1, 2, 0.4)],
      { ...stageInput, runId: id(999) },
    );
    const [newDeck] = canonicalizeDirectedCandidates(
      [directed(1, 2, 0.4)],
      { ...stageInput, deckId: id(998) },
    );
    const [reverse] = canonicalizeDirectedCandidates(
      [directed(2, 1, 0.9)],
      stageInput,
    );
    const [mutual] = canonicalizeDirectedCandidates(
      [directed(1, 2, 0.9), directed(2, 1, 0.8)],
      stageInput,
    );
    const changedHashRow = directed(1, 2, 0.9);
    changedHashRow.source.artifact.contentHash = 'b'.repeat(64);
    const [changedHash] = canonicalizeDirectedCandidates(
      [changedHashRow],
      stageInput,
    );
    const [changedVersion] = canonicalizeDirectedCandidates(
      [directed(1, 2, 0.9)],
      { ...stageInput, promptVersion: 'relations-v2' },
    );

    expect(newRun!.fingerprint).toBe(base!.fingerprint);
    expect(newDeck!.fingerprint).toBe(base!.fingerprint);
    expect(reverse!.fingerprint).toBe(base!.fingerprint);
    expect(mutual!.fingerprint).toBe(base!.fingerprint);
    expect(changedHash!.fingerprint).not.toBe(base!.fingerprint);
    expect(changedVersion!.fingerprint).not.toBe(base!.fingerprint);
  });
});

describe('KG candidate coverage ranking', () => {
  it('uses the exact card-count budget bounds', () => {
    expect(calculateCandidateBudget(100)).toBe(60);
    expect(calculateCandidateBudget(500)).toBe(300);
    expect(calculateCandidateBudget(1)).toBe(40);
  });

  it('is stable across shuffled input and covers the Family fixture before dense-cluster extras', () => {
    const rows = [
      directed(1, 2, 0.99),
      directed(1, 3, 0.98),
      directed(2, 3, 0.97),
      directed(4, 5, 0.8),
      directed(6, 7, 0.79),
      directed(7, 8, 0.78),
      directed(8, 9, 0.77),
    ];
    const canonical = canonicalizeDirectedCandidates(rows, stageInput);
    const shuffled = canonicalizeDirectedCandidates(
      [rows[5]!, rows[2]!, rows[6]!, rows[0]!, rows[4]!, rows[1]!, rows[3]!],
      stageInput,
    );

    const first = selectVerificationCandidates(canonical, {
      cardCount: 100,
      limit: 4,
      suppressedFingerprints: new Set(),
    });
    const second = selectVerificationCandidates(shuffled, {
      cardCount: 100,
      limit: 4,
      suppressedFingerprints: new Set(),
    });

    expect(first.candidates.map((candidate) => candidate.candidateId)).toEqual(
      second.candidates.map((candidate) => candidate.candidateId),
    );
    expect(first.coveredNodeCount).toBe(8);
    expect(
      first.candidates.filter(
        (candidate) =>
          candidate.source.cardId <= id(3) && candidate.target.cardId <= id(3),
      ),
    ).toHaveLength(1);
  });

  it('covers all 98 Family cards inside the production verification budget', () => {
    const canonical = canonicalizeDirectedCandidates(
      Array.from({ length: 98 }, (_, index) =>
        directed(index + 1, ((index + 1) % 98) + 1, 1 - index * 0.001),
      ),
      stageInput,
    );

    const result = selectVerificationCandidates(canonical, {
      cardCount: 98,
      suppressedFingerprints: new Set(),
    });

    expect(result.budget).toBe(59);
    expect(result.candidates.length).toBeLessThanOrEqual(result.budget);
    expect(result.coveredNodeCount).toBe(98);
  });

  it('orders equal-coverage pairs by mutual, lexical, similarity, then canonical UUIDs', () => {
    const canonical = canonicalizeDirectedCandidates(
      [
        directed(1, 2, 0.99),
        directed(3, 4, 0.1),
        directed(4, 3, 0.1),
        directed(5, 6, 0.2, {
          sourceLemma: 'family tree',
          targetLemma: 'family member',
        }),
        directed(9, 10, 0.2),
        directed(7, 8, 0.2),
      ],
      stageInput,
    );

    const result = selectVerificationCandidates(canonical, {
      cardCount: 100,
      limit: 5,
      suppressedFingerprints: new Set(),
    });

    expect(
      result.candidates.map((candidate) => candidate.source.cardId),
    ).toEqual([id(3), id(5), id(1), id(7), id(9)]);
  });

  it('permits the documented star exception only to cover otherwise unreachable leaves', () => {
    const canonical = canonicalizeDirectedCandidates(
      Array.from({ length: 7 }, (_, index) =>
        directed(1, index + 2, 0.9 - index * 0.01),
      ),
      stageInput,
    );

    const result = selectVerificationCandidates(canonical, {
      cardCount: 100,
      limit: 7,
      suppressedFingerprints: new Set(),
    });

    expect(result.candidates).toHaveLength(7);
    expect(result.coveredNodeCount).toBe(8);
    expect(
      result.candidates.filter(
        (candidate) =>
          candidate.source.cardId === id(1) ||
          candidate.target.cardId === id(1),
      ),
    ).toHaveLength(7);
  });

  it('does not spend a coverage slot on a dense edge while a node only has capped-hub alternatives', () => {
    const canonical = canonicalizeDirectedCandidates(
      [
        ...Array.from({ length: 4 }, (_, index) =>
          directed(1, index + 3, 0.99 - index * 0.01),
        ),
        ...Array.from({ length: 4 }, (_, index) =>
          directed(2, index + 7, 0.95 - index * 0.01),
        ),
        directed(1, 11, 0.5),
        directed(2, 11, 0.49),
        directed(3, 4, 0.48),
      ],
      stageInput,
    );

    const result = selectVerificationCandidates(canonical, {
      cardCount: 100,
      limit: 9,
      suppressedFingerprints: new Set(),
    });

    expect(result.coveredNodeCount).toBe(11);
    expect(
      result.candidates.some(
        (candidate) =>
          candidate.source.cardId === id(11) ||
          candidate.target.cardId === id(11),
      ),
    ).toBe(true);
    expect(
      result.candidates.some(
        (candidate) =>
          candidate.source.cardId === id(3) &&
          candidate.target.cardId === id(4),
      ),
    ).toBe(false);
  });

  it('applies exact fingerprint suppressions before filling the budget', () => {
    const canonical = canonicalizeDirectedCandidates(
      Array.from({ length: 45 }, (_, index) =>
        directed(index * 2 + 1, index * 2 + 2, 1 - index * 0.001),
      ),
      stageInput,
    );
    const suppressed = new Set(
      canonical.slice(0, 5).map((candidate) => candidate.fingerprint),
    );

    const result = selectVerificationCandidates(canonical, {
      cardCount: 1,
      suppressedFingerprints: suppressed,
    });

    expect(result.budget).toBe(40);
    expect(result.candidates).toHaveLength(40);
    expect(
      result.candidates.some((candidate) =>
        suppressed.has(candidate.fingerprint),
      ),
    ).toBe(false);
  });
});

describe('KG candidates stage', () => {
  it('loads current suppressions before budget and returns verification progress/stats', async () => {
    const rows = [
      directed(1, 2, 0.9),
      directed(2, 1, 0.91),
      directed(3, 4, 0.8),
    ];
    let suppressionInputCount = 0;
    const repository: CandidateRepository = {
      retrieveDirectedCandidates: async () => ({
        cardCount: 100,
        fallbackSourceCount: 3,
        rows,
      }),
      loadSuppressedFingerprints: async (_input, candidates) => {
        suppressionInputCount = candidates.length;
        return new Set([candidates[0]!.fingerprint]);
      },
    };

    const result = await generateDeckCandidates(stageInput, repository);

    expect(suppressionInputCount).toBe(2);
    expect(result.nextStage).toBe('verification');
    expect(result.candidates).toHaveLength(1);
    expect(result.progress).toEqual({
      candidateCount: 1,
      coveredNodeCount: 2,
      candidateBudget: 60,
    });
    expect(result.statsPatch).toEqual({
      ...result.progress,
      candidateFallbackSources: 3,
    });
  });
});
