import { eq, and, sql, inArray } from 'drizzle-orm';
import { db } from '../../db';
import { cards, decks, cardFieldValues, dismissedSuggestions } from '../../db/schema';
import { logger } from '../../shared/logger';
import { NotFoundError } from '../../shared/errors';
import {
  getCardLabels,
  getCardTexts,
} from '../../shared/embedding-utils';
import { verifyRelationships } from './relationship-verifier';

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
export async function detectRelationships(
  userId: string,
  deckId: string,
  threshold = 0.75,
  maxSuggestions = 20,
): Promise<{ suggestions: RelationshipSuggestion[] }> {
  // Verify ownership
  const [deck] = await db
    .select({ id: decks.id })
    .from(decks)
    .where(and(eq(decks.id, deckId), eq(decks.userId, userId)))
    .limit(1);

  if (!deck) throw new NotFoundError('Deck');

  // Fetch all cards with embeddings in this deck
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

  if (rows.length < 2) return { suggestions: [] };

  // Parse vectors and cache their norms once instead of once per pair.
  const parsed = rows.map((row) => {
    const vec = JSON.parse(row.embedding) as number[];
    let squaredNorm = 0;
    for (const value of vec) squaredNorm += value * value;
    return {
      cardId: row.card_id,
      vec,
      norm: Math.sqrt(squaredNorm),
    };
  });

  // Half-matrix: only i < j (symmetric similarity, no need for full N²)
  const rawCandidates: { src: string; tgt: string; sim: number }[] = [];

  for (let i = 0; i < parsed.length; i++) {
    for (let j = i + 1; j < parsed.length; j++) {
      let dot = 0;
      for (let k = 0; k < parsed[i].vec.length; k++) {
        dot += parsed[i].vec[k] * parsed[j].vec[k];
      }
      const denominator = parsed[i].norm * parsed[j].norm;
      const sim = denominator === 0 ? 0 : dot / denominator;

      if (sim >= threshold) {
        const [a, b] =
          parsed[i].cardId < parsed[j].cardId
            ? [parsed[i].cardId, parsed[j].cardId]
            : [parsed[j].cardId, parsed[i].cardId];
        rawCandidates.push({ src: a, tgt: b, sim });
      }
    }
  }

  if (rawCandidates.length === 0) return { suggestions: [] };

  // Sort by similarity descending and limit candidates for LLM verification
  rawCandidates.sort((a, b) => b.sim - a.sim);
  const topCandidates = rawCandidates.slice(0, maxSuggestions);

  // Filter out already-linked pairs
  const candidateCardIds = [
    ...new Set(topCandidates.flatMap((candidate) => [candidate.src, candidate.tgt])),
  ];

  let existingLinks: { source_card_id: string; target_card_id: string }[] = [];
  if (candidateCardIds.length > 0) {
    const { pgClient } = await import('../../db');
    existingLinks = await pgClient<
      { source_card_id: string; target_card_id: string }[]
    >`
      SELECT source_card_id, target_card_id FROM card_links
      WHERE source_card_id = ANY(${candidateCardIds}::uuid[])
         OR target_card_id = ANY(${candidateCardIds}::uuid[])
    `;
  }

  const linkedSet = new Set(
    existingLinks.map((l) =>
      l.source_card_id < l.target_card_id
        ? `${l.source_card_id}:${l.target_card_id}`
        : `${l.target_card_id}:${l.source_card_id}`,
    ),
  );

  // Remove already-linked candidates before LLM verification (save API calls)
  const unlinkedCandidates = topCandidates.filter(
    (c) => !linkedSet.has(`${c.src}:${c.tgt}`),
  );

  if (unlinkedCandidates.length === 0) return { suggestions: [] };

  // Filter out dismissed suggestions
  const dismissedRows = await db
    .select({
      sourceCardId: dismissedSuggestions.sourceCardId,
      targetCardId: dismissedSuggestions.targetCardId,
    })
    .from(dismissedSuggestions)
    .where(
      and(
        eq(dismissedSuggestions.userId, userId),
        inArray(
          dismissedSuggestions.sourceCardId,
          unlinkedCandidates.map((c) => c.src),
        ),
      ),
    );

  const dismissedSet = new Set(
    dismissedRows.map((d) => {
      const [a, b] =
        d.sourceCardId < d.targetCardId
          ? [d.sourceCardId, d.targetCardId]
          : [d.targetCardId, d.sourceCardId];
      return `${a}:${b}`;
    }),
  );

  const activeCandidates = unlinkedCandidates.filter(
    (c) => !dismissedSet.has(`${c.src}:${c.tgt}`),
  );

  if (activeCandidates.length === 0) return { suggestions: [] };

  // Filter out same-word pairs (these are duplicates, not relationships)
  const candidateCardIdsForWords = [
    ...new Set(activeCandidates.flatMap((c) => [c.src, c.tgt])),
  ];
  const wordLabels = await getCardLabels(candidateCardIdsForWords);
  const filteredCandidates = activeCandidates.filter((c) => {
    const wordA = (wordLabels.get(c.src) ?? '').trim().toLowerCase();
    const wordB = (wordLabels.get(c.tgt) ?? '').trim().toLowerCase();
    return wordA !== wordB;
  });

  if (filteredCandidates.length === 0) return { suggestions: [] };

  // ── LLM Verification Step ──────────────────────────────────────────────────
  // Fetch card texts for each unique card in candidates
  const filteredCardIds = [
    ...new Set(filteredCandidates.flatMap((c) => [c.src, c.tgt])),
  ];
  const labels = await getCardLabels(filteredCardIds);
  const cardTexts = await getCardTexts(filteredCardIds);

  // Call LLM to verify each candidate
  const verificationInput = filteredCandidates
    .filter((c) => cardTexts.has(c.src) && cardTexts.has(c.tgt))
    .map((c) => ({
      sourceCardId: c.src,
      targetCardId: c.tgt,
      sourceText: cardTexts.get(c.src)!,
      targetText: cardTexts.get(c.tgt)!,
    }));

  kgAiLogger.info(
    { deckId, embeddingCandidates: rawCandidates.length, dismissed: dismissedSet.size, sameWordFiltered: activeCandidates.length - filteredCandidates.length, llmVerifying: verificationInput.length },
    'LLM verification starting',
  );

  const verified = await verifyRelationships(verificationInput);

  // Build a map of verified results for lookup
  const verifiedMap = new Map(
    verified.map((v) => [`${v.sourceCardId}:${v.targetCardId}`, v]),
  );

  // Build suggestions from only LLM-confirmed pairs
  const suggestions: RelationshipSuggestion[] = [];
  for (const candidate of filteredCandidates) {
    const key = `${candidate.src}:${candidate.tgt}`;
    const verification = verifiedMap.get(key);

    // Only include LLM-confirmed relationships
    if (verification?.related) {
      suggestions.push({
        sourceCardId: candidate.src,
        targetCardId: candidate.tgt,
        sourceLabel: labels.get(candidate.src) ?? '',
        targetLabel: labels.get(candidate.tgt) ?? '',
        similarity: Math.round(candidate.sim * 1000) / 1000,
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
