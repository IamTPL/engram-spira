import { describe, expect, test } from 'bun:test';
import { NotFoundError } from '../../../src/shared/errors';
import type { VocabularyArtifact } from '../../../src/modules/knowledge-graph/vocabulary-artifact';
import {
  buildDeckIndexSnapshot,
  buildIndexingPlan,
  publishDeckIndex,
  snapshotDeckForIndexing,
  type DeckIndexingRepository,
  type DeckIndexingTransaction,
  type DeckVocabularySource,
} from '../../../src/modules/knowledge-graph/kg-indexing.service';

const sourceLanguageTag = 'vi';
const definitionLanguageTag = 'en';
const CARD_A = '00000000-0000-4000-8000-000000000001';
const CARD_B = '00000000-0000-4000-8000-000000000002';
const CARD_C = '00000000-0000-4000-8000-000000000003';
const CARD_Z = '00000000-0000-4000-8000-00000000001a';

function vocabularySource(
  cards: DeckVocabularySource['cards'] = [
    {
      cardId: CARD_B,
      fieldValues: [
        { templateFieldId: 'word', value: 'má' },
        { templateFieldId: 'definition', value: 'mother' },
      ],
    },
    {
      cardId: CARD_A,
      fieldValues: [
        { templateFieldId: 'word', value: 'cha' },
        { templateFieldId: 'definition', value: 'father' },
      ],
    },
  ],
): DeckVocabularySource {
  return {
    deckId: 'deck-1',
    templateId: 'template-1',
    templateFields: [
      { id: 'word', name: 'word' },
      { id: 'definition', name: 'definition' },
    ],
    cards,
  };
}

function repository(
  overrides: Partial<DeckIndexingRepository> = {},
): DeckIndexingRepository {
  return {
    loadDeckSource: async () => vocabularySource(),
    transaction: async (_userId, operation) =>
      operation({
        loadDeckSource: async () => vocabularySource(),
        persistPlan: async () => ({
          lexemes: 2,
          senses: 2,
          mappings: 2,
        }),
      }),
    ...overrides,
  };
}

function artifact(
  overrides: Partial<VocabularyArtifact> & Pick<VocabularyArtifact, 'cardId'>,
): VocabularyArtifact {
  const { cardId, ...rest } = overrides;
  return {
    cardId,
    sourceLanguageTag,
    definitionLanguageTag,
    lemma: 'má',
    normalizedLemma: 'má',
    partOfSpeech: 'noun',
    definition: 'mother',
    normalizedDefinition: 'mother',
    ipa: null,
    examples: [],
    contentHash: 'a'.repeat(64),
    representationVersion: 'v1',
    ...rest,
  };
}

describe('deck indexing snapshot stage', () => {
  test('loads one owned deck source and snapshots artifacts in card ID order', async () => {
    // Catches repository calls that omit ownership or snapshot incidental DB order.
    const calls: Array<[string, string]> = [];
    const result = await snapshotDeckForIndexing(
      {
        userId: 'user-1',
        deckId: 'deck-1',
        sourceLanguageTag,
        definitionLanguageTag,
      },
      repository({
        loadDeckSource: async (userId, deckId) => {
          calls.push([userId, deckId]);
          return vocabularySource();
        },
      }),
    );

    expect(calls).toEqual([['user-1', 'deck-1']]);
    expect(result.artifacts.map((item) => item.cardId)).toEqual([
      CARD_A,
      CARD_B,
    ]);
    expect(result.snapshot.cards).toEqual(
      result.artifacts.map(({ cardId, contentHash }) => ({
        cardId,
        contentHash,
      })),
    );
    expect(result.snapshot.representationVersion).toBe('v1');
    expect(result.snapshot.snapshotHash).toHaveLength(64);
  });

  test('produces the same snapshot when source rows arrive in another order', () => {
    // Catches hashes derived before the required card-ID sort.
    const first = buildDeckIndexSnapshot(
      [
        artifact({ cardId: CARD_B }),
        artifact({ cardId: CARD_A }),
      ],
    );
    const second = buildDeckIndexSnapshot(
      [
        artifact({ cardId: CARD_A }),
        artifact({ cardId: CARD_B }),
      ],
    );

    expect(first).toEqual(second);
  });

  test('propagates the owned-deck not-found result without attempting publication', async () => {
    // Catches ownership failures being converted into empty, partially indexed decks.
    let transactionStarted = false;
    const indexingRepository = repository({
      loadDeckSource: async () => {
        throw new NotFoundError('Deck');
      },
      transaction: async (_userId, operation) => {
        transactionStarted = true;
        return operation({} as DeckIndexingTransaction);
      },
    });

    await expect(
      snapshotDeckForIndexing(
        {
          userId: 'user-2',
          deckId: 'deck-1',
          sourceLanguageTag,
          definitionLanguageTag,
        },
        indexingRepository,
      ),
    ).rejects.toThrow('Deck not found');
    expect(transactionStarted).toBe(false);
  });

  test('rejects unsupported templates as deterministic validation failures', async () => {
    // Catches non-vocabulary decks being treated as retryable partial work.
    await expect(
      snapshotDeckForIndexing(
        {
          userId: 'user-1',
          deckId: 'deck-1',
          sourceLanguageTag,
          definitionLanguageTag,
        },
        repository({
          loadDeckSource: async () => ({
            ...vocabularySource(),
            templateFields: [
              { id: 'front', name: 'front' },
              { id: 'back', name: 'back' },
            ],
          }),
        }),
      ),
    ).rejects.toThrow('Vocabulary template must include a word field');
  });

  test('rejects an unsupported template even when the deck has no cards', async () => {
    // Catches required-template validation being skipped by an empty cards.map().
    await expect(
      snapshotDeckForIndexing(
        {
          userId: 'user-1',
          deckId: 'deck-1',
          sourceLanguageTag,
          definitionLanguageTag,
        },
        repository({
          loadDeckSource: async () => ({
            ...vocabularySource([]),
            templateFields: [
              { id: 'front', name: 'front' },
              { id: 'back', name: 'back' },
            ],
          }),
        }),
      ),
    ).rejects.toThrow('Vocabulary template must include a word field');
  });
});

describe('persisted deck index snapshot validation', () => {
  const validSnapshot = buildDeckIndexSnapshot([
    artifact({ cardId: CARD_A, contentHash: '1'.repeat(64) }),
    artifact({ cardId: CARD_B, contentHash: '2'.repeat(64) }),
  ]);

  test('rejects a snapshot with the wrong representation version before publication', async () => {
    // Catches runtime JSON being trusted merely because the TypeScript caller is typed.
    let transactionStarted = false;
    await expect(
      publishDeckIndex(
        {
          userId: 'user-1',
          deckId: 'deck-1',
          sourceLanguageTag,
          definitionLanguageTag,
          snapshot: {
            ...validSnapshot,
            representationVersion: 'v2',
          },
        },
        repository({
          transaction: async () => {
            transactionStarted = true;
            throw new Error('must not start transaction');
          },
        }),
      ),
    ).rejects.toThrow('Invalid deck index snapshot');
    expect(transactionStarted).toBe(false);
  });

  test.each([
    [
      'a mismatched snapshot hash',
      { ...validSnapshot, snapshotHash: 'f'.repeat(64) },
    ],
    [
      'cards outside canonical order',
      {
        ...validSnapshot,
        cards: [...validSnapshot.cards].reverse(),
        snapshotHash:
          'dd7610089982ba839aae789162c9ea036a8c57560bbe31a15276dcd654be4b5d',
      },
    ],
    [
      'duplicate card IDs',
      {
        ...validSnapshot,
        cards: [validSnapshot.cards[0], validSnapshot.cards[0]],
        snapshotHash:
          '6f998672a4a7996e8f3ec1f49ace0800752759fd01c9cbf4b53b240fbf700bc0',
      },
    ],
  ])('rejects %s before publication', async (_label, value) => {
    // Catches corrupt durable JSON being accepted into the publishing transaction.
    let transactionStarted = false;
    await expect(
      publishDeckIndex(
        {
          userId: 'user-1',
          deckId: 'deck-1',
          sourceLanguageTag,
          definitionLanguageTag,
          snapshot: value,
        },
        repository({
          transaction: async () => {
            transactionStarted = true;
            throw new Error('must not start transaction');
          },
        }),
      ),
    ).rejects.toThrow(
      'Invalid deck index snapshot',
    );
    expect(transactionStarted).toBe(false);
  });
});

describe('indexing plan', () => {
  test('deduplicates identical lexeme and sense identities before persistence', () => {
    // Catches one conflicting INSERT row per card and duplicate graph identities.
    const plan = buildIndexingPlan([
      artifact({ cardId: CARD_B, ipa: '/ma/' }),
      artifact({
        cardId: CARD_A,
        ipa: null,
        examples: ['She is my mother.'],
      }),
    ]);

    expect(plan.lexemes).toHaveLength(1);
    expect(plan.senses).toHaveLength(1);
    expect(plan.mappings).toHaveLength(2);
    expect(plan.senses[0]).toMatchObject({
      definition: 'mother',
      ipa: '/ma/',
      examples: ['She is my mother.'],
    });
    expect(plan.mappings.map((item) => item.cardId)).toEqual([
      CARD_A,
      CARD_B,
    ]);
  });

  test('keeps homographs with different definitions as separate senses', () => {
    // Catches accidental sense identity collapse to lemma alone.
    const plan = buildIndexingPlan([
      artifact({ cardId: CARD_A, definition: 'mother', normalizedDefinition: 'mother' }),
      artifact({ cardId: CARD_B, definition: 'cheek', normalizedDefinition: 'cheek' }),
    ]);

    expect(plan.lexemes).toHaveLength(1);
    expect(plan.senses).toHaveLength(2);
    expect(plan.mappings.map((item) => item.senseKey)).not.toEqual([
      plan.mappings[0].senseKey,
      plan.mappings[0].senseKey,
    ]);
  });

  test('chooses fill-only metadata deterministically by sorted card ID', () => {
    // Catches richer metadata changing when database row order changes.
    const rows = [
      artifact({
        cardId: CARD_Z,
        ipa: '/later/',
        examples: ['Later example'],
      }),
      artifact({
        cardId: CARD_A,
        ipa: '/first/',
        examples: ['First example'],
      }),
    ];

    expect(buildIndexingPlan(rows).senses[0]).toMatchObject({
      ipa: '/first/',
      examples: ['First example'],
    });
    expect(buildIndexingPlan([...rows].reverse()).senses).toEqual(
      buildIndexingPlan(rows).senses,
    );
  });

  test('sorts bulk persistence identities independently of card order', () => {
    // Catches overlapping deck runs locking shared graph identities in opposite order.
    const plan = buildIndexingPlan([
      artifact({
        cardId: CARD_A,
        lemma: 'Zulu',
        normalizedLemma: 'zulu',
        definition: 'Zulu definition',
        normalizedDefinition: 'zulu definition',
      }),
      artifact({
        cardId: CARD_B,
        lemma: 'Alpha',
        normalizedLemma: 'alpha',
        definition: 'Alpha definition',
        normalizedDefinition: 'alpha definition',
      }),
    ]);

    expect(plan.lexemes.map((item) => item.normalizedLemma)).toEqual([
      'alpha',
      'zulu',
    ]);
    expect(plan.senses.map((item) => item.normalizedDefinition)).toEqual([
      'alpha definition',
      'zulu definition',
    ]);
    expect(plan.mappings.map((item) => item.cardId)).toEqual([
      CARD_A,
      CARD_B,
    ]);
  });
});

describe('deck indexing publish stage', () => {
  test('returns stale and performs zero persistence when any card hash changes', async () => {
    // Catches writes occurring before the complete in-transaction snapshot recheck.
    const initial = await snapshotDeckForIndexing(
      {
        userId: 'user-1',
        deckId: 'deck-1',
        sourceLanguageTag,
        definitionLanguageTag,
      },
      repository(),
    );
    let persisted = false;
    const result = await publishDeckIndex(
      {
        userId: 'user-1',
        deckId: 'deck-1',
        sourceLanguageTag,
        definitionLanguageTag,
        snapshot: initial.snapshot,
      },
      repository({
        transaction: async (userId, operation) => {
          expect(userId).toBe('user-1');
          return operation({
            loadDeckSource: async (transactionUserId, deckId) => {
              expect([transactionUserId, deckId]).toEqual(['user-1', 'deck-1']);
              return vocabularySource([
                {
                  cardId: CARD_A,
                  fieldValues: [
                    { templateFieldId: 'word', value: 'cha' },
                    { templateFieldId: 'definition', value: 'dad' },
                  ],
                },
                vocabularySource().cards[0],
              ]);
            },
            persistPlan: async () => {
              persisted = true;
              return { lexemes: 0, senses: 0, mappings: 0 };
            },
          });
        },
      }),
    );

    expect(result).toEqual({ outcome: 'stale' });
    expect(persisted).toBe(false);
  });

  test('returns stale when a card was added or removed after snapshotting', async () => {
    // Catches snapshot comparisons that inspect hashes but not the complete card-ID set.
    const initial = await snapshotDeckForIndexing(
      {
        userId: 'user-1',
        deckId: 'deck-1',
        sourceLanguageTag,
        definitionLanguageTag,
      },
      repository(),
    );
    for (const currentSource of [
      vocabularySource().cards.slice(0, 1),
      [
        ...vocabularySource().cards,
        {
          cardId: CARD_C,
          fieldValues: [
            { templateFieldId: 'word', value: 'con' },
            { templateFieldId: 'definition', value: 'child' },
          ],
        },
      ],
    ]) {
      let persisted = false;
      const result = await publishDeckIndex(
        {
          userId: 'user-1',
          deckId: 'deck-1',
          sourceLanguageTag,
          definitionLanguageTag,
          snapshot: initial.snapshot,
        },
        repository({
          transaction: async (_userId, operation) =>
            operation({
              loadDeckSource: async () => vocabularySource(currentSource),
              persistPlan: async () => {
                persisted = true;
                return { lexemes: 0, senses: 0, mappings: 0 };
              },
            }),
        }),
      );
      expect(result).toEqual({ outcome: 'stale' });
      expect(persisted).toBe(false);
    }
  });

  test('publishes the deduplicated plan with user and deck ownership context', async () => {
    // Catches persistence APIs that can be called without explicit ownership.
    const initial = await snapshotDeckForIndexing(
      {
        userId: 'user-1',
        deckId: 'deck-1',
        sourceLanguageTag,
        definitionLanguageTag,
      },
      repository(),
    );
    const calls: Array<[string, string, number, number, number]> = [];
    const result = await publishDeckIndex(
      {
        userId: 'user-1',
        deckId: 'deck-1',
        sourceLanguageTag,
        definitionLanguageTag,
        snapshot: initial.snapshot,
      },
      repository({
        transaction: async (_userId, operation) =>
          operation({
            loadDeckSource: async () => vocabularySource(),
            persistPlan: async (userId, deckId, plan) => {
              calls.push([
                userId,
                deckId,
                plan.lexemes.length,
                plan.senses.length,
                plan.mappings.length,
              ]);
              return { lexemes: 2, senses: 2, mappings: 2 };
            },
          }),
      }),
    );

    expect(calls).toEqual([['user-1', 'deck-1', 2, 2, 2]]);
    expect(result).toEqual({
      outcome: 'published',
      stats: { lexemes: 2, senses: 2, mappings: 2 },
      nextStage: 'embeddings',
      progress: { indexedCards: 2 },
      statsPatch: {
        indexedLexemes: 2,
        indexedSenses: 2,
        indexedMappings: 2,
      },
    });
  });

  test.each(['40001', '40P01'])(
    'retries transient PostgreSQL conflict %s and rebuilds the snapshot',
    async (code) => {
      // Catches unchanged overlapping deck runs being terminally mislabeled stale.
      const initial = await snapshotDeckForIndexing(
        {
          userId: 'user-1',
          deckId: 'deck-1',
          sourceLanguageTag,
          definitionLanguageTag,
        },
        repository(),
      );
      const transientFailure = Object.assign(
        new Error('transient database conflict'),
        { code },
      );
      const baseRepository = repository();
      let attempts = 0;
      const result = await publishDeckIndex(
        {
          userId: 'user-1',
          deckId: 'deck-1',
          sourceLanguageTag,
          definitionLanguageTag,
          snapshot: initial.snapshot,
        },
        repository({
          transaction: async (userId, operation) => {
            attempts += 1;
            if (attempts === 1) throw transientFailure;
            return baseRepository.transaction(userId, operation);
          },
        }),
        {
          retryDelay: async () => {},
        },
      );

      expect(result).toMatchObject({ outcome: 'published' });
      expect(attempts).toBe(2);
    },
  );

  test('throws the original database conflict after transaction retries are exhausted', async () => {
    // Catches retry exhaustion being reported as a false card-content stale outcome.
    const conflict = Object.assign(new Error('could not serialize access'), {
      code: '40001',
    });
    let attempts = 0;
    const operation = publishDeckIndex(
      {
        userId: 'user-1',
        deckId: 'deck-1',
        sourceLanguageTag,
        definitionLanguageTag,
        snapshot: buildDeckIndexSnapshot([]),
      },
      repository({
        transaction: async () => {
          attempts += 1;
          throw conflict;
        },
      }),
      {
        retryDelay: async () => {},
      },
    );

    await expect(operation).rejects.toBe(conflict);
    expect(attempts).toBe(3);
  });

  test('allows the transaction boundary to roll back a mid-publish failure', async () => {
    // Catches transaction runners that commit staged writes after an exception.
    const initial = await snapshotDeckForIndexing(
      {
        userId: 'user-1',
        deckId: 'deck-1',
        sourceLanguageTag,
        definitionLanguageTag,
      },
      repository(),
    );
    const committed: string[] = [];
    const indexingRepository = repository({
      transaction: async (_userId, operation) => {
        const staged: string[] = [];
        try {
          const result = await operation({
            loadDeckSource: async () => vocabularySource(),
            persistPlan: async () => {
              staged.push('mapping');
              throw new Error('injected persistence failure');
            },
          });
          committed.push(...staged);
          return result;
        } catch (error) {
          throw error;
        }
      },
    });

    await expect(
      publishDeckIndex(
        {
          userId: 'user-1',
          deckId: 'deck-1',
          sourceLanguageTag,
          definitionLanguageTag,
          snapshot: initial.snapshot,
        },
        indexingRepository,
      ),
    ).rejects.toThrow('injected persistence failure');
    expect(committed).toEqual([]);
  });
});
