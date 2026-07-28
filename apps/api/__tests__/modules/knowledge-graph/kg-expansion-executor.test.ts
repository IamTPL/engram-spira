import { describe, expect, test } from 'bun:test';

import {
  createSenseExpansionExecutor,
  type SenseExpansionExecutorDependencies,
} from '../../../src/modules/knowledge-graph/kg-expansion-executor';
import { createKnowledgeGraphExecutor } from '../../../src/modules/knowledge-graph/kg-run-executor';
import {
  buildSenseExpansionArtifact,
  parseSenseExpansionSuggestions,
  type SenseExpansionSource,
} from '../../../src/modules/knowledge-graph/kg-expansion.service';
import type {
  ClaimedKgRun,
  KgRunStage,
  KgStageExecutionContext,
} from '../../../src/modules/knowledge-graph/kg-worker';
import { ValidationError } from '../../../src/shared/errors';

const id = (value: number) =>
  `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;

function source(
  overrides: Partial<SenseExpansionSource> = {},
): SenseExpansionSource {
  return {
    senseId: id(10),
    lexemeId: id(11),
    sourceLanguageTag: 'en',
    definitionLanguageTag: 'vi',
    lemma: 'bank',
    normalizedLemma: 'bank',
    partOfSpeech: 'noun',
    definition: 'ngân hàng',
    normalizedDefinition: 'ngân hàng',
    ipa: '/bæŋk/',
    examples: ['I deposited money at the bank.'],
    ...overrides,
  };
}

function generatedSuggestion() {
  const [suggestion] = parseSenseExpansionSuggestions(
    [
      {
        target: {
          sourceLanguageTag: 'en',
          definitionLanguageTag: 'vi',
          lemma: 'financial institution',
          partOfSpeech: 'noun',
          definition: 'tổ chức tài chính',
          ipa: null,
          examples: [],
        },
        relationType: 'is_a',
        direction: 'source_to_target',
        confidenceBand: 'high',
        reason: 'A bank is a type of financial institution.',
        evidence: {
          source: 'lemma: bank',
          target: 'lemma: financial institution',
        },
      },
    ],
    buildSenseExpansionArtifact(source()),
  );
  if (!suggestion) throw new Error('Expected fixture suggestion');
  return suggestion;
}

function run(
  overrides: Partial<ClaimedKgRun> = {},
): ClaimedKgRun {
  return {
    id: id(100),
    userId: id(1),
    runType: 'sense_expansion',
    deckId: null,
    focusSenseId: id(10),
    stage: 'snapshot',
    fingerprint: 'f'.repeat(64),
    representationVersion: 'v1',
    embeddingModel: 'gemini-embedding-2',
    promptVersion: 'kg-expansion-v1',
    taxonomyVersion: 'lexical-relations-v1',
    sourceLanguageTag: 'en',
    definitionLanguageTag: 'vi',
    snapshot: {
      version: 'sense-expansion-v1',
      generationModel: 'gemini-2.5-flash',
      maxSuggestions: 8,
      focus: buildSenseExpansionArtifact(source()),
    },
    progress: { completed: 0, total: 3 },
    stats: { indexedSenses: 1 },
    attemptCount: 1,
    maxAttempts: 5,
    cancelRequestedAt: null,
    ...overrides,
  };
}

function context(
  value: ClaimedKgRun,
  onAdvance?: (
    stage: KgRunStage,
    progress?: Record<string, unknown>,
    stats?: Record<string, unknown>,
  ) => void,
): KgStageExecutionContext {
  return {
    run: value,
    workerId: id(99),
    signal: new AbortController().signal,
    async heartbeat() {
      return true;
    },
    async advanceStage(stage, progress, stats) {
      onAdvance?.(stage, progress, stats);
      value.stage = stage;
      Object.assign(value.progress, progress ?? {});
      Object.assign(value.stats, stats ?? {});
      return true;
    },
    async saveSnapshotAndAdvance(snapshot, stage, progress, stats) {
      value.snapshot = snapshot;
      onAdvance?.(stage, progress, stats);
      value.stage = stage;
      Object.assign(value.progress, progress ?? {});
      Object.assign(value.stats, stats ?? {});
      return true;
    },
  };
}

function dependencies(
  overrides: Partial<SenseExpansionExecutorDependencies> = {},
): SenseExpansionExecutorDependencies {
  return {
    generationModel: 'gemini-2.5-flash',
    embeddingModel: 'gemini-embedding-2',
    async loadOwnedSense() {
      return source();
    },
    async generateSuggestions() {
      return {
        suggestions: [generatedSuggestion()],
        usage: { inputTokens: 100, outputTokens: 50 },
      };
    },
    async persistSuggestions(_fence, suggestions) {
      return {
        outcome: 'persisted',
        persisted: suggestions.length,
        pending: suggestions.length,
      };
    },
    ...overrides,
  };
}

describe('sense expansion executor', () => {
  test('validates the snapshot, calls generation once, freezes output, and persists pending suggestions', async () => {
    const claimed = run();
    const stages: KgRunStage[] = [];
    let generateCalls = 0;
    let persisted:
      | Parameters<
          SenseExpansionExecutorDependencies['persistSuggestions']
        >[1]
      | undefined;
    const executor = createSenseExpansionExecutor(
      dependencies({
        async generateSuggestions() {
          generateCalls++;
          return {
            suggestions: [generatedSuggestion()],
            usage: { inputTokens: 100, outputTokens: 50 },
          };
        },
        async persistSuggestions(fence, suggestions) {
          expect(fence).toMatchObject({
            runId: id(100),
            userId: id(1),
            focusSenseId: id(10),
            workerId: id(99),
          });
          persisted = suggestions;
          return {
            outcome: 'persisted',
            persisted: 1,
            pending: 1,
          };
        },
      }),
    );

    const result = await executor(
      context(claimed, (stage) => stages.push(stage)),
    );

    expect(generateCalls).toBe(1);
    expect(stages).toEqual(['verification', 'persistence']);
    expect(claimed.progress.expansionSuggestions).toMatchObject({
      version: 'sense-expansion-suggestions-v1',
      items: [{ relationType: 'is_a' }],
    });
    expect(persisted).toHaveLength(1);
    expect(persisted?.[0]?.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(result).toEqual({
      outcome: 'completed',
      progress: { completed: 3, total: 3 },
      statsPatch: {
        indexedSenses: 1,
        verified: 1,
        suggestions: 1,
        verifierRequests: 1,
        expansionRequests: 1,
        inputTokens: 100,
        outputTokens: 50,
        schemaInvalid: 0,
        timeouts: 0,
        providerErrors: 0,
      },
    });
  });

  test('resumes persistence from frozen progress without another provider call', async () => {
    const firstRun = run();
    const firstExecutor = createSenseExpansionExecutor(dependencies());
    await firstExecutor(context(firstRun));
    const resumed = run({
      stage: 'persistence',
      progress: { ...firstRun.progress },
      stats: { ...firstRun.stats },
      attemptCount: 2,
    });
    let generateCalls = 0;
    let persistCalls = 0;
    const resumedExecutor = createSenseExpansionExecutor(
      dependencies({
        async generateSuggestions() {
          generateCalls++;
          throw new Error('must not generate during persistence resume');
        },
        async persistSuggestions(_fence, suggestions) {
          persistCalls++;
          expect(suggestions).toHaveLength(1);
          return {
            outcome: 'persisted',
            persisted: 0,
            pending: 1,
          };
        },
      }),
    );

    const result = await resumedExecutor(context(resumed));

    expect(generateCalls).toBe(0);
    expect(persistCalls).toBe(1);
    expect(result.outcome).toBe('completed');
    expect(result.statsPatch?.verifierRequests).toBe(1);
  });

  test('marks a changed focus or provider model stale before generation', async () => {
    for (const claimed of [
      run(),
      run({
        snapshot: {
          ...run().snapshot,
          generationModel: 'old-model',
        },
      }),
    ]) {
      let calls = 0;
      const executor = createSenseExpansionExecutor(
        dependencies({
          async loadOwnedSense() {
            return claimed.snapshot.generationModel === 'old-model'
              ? source()
              : source({
                  definition: 'bờ sông',
                  normalizedDefinition: 'bờ sông',
                });
          },
          async generateSuggestions() {
            calls++;
            throw new Error('not expected');
          },
        }),
      );
      const result = await executor(context(claimed));
      expect(result.outcome).toBe('stale');
      expect(calls).toBe(0);
    }
  });

  test('returns partial for malformed output without fabricating suggestions', async () => {
    let persistCalls = 0;
    const executor = createSenseExpansionExecutor(
      dependencies({
        async generateSuggestions() {
          throw new ValidationError('Malformed expansion output');
        },
        async persistSuggestions() {
          persistCalls++;
          throw new Error('not expected');
        },
      }),
    );

    const result = await executor(context(run()));

    expect(result).toMatchObject({
      outcome: 'partial',
      statsPatch: {
        suggestions: 0,
        verifierRequests: 1,
        schemaInvalid: 1,
      },
    });
    expect(persistCalls).toBe(0);
  });

  test('throws retryable provider failures before the final attempt but records the request first', async () => {
    const failure = Object.assign(new Error('rate limited'), { status: 429 });
    const claimed = run({ attemptCount: 1, maxAttempts: 5 });
    const stages: KgRunStage[] = [];
    const executor = createSenseExpansionExecutor(
      dependencies({
        async generateSuggestions() {
          throw failure;
        },
      }),
    );

    await expect(
      executor(context(claimed, (stage) => stages.push(stage))),
    ).rejects.toBe(failure);
    expect(stages).toEqual(['verification', 'verification']);
    expect(claimed.stats).toMatchObject({
      verifierRequests: 1,
      providerErrors: 1,
    });
  });

  test('dispatches deck and sense-expansion runs to separate executors', async () => {
    const calls: string[] = [];
    const dispatcher = createKnowledgeGraphExecutor({
      async deck() {
        calls.push('deck');
        return { outcome: 'completed' };
      },
      async expansion() {
        calls.push('expansion');
        return { outcome: 'completed' };
      },
    });
    const expansionRun = run();
    const deckRun = run({
      runType: 'deck_index',
      deckId: id(20),
      focusSenseId: null,
    });

    await dispatcher(context(deckRun));
    await dispatcher(context(expansionRun));

    expect(calls).toEqual(['deck', 'expansion']);
  });
});
