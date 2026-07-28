import { describe, expect, test } from 'bun:test';

import {
  MAX_VERIFIER_INPUT_CHARACTERS,
  RELATION_VERDICT_SCHEMA,
  buildVerifierPrompt,
  parseRelationVerdicts,
  partitionVerifierCandidates,
  verifyRelationshipCandidates,
  type RelationVerdict,
  type VerificationCandidate,
  type VerifierStructuredProvider,
} from '../../../src/modules/knowledge-graph/kg-verifier';
import { GeminiProviderTimeoutError } from '../../../src/modules/ai/gemini-provider';

function candidate(
  index: number,
  options: {
    sourceMaterial?: string;
    targetMaterial?: string;
  } = {},
): VerificationCandidate {
  const suffix = String(index).padStart(4, '0');
  return {
    candidateId: `candidate-${suffix}`,
    source: {
      cardId: `00000000-0000-4000-8000-${suffix.padStart(12, '0')}`,
      senseId: `10000000-0000-4000-8000-${suffix.padStart(12, '0')}`,
      contentHash: 'a'.repeat(64),
      material: options.sourceMaterial ?? `source lemma ${suffix}`,
    },
    target: {
      cardId: `20000000-0000-4000-8000-${suffix.padStart(12, '0')}`,
      senseId: `30000000-0000-4000-8000-${suffix.padStart(12, '0')}`,
      contentHash: 'b'.repeat(64),
      material: options.targetMaterial ?? `target definition ${suffix}`,
    },
    retrievalSimilarity: 0.8,
    mutualKnn: index % 2 === 0,
  };
}

function relationVerdict(
  item: VerificationCandidate,
  overrides: Partial<RelationVerdict> = {},
): RelationVerdict {
  return {
    candidateId: item.candidateId,
    decision: 'relation',
    relationType: 'synonym',
    direction: 'symmetric',
    confidenceBand: 'high',
    reason: 'The meanings overlap.',
    evidence: {
      source: item.source.material,
      target: item.target.material,
    },
    ...overrides,
  };
}

function providerFromResponses(
  responses: Array<unknown | Error>,
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
  } = { inputTokens: 10, outputTokens: 5 },
): VerifierStructuredProvider {
  let index = 0;
  return {
    async generateStructured(request) {
      const response = responses[index++];
      if (response instanceof Error) throw response;
      return {
        value: request.parse(response),
        usage,
      };
    },
  };
}

describe('kg v2 relationship verifier', () => {
  test('partitions deterministically at 25 candidates and 20,000 prompt characters', () => {
    const candidates = Array.from({ length: 61 }, (_, index) =>
      candidate(60 - index),
    );

    const batches = partitionVerifierCandidates(candidates);

    expect(batches.map((batch) => batch.length)).toEqual([25, 25, 11]);
    expect(batches.flat().map((item) => item.candidateId)).toEqual(
      [...candidates]
        .sort((left, right) =>
          left.candidateId.localeCompare(right.candidateId),
        )
        .map((item) => item.candidateId),
    );
    for (const batch of batches) {
      expect(buildVerifierPrompt(batch).length).toBeLessThanOrEqual(
        MAX_VERIFIER_INPUT_CHARACTERS,
      );
    }
  });

  test('keeps the 100-card and 500-card quality gates within request caps', () => {
    expect(
      partitionVerifierCandidates(
        Array.from({ length: 60 }, (_, index) => candidate(index)),
      ),
    ).toHaveLength(3);
    expect(
      partitionVerifierCandidates(
        Array.from({ length: 300 }, (_, index) => candidate(index)),
      ),
    ).toHaveLength(12);
  });

  test('splits on serialized prompt size and rejects one oversized candidate', () => {
    const large = Array.from({ length: 3 }, (_, index) =>
      candidate(index, {
        sourceMaterial: `source-${index}-${'x'.repeat(6_500)}`,
      }),
    );
    const batches = partitionVerifierCandidates(large);
    expect(batches.length).toBeGreaterThan(1);
    for (const batch of batches) {
      expect(buildVerifierPrompt(batch).length).toBeLessThanOrEqual(
        MAX_VERIFIER_INPUT_CHARACTERS,
      );
    }

    expect(() =>
      partitionVerifierCandidates([
        candidate(99, { sourceMaterial: 'x'.repeat(25_000) }),
      ]),
    ).toThrow('exceeds the 20000 character verifier request limit');
  });

  test('publishes an exact closed JSON schema', () => {
    expect(RELATION_VERDICT_SCHEMA).toMatchObject({
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
      },
    });
  });

  test('accepts known valid verdicts and identifies missing candidates without inventing none', () => {
    const candidates = [candidate(1), candidate(2)];
    const parsed = parseRelationVerdicts(
      [relationVerdict(candidates[0])],
      candidates,
    );

    expect(parsed.verdicts).toHaveLength(1);
    expect(parsed.missingCandidateIds).toEqual([candidates[1].candidateId]);
  });

  test.each(['none', 'abstain'] as const)(
    'accepts substring evidence for a %s verdict while keeping relation metadata null',
    (decision) => {
      const item = candidate(1);
      const parsed = parseRelationVerdicts(
        [
          relationVerdict(item, {
            decision,
            relationType: null,
            direction: null,
            evidence: {
              source: item.source.material,
              target: item.target.material,
            },
          }),
        ],
        [item],
      );

      expect(parsed.verdicts[0]).toMatchObject({
        decision,
        relationType: null,
        direction: null,
        evidence: {
          source: item.source.material,
          target: item.target.material,
        },
      });
    },
  );

  test.each([
    {
      name: 'unknown candidate ID',
      mutate: (items: VerificationCandidate[]) => [
        relationVerdict(items[0], { candidateId: 'unknown' }),
      ],
    },
    {
      name: 'duplicate candidate ID',
      mutate: (items: VerificationCandidate[]) => [
        relationVerdict(items[0]),
        relationVerdict(items[0]),
      ],
    },
    {
      name: 'unexpected output property',
      mutate: (items: VerificationCandidate[]) => [
        { ...relationVerdict(items[0]), inventedScore: 0.99 },
      ],
    },
    {
      name: 'unknown relation type',
      mutate: (items: VerificationCandidate[]) => [
        { ...relationVerdict(items[0]), relationType: 'similar' },
      ],
    },
    {
      name: 'none with relation metadata',
      mutate: (items: VerificationCandidate[]) => [
        relationVerdict(items[0], {
          decision: 'none',
          relationType: 'synonym',
          direction: 'symmetric',
          evidence: null,
        }),
      ],
    },
    {
      name: 'symmetric relation with directed orientation',
      mutate: (items: VerificationCandidate[]) => [
        relationVerdict(items[0], { direction: 'source_to_target' }),
      ],
    },
    {
      name: 'directed relation with symmetric orientation',
      mutate: (items: VerificationCandidate[]) => [
        relationVerdict(items[0], {
          relationType: 'is_a',
          direction: 'symmetric',
        }),
      ],
    },
    {
      name: 'hallucinated source evidence',
      mutate: (items: VerificationCandidate[]) => [
        relationVerdict(items[0], {
          evidence: {
            source: 'not present in the source artifact',
            target: items[0].target.material,
          },
        }),
      ],
    },
    {
      name: 'overlong reason',
      mutate: (items: VerificationCandidate[]) => [
        relationVerdict(items[0], { reason: 'r'.repeat(1_001) }),
      ],
    },
  ])('rejects $name', ({ mutate }) => {
    const candidates = [candidate(1)];
    expect(() => parseRelationVerdicts(mutate(candidates), candidates)).toThrow();
  });

  test('retries only missing candidates once and preserves valid first-pass verdicts', async () => {
    const candidates = [candidate(1), candidate(2), candidate(3)];
    const provider = providerFromResponses([
      [
        relationVerdict(candidates[0]),
        relationVerdict(candidates[2], {
          decision: 'none',
          relationType: null,
          direction: null,
          evidence: null,
        }),
      ],
      [relationVerdict(candidates[1])],
    ]);

    const result = await verifyRelationshipCandidates(candidates, provider);

    expect(result.verdicts.map((item) => item.candidateId).sort()).toEqual(
      candidates.map((item) => item.candidateId).sort(),
    );
    expect(result.unresolvedCandidateIds).toEqual([]);
    expect(result.partial).toBe(false);
    expect(result.stats).toMatchObject({
      verifierRequests: 2,
      verified: 3,
      missingRetries: 1,
      inputTokens: 20,
      outputTokens: 10,
    });
  });

  test('missing after the one smaller retry remains unresolved and makes the result partial', async () => {
    const candidates = [candidate(1), candidate(2)];
    const provider = providerFromResponses([
      [relationVerdict(candidates[0])],
      [],
    ]);

    const result = await verifyRelationshipCandidates(candidates, provider);

    expect(result.verdicts.map((item) => item.candidateId)).toEqual([
      candidates[0].candidateId,
    ]);
    expect(result.unresolvedCandidateIds).toEqual([
      candidates[1].candidateId,
    ]);
    expect(result.partial).toBe(true);
    expect(result.stats.missingRetries).toBe(1);
  });

  test('malformed responses remain unresolved and are never converted to none', async () => {
    const candidates = [candidate(1), candidate(2)];
    const provider = providerFromResponses([
      [relationVerdict(candidates[0], { candidateId: 'unknown' })],
    ]);

    const result = await verifyRelationshipCandidates(candidates, provider);

    expect(result.verdicts).toEqual([]);
    expect(result.unresolvedCandidateIds).toEqual(
      candidates.map((item) => item.candidateId),
    );
    expect(result.partial).toBe(true);
    expect(result.stats.schemaInvalid).toBe(1);
  });

  test('distinguishes provider timeouts and transport exhaustion without false negatives', async () => {
    const timeoutItem = candidate(1);
    const timeoutResult = await verifyRelationshipCandidates(
      [timeoutItem],
      providerFromResponses([new GeminiProviderTimeoutError(1_000)]),
    );
    expect(timeoutResult).toMatchObject({
      verdicts: [],
      unresolvedCandidateIds: [timeoutItem.candidateId],
      partial: true,
      stats: {
        verifierRequests: 1,
        timeouts: 1,
        providerErrors: 0,
      },
    });

    const providerItem = candidate(2);
    const providerResult = await verifyRelationshipCandidates(
      [providerItem],
      providerFromResponses([new Error('provider retry exhausted')]),
    );
    expect(providerResult).toMatchObject({
      verdicts: [],
      unresolvedCandidateIds: [providerItem.candidateId],
      partial: true,
      stats: {
        verifierRequests: 1,
        timeouts: 0,
        providerErrors: 1,
      },
    });
  });

  test('propagates caller cancellation instead of converting it to partial', async () => {
    const controller = new AbortController();
    controller.abort(new DOMException('cancelled', 'AbortError'));
    const provider = providerFromResponses([new Error('transport aborted')]);

    await expect(
      verifyRelationshipCandidates([candidate(1)], provider, controller.signal),
    ).rejects.toHaveProperty('name', 'AbortError');
  });

  test('runs at most two structured Gemini requests concurrently', async () => {
    const candidates = Array.from({ length: 75 }, (_, index) => candidate(index));
    let active = 0;
    let maximumActive = 0;
    const provider: VerifierStructuredProvider = {
      async generateStructured(request) {
        active++;
        maximumActive = Math.max(maximumActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        const promptCandidates = candidates.filter((item) =>
          request.prompt.includes(item.candidateId),
        );
        active--;
        return {
          value: request.parse(
            promptCandidates.map((item) => relationVerdict(item)),
          ),
          usage: { inputTokens: null, outputTokens: null },
        };
      },
    };

    const result = await verifyRelationshipCandidates(candidates, provider);

    expect(maximumActive).toBe(2);
    expect(result.stats.verifierRequests).toBe(3);
    expect(result.verdicts).toHaveLength(75);
  });

  test('keeps token totals nullable when the provider omits usage', async () => {
    const item = candidate(1);
    const provider = providerFromResponses(
      [[relationVerdict(item)]],
      { inputTokens: null, outputTokens: null },
    );

    const result = await verifyRelationshipCandidates([item], provider);

    expect(result.stats.inputTokens).toBeNull();
    expect(result.stats.outputTokens).toBeNull();
  });
});
