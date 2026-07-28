import { describe, expect, test } from 'bun:test';

import {
  getCardNeighborhood,
  mapCardToSense,
  type CardNeighborhoodRepository,
  type NeighborhoodNodeRecord,
} from '../../../src/modules/knowledge-graph/kg-neighborhood.service';
import {
  NotFoundError,
  ValidationError,
} from '../../../src/shared/errors';

const id = (value: number) =>
  `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;

const USER_ID = id(1);
const DECK_ID = id(2);
const CARD_ID = id(3);
const FOCUS_SENSE_ID = id(4);

function node(
  senseId: string,
  label: string,
  overrides: Partial<NeighborhoodNodeRecord> = {},
): NeighborhoodNodeRecord {
  return {
    id: senseId,
    lexemeId: id(Number(senseId.slice(-4)) + 100),
    label,
    normalizedLemma: label.toLocaleLowerCase('en'),
    languageTag: 'en',
    partOfSpeech: 'noun',
    definition: `${label} definition`,
    mappedCardIds: [],
    inCurrentDeck: false,
    retention: null,
    dueAt: null,
    ...overrides,
  };
}

function repository(
  overrides: Partial<CardNeighborhoodRepository> = {},
): CardNeighborhoodRepository {
  const focus = node(FOCUS_SENSE_ID, 'root', {
    mappedCardIds: [CARD_ID],
    inCurrentDeck: true,
    retention: 0.75,
    dueAt: new Date('2030-01-02T03:04:05.000Z'),
  });

  return {
    async loadFocus() {
      return {
        cardId: CARD_ID,
        deckId: DECK_ID,
        focus,
      };
    },
    async loadPage() {
      return {
        nodes: [],
        edges: [],
        hasMore: false,
      };
    },
    async loadSummary() {
      return {
        deckCards: 1,
        connectedCards: 0,
        isolatedCards: 1,
        groupCounts: {
          hierarchy: 0,
          meaning: 0,
          form: 0,
          usage: 0,
        },
      };
    },
    async mapCardSense() {
      return {
        outcome: 'mapped',
        mapping: {
          cardId: CARD_ID,
          senseId: FOCUS_SENSE_ID,
          source: 'manual',
          isPrimary: true,
          created: true,
        },
      };
    },
    ...overrides,
  };
}

describe('getCardNeighborhood', () => {
  test('returns the exact one-hop DTO with typed groups, dates and deterministic order', async () => {
    // Catches leaking repository-only fields, wrong direction/group metadata, and unstable output.
    const aunt = node(id(6), 'aunt', {
      mappedCardIds: [id(20), id(19), id(20)],
      inCurrentDeck: true,
      retention: 0.6,
      dueAt: '2030-02-03T04:05:06.000Z',
    });
    const relative = node(id(7), 'relative');
    const result = await getCardNeighborhood(
      USER_ID,
      CARD_ID,
      {
        groups: ['usage', 'meaning', 'usage'],
        limit: 24,
      },
      repository({
        async loadPage(input) {
          expect(input.groups).toEqual(['meaning', 'usage']);
          expect(input.relationTypes).toEqual([
            'synonym',
            'antonym',
            'collocation',
            'confused_with',
            'translation_of',
            'coordinate',
          ]);
          expect(input.after).toBeNull();
          expect(input.nodeLimit).toBe(24);
          expect(input.edgeLimit).toBe(40);
          return {
            nodes: [relative, aunt],
            edges: [
              {
                id: id(51),
                source: FOCUS_SENSE_ID,
                target: aunt.id,
                type: 'collocation',
                group: 'usage',
                directed: false,
                origin: 'ai',
                evidence: 'root sentence ↔ aunt sentence',
                confidenceBand: 'high',
              },
              {
                id: id(50),
                source: FOCUS_SENSE_ID,
                target: relative.id,
                type: 'synonym',
                group: 'meaning',
                directed: false,
                origin: 'manual',
                evidence: null,
                confidenceBand: null,
              },
            ],
            hasMore: false,
          };
        },
        async loadSummary() {
          return {
            deckCards: 98,
            connectedCards: 29,
            isolatedCards: 69,
            groupCounts: {
              hierarchy: 3,
              meaning: 7,
              form: 2,
              usage: 5,
            },
          };
        },
      }),
    );

    expect(result).toEqual({
      focus: {
        id: FOCUS_SENSE_ID,
        lexemeId: id(104),
        label: 'root',
        languageTag: 'en',
        partOfSpeech: 'noun',
        definition: 'root definition',
        mappedCardIds: [CARD_ID],
        inCurrentDeck: true,
        retention: 0.75,
        dueAt: '2030-01-02T03:04:05.000Z',
      },
      nodes: [
        {
          id: aunt.id,
          lexemeId: id(106),
          label: 'aunt',
          languageTag: 'en',
          partOfSpeech: 'noun',
          definition: 'aunt definition',
          mappedCardIds: [id(20), id(19)],
          inCurrentDeck: true,
          retention: 0.6,
          dueAt: '2030-02-03T04:05:06.000Z',
        },
        {
          id: relative.id,
          lexemeId: id(107),
          label: 'relative',
          languageTag: 'en',
          partOfSpeech: 'noun',
          definition: 'relative definition',
          mappedCardIds: [],
          inCurrentDeck: false,
          retention: null,
          dueAt: null,
        },
      ],
      edges: [
        {
          id: id(50),
          source: FOCUS_SENSE_ID,
          target: relative.id,
          type: 'synonym',
          group: 'meaning',
          directed: false,
          origin: 'manual',
          evidence: null,
          confidenceBand: null,
        },
        {
          id: id(51),
          source: FOCUS_SENSE_ID,
          target: aunt.id,
          type: 'collocation',
          group: 'usage',
          directed: false,
          origin: 'ai',
          evidence: 'root sentence ↔ aunt sentence',
          confidenceBand: 'high',
        },
      ],
      summary: {
        deckCards: 98,
        connectedCards: 29,
        isolatedCards: 69,
        groupCounts: {
          hierarchy: 3,
          meaning: 7,
          form: 2,
          usage: 5,
        },
      },
      pageInfo: {
        nextCursor: null,
        truncated: false,
      },
    });
  });

  test('uses an opaque cursor bound to the focus and filters', async () => {
    // Catches offset pagination, cursor reuse across cards/groups, and duplicate pages.
    const firstNeighbor = node(id(8), 'alpha');
    const seenAfter: Array<{
      normalizedLemma: string;
      senseId: string;
    } | null> = [];
    const repo = repository({
      async loadPage(input) {
        seenAfter.push(input.after);
        if (input.after) {
          return { nodes: [], edges: [], hasMore: false };
        }
        return {
          nodes: [firstNeighbor],
          edges: [],
          hasMore: true,
        };
      },
    });

    const first = await getCardNeighborhood(
      USER_ID,
      CARD_ID,
      { groups: ['meaning'], limit: 1 },
      repo,
    );
    expect(first.pageInfo.truncated).toBe(true);
    expect(first.pageInfo.nextCursor).toBeString();
    expect(first.pageInfo.nextCursor).not.toContain(firstNeighbor.id);
    expect(first.pageInfo.nextCursor).not.toContain('alpha');

    await getCardNeighborhood(
      USER_ID,
      CARD_ID,
      {
        groups: ['meaning'],
        limit: 1,
        cursor: first.pageInfo.nextCursor!,
      },
      repo,
    );
    expect(seenAfter.at(-1)).toEqual({
      normalizedLemma: 'alpha',
      senseId: firstNeighbor.id,
    });

    expect(
      getCardNeighborhood(
        USER_ID,
        id(999),
        {
          groups: ['meaning'],
          limit: 1,
          cursor: first.pageInfo.nextCursor!,
        },
        repository(),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test('keeps service ordering identical to the PostgreSQL C collation cursor order', async () => {
    // Catches locale-dependent reordering that would skip or duplicate non-ASCII lemmas.
    const ascii = node(id(80), 'z');
    const accented = node(id(81), 'ä');
    const result = await getCardNeighborhood(
      USER_ID,
      CARD_ID,
      {},
      repository({
        loadPage: async () => ({
          nodes: [accented, ascii],
          edges: [],
          hasMore: false,
        }),
      }),
    );

    expect(result.nodes.map((item) => item.label)).toEqual(['z', 'ä']);
  });

  test('rejects invalid filters, bounds and malformed cursors at the service boundary', async () => {
    // Catches bypassing route validation from internal callers.
    const repo = repository();

    expect(
      getCardNeighborhood(
        USER_ID,
        CARD_ID,
        { groups: ['meaning', 'invalid' as 'meaning'] },
        repo,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(
      getCardNeighborhood(USER_ID, CARD_ID, { limit: 25 }, repo),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(
      getCardNeighborhood(
        USER_ID,
        CARD_ID,
        { cursor: 'not-a-cursor' },
        repo,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test('hides non-owned cards and reports an owned card without a sense separately', async () => {
    // Catches cross-user graph reads and an ambiguous null focus.
    expect(
      getCardNeighborhood(
        USER_ID,
        CARD_ID,
        {},
        repository({ loadFocus: async () => null }),
      ),
    ).rejects.toEqual(new NotFoundError('Card'));

    expect(
      getCardNeighborhood(
        USER_ID,
        CARD_ID,
        {},
        repository({
          loadFocus: async () => ({
            cardId: CARD_ID,
            deckId: DECK_ID,
            focus: null,
          }),
        }),
      ),
    ).rejects.toEqual(new NotFoundError('Knowledge graph'));
  });
});

describe('mapCardToSense', () => {
  test('returns the idempotent mapping result from the ownership-scoped transaction', async () => {
    // Catches changing provenance/primary state on a repeated mapping.
    const result = await mapCardToSense(
      USER_ID,
      CARD_ID,
      FOCUS_SENSE_ID,
      repository({
        async mapCardSense() {
          return {
            outcome: 'mapped',
            mapping: {
              cardId: CARD_ID,
              senseId: FOCUS_SENSE_ID,
              source: 'deterministic',
              isPrimary: true,
              created: false,
            },
          };
        },
      }),
    );

    expect(result).toEqual({
      cardId: CARD_ID,
      senseId: FOCUS_SENSE_ID,
      source: 'deterministic',
      isPrimary: true,
      created: false,
    });
  });

  test('does not reveal a non-owned card or sense', async () => {
    // Catches accepting either endpoint without user ownership.
    expect(
      mapCardToSense(
        USER_ID,
        CARD_ID,
        FOCUS_SENSE_ID,
        repository({
          mapCardSense: async () => ({ outcome: 'card_not_found' }),
        }),
      ),
    ).rejects.toEqual(new NotFoundError('Card'));

    expect(
      mapCardToSense(
        USER_ID,
        CARD_ID,
        FOCUS_SENSE_ID,
        repository({
          mapCardSense: async () => ({ outcome: 'sense_not_found' }),
        }),
      ),
    ).rejects.toEqual(new NotFoundError('Sense'));
  });
});
