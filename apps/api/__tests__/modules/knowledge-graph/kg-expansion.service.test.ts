import { describe, expect, test } from 'bun:test';

import { ValidationError } from '../../../src/shared/errors';
import {
  buildSenseExpansionArtifact,
  buildSenseExpansionSuggestionFingerprint,
  createSenseExpansionKnowledgeGraphRun,
  generateSenseExpansionSuggestions,
  parseSenseExpansionSuggestions,
  type SenseExpansionSource,
} from '../../../src/modules/knowledge-graph/kg-expansion.service';
import type {
  EnqueueSenseExpansionRunInput,
  KgRunRecord,
  KgRunRepository,
} from '../../../src/modules/knowledge-graph/kg-runs.service';
import type { GeminiStructuredRequest } from '../../../src/modules/ai/gemini-provider';
import { createGeminiLexicalProvider } from '../../../src/modules/knowledge-graph/gemini-lexical-provider';

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

function runRecord(
  overrides: Partial<KgRunRecord> = {},
): KgRunRecord {
  return {
    id: id(100),
    userId: id(1),
    runType: 'sense_expansion',
    deckId: null,
    focusSenseId: id(10),
    status: 'queued',
    stage: 'verification',
    fingerprint: 'f'.repeat(64),
    representationVersion: 'v1',
    embeddingModel: 'gemini-embedding-2',
    promptVersion: 'kg-expansion-v1',
    taxonomyVersion: 'lexical-relations-v1',
    sourceLanguageTag: 'en',
    definitionLanguageTag: 'vi',
    snapshot: {},
    progress: {},
    stats: {},
    errorCode: null,
    errorMessage: null,
    createdAt: new Date('2026-07-27T00:00:00.000Z'),
    ...overrides,
  };
}

function runRepository(result: {
  run: KgRunRecord;
  reused: boolean;
}): KgRunRepository & {
  expansionInputs: EnqueueSenseExpansionRunInput[];
} {
  const expansionInputs: EnqueueSenseExpansionRunInput[] = [];
  return {
    expansionInputs,
    async enqueueDeckRun() {
      throw new Error('not used');
    },
    async enqueueSenseExpansionRun(input) {
      expansionInputs.push(input);
      return result;
    },
    async getOwnedRun() {
      return result.run;
    },
    async cancelOwnedRun() {
      return result.run;
    },
  };
}

describe('sense expansion service', () => {
  test('builds a deterministic artifact from the owned lexical sense', () => {
    const first = buildSenseExpansionArtifact(source());
    const second = buildSenseExpansionArtifact(source());

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      cardId: id(10),
      lemma: 'bank',
      normalizedLemma: 'bank',
      definition: 'ngân hàng',
      normalizedDefinition: 'ngân hàng',
      representationVersion: 'v1',
    });
    expect(first.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  test('enqueues an owned sense with a content/version fingerprint and wakes only a new run', async () => {
    const repository = runRepository({
      run: runRecord(),
      reused: false,
    });
    let wakes = 0;

    const result = await createSenseExpansionKnowledgeGraphRun(
      id(1),
      id(10),
      {
        sourceRepository: {
          async loadOwnedSense(userId, senseId) {
            expect(userId).toBe(id(1));
            expect(senseId).toBe(id(10));
            return source();
          },
          async persistSuggestions() {
            throw new Error('not used');
          },
        },
        runRepository: repository,
        embeddingModel: 'gemini-embedding-2',
        generationModel: 'gemini-2.5-flash',
        wakeWorker() {
          wakes++;
        },
      },
    );

    expect(result).toEqual({
      runId: id(100),
      status: 'queued',
      reused: false,
    });
    expect(wakes).toBe(1);
    expect(repository.expansionInputs).toHaveLength(1);
    expect(repository.expansionInputs[0]).toMatchObject({
      userId: id(1),
      focusSenseId: id(10),
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
        focus: {
          lemma: 'bank',
          definition: 'ngân hàng',
        },
      },
    });
    expect(repository.expansionInputs[0]?.fingerprint).toMatch(
      /^[a-f0-9]{64}$/,
    );
  });

  test('does not enqueue or wake for a sense outside the user graph', async () => {
    const repository = runRepository({
      run: runRecord(),
      reused: false,
    });
    let wakes = 0;

    await expect(
      createSenseExpansionKnowledgeGraphRun(id(1), id(10), {
        sourceRepository: {
          async loadOwnedSense() {
            return null;
          },
          async persistSuggestions() {
            throw new Error('not used');
          },
        },
        runRepository: repository,
        embeddingModel: 'gemini-embedding-2',
        generationModel: 'gemini-2.5-flash',
        wakeWorker() {
          wakes++;
        },
      }),
    ).rejects.toThrow('Lexical sense not found');
    expect(repository.expansionInputs).toHaveLength(0);
    expect(wakes).toBe(0);
  });

  test('reuses an unchanged run without waking the worker', async () => {
    const completed = runRecord({ status: 'completed' });
    const repository = runRepository({
      run: completed,
      reused: true,
    });
    let wakes = 0;

    const result = await createSenseExpansionKnowledgeGraphRun(
      id(1),
      id(10),
      {
        sourceRepository: {
          async loadOwnedSense() {
            return source();
          },
          async persistSuggestions() {
            throw new Error('not used');
          },
        },
        runRepository: repository,
        embeddingModel: 'gemini-embedding-2',
        generationModel: 'gemini-2.5-flash',
        wakeWorker() {
          wakes++;
        },
      },
    );

    expect(result).toEqual({
      runId: completed.id,
      status: 'completed',
      reused: true,
    });
    expect(wakes).toBe(0);
  });

  test('uses one structured request and deterministically builds at most eight target artifacts', async () => {
    let calls = 0;
    let request:
      | GeminiStructuredRequest<unknown>
      | undefined;
    const result = await generateSenseExpansionSuggestions(
      buildSenseExpansionArtifact(source()),
      createGeminiLexicalProvider({
        async generateStructured<T>(input: GeminiStructuredRequest<T>) {
          calls++;
          request = input as GeminiStructuredRequest<unknown>;
          const value = input.parse([
            {
              target: {
                sourceLanguageTag: 'en',
                definitionLanguageTag: 'vi',
                lemma: 'financial institution',
                partOfSpeech: 'noun',
                definition: 'tổ chức tài chính',
                ipa: null,
                examples: ['The financial institution approved the loan.'],
              },
              relationType: 'is_a',
              direction: 'source_to_target',
              confidenceBand: 'high',
              reason: 'A bank is a kind of financial institution.',
              evidence: {
                source: 'lemma: bank',
                target: 'lemma: financial institution',
              },
            },
          ]);
          return {
            value,
            usage: { inputTokens: 120, outputTokens: 60 },
          };
        },
      }),
    );

    expect(calls).toBe(1);
    expect(request?.schema).toMatchObject({
      type: 'array',
      maxItems: 8,
    });
    expect(request?.prompt).toContain(
      'is_a = subtype to supertype; part_of = component to whole',
    );
    expect(request?.prompt).toContain(
      'source_to_target means the focus stands on the left side',
    );
    expect(result.usage).toEqual({ inputTokens: 120, outputTokens: 60 });
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]).toMatchObject({
      relationType: 'is_a',
      direction: 'source_to_target',
      targetArtifact: {
        lemma: 'financial institution',
        normalizedLemma: 'financial institution',
        definition: 'tổ chức tài chính',
      },
    });
    expect(result.suggestions[0]?.targetArtifact.cardId).toMatch(
      /^[0-9a-f-]{36}$/,
    );
  });

  test('rejects over-budget output, invalid direction, and hallucinated evidence', async () => {
    const focus = buildSenseExpansionArtifact(source());
    const validItem = {
      target: {
        sourceLanguageTag: 'en',
        definitionLanguageTag: 'vi',
        lemma: 'lender',
        partOfSpeech: 'noun',
        definition: 'bên cho vay',
        ipa: null,
        examples: [],
      },
      relationType: 'coordinate',
      direction: 'symmetric',
      confidenceBand: 'medium',
      reason: 'Related financial concept.',
      evidence: {
        source: 'lemma: bank',
        target: 'lemma: lender',
      },
    };

    for (const payload of [
      Array.from({ length: 9 }, (_, index) => ({
        ...validItem,
        target: { ...validItem.target, lemma: `lender ${index}` },
        evidence: {
          source: 'lemma: bank',
          target: `lemma: lender ${index}`,
        },
      })),
      [{ ...validItem, direction: 'source_to_target' }],
      [
        {
          ...validItem,
          evidence: {
            source: 'invented source quotation',
            target: 'lemma: lender',
          },
        },
      ],
    ]) {
      await expect(
        generateSenseExpansionSuggestions(focus, createGeminiLexicalProvider({
          async generateStructured<T>(input: GeminiStructuredRequest<T>) {
            return {
              value: input.parse(payload),
              usage: { inputTokens: null, outputTokens: null },
            };
          },
        })),
      ).rejects.toBeInstanceOf(ValidationError);
    }
  });

  test('enforces v1 language policy for translations and same-language relations', () => {
    const focus = buildSenseExpansionArtifact(source());
    const item = {
      target: {
        sourceLanguageTag: 'en',
        definitionLanguageTag: 'vi',
        lemma: 'lender',
        partOfSpeech: 'noun',
        definition: 'bên cho vay',
        ipa: null,
        examples: [],
      },
      relationType: 'coordinate',
      direction: 'symmetric',
      confidenceBand: 'medium',
      reason: 'Related financial concept.',
      evidence: {
        source: 'lemma: bank',
        target: 'lemma: lender',
      },
    };

    expect(() =>
      parseSenseExpansionSuggestions(
        [
          {
            ...item,
            target: {
              ...item.target,
              sourceLanguageTag: 'vi',
              lemma: 'ngân hàng',
            },
            evidence: {
              source: 'lemma: bank',
              target: 'lemma: ngân hàng',
            },
          },
        ],
        focus,
      ),
    ).toThrow('Non-translation expansion targets must use the focus language');
    expect(() =>
      parseSenseExpansionSuggestions(
        [
          {
            ...item,
            relationType: 'translation_of',
          },
        ],
        focus,
      ),
    ).toThrow('Translation expansion targets must use a different language');
    expect(() =>
      parseSenseExpansionSuggestions(
        [
          {
            ...item,
            target: {
              ...item.target,
              definitionLanguageTag: 'en',
            },
          },
        ],
        focus,
      ),
    ).toThrow(
      'Expansion target definitions must use the focus definition language',
    );
  });

  test('canonicalizes symmetric suggestion fingerprints across reverse expansion', () => {
    const bank = buildSenseExpansionArtifact(source());
    const [institutionSuggestion] = parseSenseExpansionSuggestions(
      [
        {
          target: {
            sourceLanguageTag: 'en',
            definitionLanguageTag: 'vi',
            lemma: 'institution',
            partOfSpeech: 'noun',
            definition: 'tổ chức',
            ipa: null,
            examples: [],
          },
          relationType: 'coordinate',
          direction: 'symmetric',
          confidenceBand: 'medium',
          reason: 'Both are organizational concepts.',
          evidence: {
            source: 'lemma: bank',
            target: 'lemma: institution',
          },
        },
      ],
      bank,
    );
    if (!institutionSuggestion) throw new Error('Expected fixture suggestion');
    const institution = institutionSuggestion.targetArtifact;
    const reverse = {
      ...institutionSuggestion,
      targetArtifact: bank,
      evidence: {
        source: 'lemma: institution',
        target: 'lemma: bank',
      },
    };
    const common = {
      userId: id(1),
      generationModel: 'gemini-2.5-flash',
      representationVersion: 'v1',
      promptVersion: 'kg-expansion-v1',
      taxonomyVersion: 'lexical-relations-v1',
    };

    expect(
      buildSenseExpansionSuggestionFingerprint({
        ...common,
        sourceArtifact: bank,
        suggestion: institutionSuggestion,
      }),
    ).toBe(
      buildSenseExpansionSuggestionFingerprint({
        ...common,
        sourceArtifact: institution,
        suggestion: reverse,
      }),
    );
  });
});
