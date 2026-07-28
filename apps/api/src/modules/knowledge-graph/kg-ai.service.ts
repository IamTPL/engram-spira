import { eq, and, or, sql, inArray } from 'drizzle-orm';
import { db } from '../../db';
import { cards, decks, dismissedSuggestions } from '../../db/schema';
import { logger } from '../../shared/logger';
import { NotFoundError } from '../../shared/errors';
import {
  getCardLabels,
  getCardTexts,
} from '../../shared/embedding-utils';
import { verifyRelationships } from './relationship-verifier';
import { canonicalPair } from './kg.service';

export { canonicalPair } from './kg.service';

const kgAiLogger = logger.child({ module: 'kg-ai' });

// ── Types ────────────────────────────────────────────────────────────────────

export interface RelationshipSuggestion {
  sourceCardId: string;
  targetCardId: string;
  sourceLabel: string;
  targetLabel: string;
  similarity: number;
  suggestedType: 'related';
  reason?: string;
}

export interface RelationshipCandidate {
  sourceCardId: string;
  targetCardId: string;
  similarity: number;
}

function pairKey(sourceCardId: string, targetCardId: string) {
  return canonicalPair(sourceCardId, targetCardId).join(':');
}

export function filterKnownPairs(
  candidates: RelationshipCandidate[],
  knownPairs: Set<string>,
): RelationshipCandidate[] {
  return candidates
    .map((candidate) => {
      const [sourceCardId, targetCardId] = canonicalPair(
        candidate.sourceCardId,
        candidate.targetCardId,
      );
      return { ...candidate, sourceCardId, targetCardId };
    })
    .filter(
      (candidate) =>
        !knownPairs.has(pairKey(candidate.sourceCardId, candidate.targetCardId)),
    );
}

/**
 * Greedily favor pairs that introduce the most cards not yet represented in
 * the suggestion set, using similarity as the deterministic tie-breaker.
 */
export function rankCandidatesForCoverage(
  candidates: RelationshipCandidate[],
  maxSuggestions: number,
): RelationshipCandidate[] {
  const remaining = [...candidates].sort((a, b) => b.similarity - a.similarity);
  const selected: RelationshipCandidate[] = [];
  const coveredCardIds = new Set<string>();

  while (remaining.length > 0 && selected.length < maxSuggestions) {
    let bestIndex = 0;
    let bestNewCards = -1;

    for (let index = 0; index < remaining.length; index++) {
      const candidate = remaining[index];
      const newCards = Number(!coveredCardIds.has(candidate.sourceCardId)) +
        Number(!coveredCardIds.has(candidate.targetCardId));

      if (newCards > bestNewCards) {
        bestNewCards = newCards;
        bestIndex = index;
      }
    }

    const [candidate] = remaining.splice(bestIndex, 1);
    selected.push(candidate);
    coveredCardIds.add(candidate.sourceCardId);
    coveredCardIds.add(candidate.targetCardId);
  }

  return selected;
}

export type RelationshipDetectorLoaders = {
  loadDeck: (userId: string, deckId: string) => Promise<{ id: string } | null>;
  loadEmbeddedCards: (
    deckId: string,
  ) => Promise<Array<{ cardId: string; embedding: string }>>;
  loadExistingLinks: (cardIds: string[]) => Promise<Array<{
    sourceCardId: string;
    targetCardId: string;
    linkType: string;
  }>>;
  loadDismissedSuggestions: (
    userId: string,
    cardIds: string[],
  ) => Promise<Array<{ sourceCardId: string; targetCardId: string }>>;
  getCardLabels: typeof getCardLabels;
  getCardTexts: typeof getCardTexts;
  verifyRelationships: typeof verifyRelationships;
};

const defaultRelationshipDetectorLoaders: RelationshipDetectorLoaders = {
  async loadDeck(userId, deckId) {
    const [deck] = await db
      .select({ id: decks.id })
      .from(decks)
      .where(and(eq(decks.id, deckId), eq(decks.userId, userId)))
      .limit(1);
    return deck ?? null;
  },
  async loadEmbeddedCards(deckId) {
    const rows = await db.execute<{
      card_id: string;
      embedding: string;
    }>(sql`
      SELECT DISTINCT ON (cfv.card_id) cfv.card_id, cfv.embedding::text
      FROM card_field_values cfv
      JOIN cards c ON cfv.card_id = c.id
      WHERE c.deck_id = ${deckId}
        AND cfv.embedding IS NOT NULL
      ORDER BY cfv.card_id, cfv.id
      LIMIT 500
    `);
    return rows.map((row) => ({ cardId: row.card_id, embedding: row.embedding }));
  },
  async loadExistingLinks(cardIds) {
    if (cardIds.length === 0) return [];
    const { pgClient } = await import('../../db');
    const rows = await pgClient<
      { source_card_id: string; target_card_id: string; link_type: string }[]
    >`
      SELECT source_card_id, target_card_id, link_type FROM card_links
      WHERE link_type = 'related'
        AND (
          source_card_id = ANY(${cardIds}::uuid[])
          OR target_card_id = ANY(${cardIds}::uuid[])
        )
    `;
    return rows.map((row) => ({
      sourceCardId: row.source_card_id,
      targetCardId: row.target_card_id,
      linkType: row.link_type,
    }));
  },
  async loadDismissedSuggestions(userId, cardIds) {
    if (cardIds.length === 0) return [];
    return db
      .select({
        sourceCardId: dismissedSuggestions.sourceCardId,
        targetCardId: dismissedSuggestions.targetCardId,
      })
      .from(dismissedSuggestions)
      .where(
        and(
          eq(dismissedSuggestions.userId, userId),
          or(
            inArray(dismissedSuggestions.sourceCardId, cardIds),
            inArray(dismissedSuggestions.targetCardId, cardIds),
          ),
        ),
      );
  },
  getCardLabels,
  getCardTexts,
  verifyRelationships,
};

// ── AI Relationship Detection ────────────────────────────────────────────────

/**
 * Detect potential relationships between cards in a deck.
 *
 * Pipeline:
 * 1. Cosine similarity filter (threshold 0.75) — instant, uses pre-computed embeddings
 * 2. LLM verification of top candidates — ~200-400ms/call, filters false positives
 * 3. Return only LLM-confirmed pairs with reason
 *
 * Cost: ~$0.002 per deck of 200 cards (10 LLM calls × ~290 tokens each)
 */
async function detectRelationshipsWithLoaders(
  loaders: RelationshipDetectorLoaders,
  userId: string,
  deckId: string,
  threshold = 0.75,
  maxSuggestions = 20,
): Promise<{ suggestions: RelationshipSuggestion[] }> {
  const deck = await loaders.loadDeck(userId, deckId);

  if (!deck) throw new NotFoundError('Deck');

  const rows = await loaders.loadEmbeddedCards(deckId);

  if (rows.length < 2) return { suggestions: [] };

  // Parse vectors and cache their norms once instead of once per pair.
  const parsed = rows.map((row) => {
    const vec = JSON.parse(row.embedding) as number[];
    let squaredNorm = 0;
    for (const value of vec) squaredNorm += value * value;
    return {
      cardId: row.cardId,
      vec,
      norm: Math.sqrt(squaredNorm),
    };
  });

  // Half-matrix: only i < j (symmetric similarity, no need for full N²)
  const rawCandidates: RelationshipCandidate[] = [];

  for (let i = 0; i < parsed.length; i++) {
    for (let j = i + 1; j < parsed.length; j++) {
      let dot = 0;
      for (let k = 0; k < parsed[i].vec.length; k++) {
        dot += parsed[i].vec[k] * parsed[j].vec[k];
      }
      const denominator = parsed[i].norm * parsed[j].norm;
      const sim = denominator === 0 ? 0 : dot / denominator;

      if (sim >= threshold) {
        const [sourceCardId, targetCardId] = canonicalPair(
          parsed[i].cardId,
          parsed[j].cardId,
        );
        rawCandidates.push({ sourceCardId, targetCardId, similarity: sim });
      }
    }
  }

  if (rawCandidates.length === 0) return { suggestions: [] };

  // Canonicalize and reject same-label pairs before applying the suggestion cap.
  const candidateCardIds = [
    ...new Set(
      rawCandidates.flatMap((candidate) => [
        candidate.sourceCardId,
        candidate.targetCardId,
      ]),
    ),
  ];

  const labels = await loaders.getCardLabels(candidateCardIds);
  const distinctLabelCandidates = rawCandidates.filter((candidate) => {
    const sourceLabel = (labels.get(candidate.sourceCardId) ?? '').trim().toLowerCase();
    const targetLabel = (labels.get(candidate.targetCardId) ?? '').trim().toLowerCase();
    return sourceLabel !== targetLabel;
  });

  if (distinctLabelCandidates.length === 0) return { suggestions: [] };

  const filteredCardIds = [
    ...new Set(
      distinctLabelCandidates.flatMap((candidate) => [
        candidate.sourceCardId,
        candidate.targetCardId,
      ]),
    ),
  ];

  const [existingLinks, dismissedRows] = await Promise.all([
    loaders.loadExistingLinks(filteredCardIds),
    loaders.loadDismissedSuggestions(userId, filteredCardIds),
  ]);

  const knownPairs = new Set([
    ...existingLinks
      .filter((link) => link.linkType === 'related')
      .map((link) => pairKey(link.sourceCardId, link.targetCardId)),
    ...dismissedRows.map((dismissed) =>
      pairKey(dismissed.sourceCardId, dismissed.targetCardId),
    ),
  ]);

  const activeCandidates = rankCandidatesForCoverage(
    filterKnownPairs(distinctLabelCandidates, knownPairs),
    maxSuggestions,
  );

  if (activeCandidates.length === 0) return { suggestions: [] };

  // ── LLM Verification Step ──────────────────────────────────────────────────
  // Fetch card texts for each unique card in candidates
  const activeCardIds = [
    ...new Set(activeCandidates.flatMap((c) => [c.sourceCardId, c.targetCardId])),
  ];
  const cardTexts = await loaders.getCardTexts(activeCardIds);

  // Call LLM to verify each candidate
  const verificationInput = activeCandidates
    .filter(
      (candidate) =>
        cardTexts.has(candidate.sourceCardId) &&
        cardTexts.has(candidate.targetCardId),
    )
    .map((candidate) => ({
      sourceCardId: candidate.sourceCardId,
      targetCardId: candidate.targetCardId,
      sourceText: cardTexts.get(candidate.sourceCardId)!,
      targetText: cardTexts.get(candidate.targetCardId)!,
    }));

  kgAiLogger.info(
    {
      deckId,
      embeddingCandidates: rawCandidates.length,
      knownPairs: knownPairs.size,
      sameWordFiltered: rawCandidates.length - distinctLabelCandidates.length,
      llmVerifying: verificationInput.length,
    },
    'LLM verification starting',
  );

  const verified = await loaders.verifyRelationships(verificationInput);

  // Build a map of verified results for lookup
  const verifiedMap = new Map(
    verified.map((v) => [`${v.sourceCardId}:${v.targetCardId}`, v]),
  );

  // Build suggestions from only LLM-confirmed pairs
  const suggestions: RelationshipSuggestion[] = [];
  for (const candidate of activeCandidates) {
    const key = pairKey(candidate.sourceCardId, candidate.targetCardId);
    const verification = verifiedMap.get(key);

    // Only include LLM-confirmed relationships
    if (verification?.related) {
      suggestions.push({
        sourceCardId: candidate.sourceCardId,
        targetCardId: candidate.targetCardId,
        sourceLabel: labels.get(candidate.sourceCardId) ?? '',
        targetLabel: labels.get(candidate.targetCardId) ?? '',
        similarity: Math.round(candidate.similarity * 1000) / 1000,
        suggestedType: 'related',
        reason: verification.reason,
      });
    }
  }

  kgAiLogger.info(
    { deckId, verified: verified.length, confirmed: suggestions.length },
    'LLM verification complete',
  );

  return { suggestions };
}

export function createRelationshipDetector(
  loaders: RelationshipDetectorLoaders = defaultRelationshipDetectorLoaders,
) {
  return (
    userId: string,
    deckId: string,
    threshold = 0.75,
    maxSuggestions = 20,
  ) => detectRelationshipsWithLoaders(
    loaders,
    userId,
    deckId,
    threshold,
    maxSuggestions,
  );
}

export const detectRelationships = createRelationshipDetector();
