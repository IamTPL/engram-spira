import { describe, expect, test } from 'bun:test';

import * as kgAiService from '../../../src/modules/knowledge-graph/kg-ai.service';

type Candidate = {
  sourceCardId: string;
  targetCardId: string;
  similarity: number;
};

type CandidateHelpers = {
  canonicalPair?: (a: string, b: string) => [string, string];
  filterKnownPairs?: (
    candidates: Candidate[],
    knownPairs: Set<string>,
  ) => Candidate[];
  rankCandidatesForCoverage?: (
    candidates: Candidate[],
    maxSuggestions: number,
  ) => Candidate[];
};

type DetectorFactory = (loaders: {
  loadDeck: (userId: string, deckId: string) => Promise<{ id: string } | null>;
  loadEmbeddedCards: (deckId: string) => Promise<Array<{ cardId: string; embedding: string }>>;
  loadExistingLinks: (cardIds: string[]) => Promise<Array<{
    sourceCardId: string;
    targetCardId: string;
    linkType: string;
  }>>;
  loadDismissedSuggestions: (userId: string, cardIds: string[]) => Promise<Array<{
    sourceCardId: string;
    targetCardId: string;
  }>>;
  getCardLabels: (cardIds: string[]) => Promise<Map<string, string>>;
  getCardTexts: (cardIds: string[]) => Promise<Map<string, string>>;
  verifyRelationships: (candidates: Array<{
    sourceCardId: string;
    targetCardId: string;
    sourceText: string;
    targetText: string;
  }>) => Promise<Array<{
    sourceCardId: string;
    targetCardId: string;
    related: boolean;
    reason: string;
  }>>;
}) => (
  userId: string,
  deckId: string,
  threshold?: number,
  maxSuggestions?: number,
) => Promise<{ suggestions: Array<{ sourceCardId: string; targetCardId: string }> }>;

const candidateHelpers = kgAiService as CandidateHelpers;
const createRelationshipDetector = (
  kgAiService as { createRelationshipDetector?: DetectorFactory }
).createRelationshipDetector;

describe('knowledge-graph AI relationship detection', () => {
  test('canonicalizes reverse undirected pairs', () => {
    expect(candidateHelpers.canonicalPair?.('card-b', 'card-a')).toEqual([
      'card-a',
      'card-b',
    ]);
  });

  test('filters known pairs regardless of their stored orientation', () => {
    const filterKnownPairs = candidateHelpers.filterKnownPairs;
    if (!filterKnownPairs) {
      expect(filterKnownPairs).toBeTypeOf('function');
      return;
    }

    expect(
      filterKnownPairs(
        [
          { sourceCardId: 'card-a', targetCardId: 'card-b', similarity: 0.99 },
          { sourceCardId: 'card-c', targetCardId: 'card-d', similarity: 0.98 },
        ],
        new Set(['card-a:card-b']),
      ),
    ).toEqual([
      { sourceCardId: 'card-c', targetCardId: 'card-d', similarity: 0.98 },
    ]);
  });

  test('prioritizes pairs that cover additional cards', () => {
    const rankCandidatesForCoverage = candidateHelpers.rankCandidatesForCoverage;
    if (!rankCandidatesForCoverage) {
      expect(rankCandidatesForCoverage).toBeTypeOf('function');
      return;
    }

    expect(
      rankCandidatesForCoverage(
        [
          { sourceCardId: 'card-a', targetCardId: 'card-b', similarity: 0.99 },
          { sourceCardId: 'card-a', targetCardId: 'card-c', similarity: 0.98 },
          { sourceCardId: 'card-d', targetCardId: 'card-e', similarity: 0.97 },
          { sourceCardId: 'card-f', targetCardId: 'card-g', similarity: 0.96 },
        ],
        3,
      ),
    ).toEqual([
      { sourceCardId: 'card-a', targetCardId: 'card-b', similarity: 0.99 },
      { sourceCardId: 'card-d', targetCardId: 'card-e', similarity: 0.97 },
      { sourceCardId: 'card-f', targetCardId: 'card-g', similarity: 0.96 },
    ]);
  });

  test('keeps a rank-21 pair after linked and dismissed pairs are removed', () => {
    const filterKnownPairs = candidateHelpers.filterKnownPairs;
    const rankCandidatesForCoverage = candidateHelpers.rankCandidatesForCoverage;
    if (!filterKnownPairs || !rankCandidatesForCoverage) {
      expect(filterKnownPairs).toBeTypeOf('function');
      expect(rankCandidatesForCoverage).toBeTypeOf('function');
      return;
    }

    const candidates = Array.from({ length: 21 }, (_, index) => ({
      sourceCardId: `card-${String(index).padStart(2, '0')}-a`,
      targetCardId: `card-${String(index).padStart(2, '0')}-b`,
      similarity: 1 - index / 100,
    }));
    const knownPairs = new Set([
      ...Array.from({ length: 10 }, (_, index) =>
        `card-${String(index).padStart(2, '0')}-a:card-${String(index).padStart(2, '0')}-b`,
      ),
      ...Array.from({ length: 10 }, (_, index) =>
        `card-${String(index + 10).padStart(2, '0')}-a:card-${String(index + 10).padStart(2, '0')}-b`,
      ),
    ]);

    expect(
      rankCandidatesForCoverage(filterKnownPairs(candidates, knownPairs), 20),
    ).toEqual([
      {
        sourceCardId: 'card-20-a',
        targetCardId: 'card-20-b',
        similarity: 0.8,
      },
    ]);
  });

  test('filters related links, dismissals, and same-label pairs before the cap', async () => {
    if (!createRelationshipDetector) {
      expect(createRelationshipDetector).toBeTypeOf('function');
      return;
    }

    const pair = (index: number) => ({
      sourceCardId: `card-${String(index).padStart(2, '0')}-a`,
      targetCardId: `card-${String(index).padStart(2, '0')}-b`,
    });
    const rows = Array.from({ length: 22 }, (_, index) => {
      const vector = Array.from({ length: 22 }, (_, vectorIndex) =>
        vectorIndex === index ? 1 : 0,
      );
      const ids = pair(index);
      return [
        { cardId: ids.sourceCardId, embedding: JSON.stringify(vector) },
        { cardId: ids.targetCardId, embedding: JSON.stringify(vector) },
      ];
    }).flat();
    const detector = createRelationshipDetector({
      loadDeck: async () => ({ id: 'deck-1' }),
      loadEmbeddedCards: async () => rows,
      loadExistingLinks: async () => [
        ...Array.from({ length: 10 }, (_, index) => ({
          ...pair(index),
          sourceCardId: pair(index).targetCardId,
          targetCardId: pair(index).sourceCardId,
          linkType: 'related',
        })),
        { ...pair(21), linkType: 'prerequisite' },
      ],
      loadDismissedSuggestions: async () =>
        Array.from({ length: 10 }, (_, index) => pair(index + 10)),
      getCardLabels: async (cardIds) =>
        new Map(cardIds.map((cardId) => [
          cardId,
          cardId.startsWith('card-20-') ? 'same label' : `Label ${cardId}`,
        ])),
      getCardTexts: async (cardIds) =>
        new Map(cardIds.map((cardId) => [cardId, `Text ${cardId}`])),
      verifyRelationships: async (candidates) =>
        candidates.map((candidate) => ({
          sourceCardId: candidate.sourceCardId,
          targetCardId: candidate.targetCardId,
          related: true,
          reason: 'Related concepts',
        })),
    });

    await expect(detector('user-1', 'deck-1')).resolves.toEqual({
      suggestions: [
        expect.objectContaining(pair(21)),
      ],
    });
  });
});
