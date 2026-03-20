import { eq, and, or, inArray, sql } from 'drizzle-orm';
import { db } from '../../db';
import {
  cardLinks,
  cardConcepts,
  cards,
  decks,
  cardFieldValues,
  templateFields,
  studyProgress,
} from '../../db/schema';
import { NotFoundError } from '../../shared/errors';
import { computeRetention, getCardLabels } from '../../shared/embedding-utils';

// ── Types ────────────────────────────────────────────────────────────────────

export interface GraphNode {
  id: string;
  label: string;
  retention: number | null;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: string;
}

export interface CardLink {
  id: string;
  sourceCardId: string;
  targetCardId: string;
  linkType: string;
  createdAt: Date;
}

// ── Ownership verification ───────────────────────────────────────────────────

async function verifyCardOwnership(cardId: string, userId: string) {
  const [result] = await db
    .select({ id: cards.id })
    .from(cards)
    .innerJoin(decks, and(eq(cards.deckId, decks.id), eq(decks.userId, userId)))
    .where(eq(cards.id, cardId))
    .limit(1);
  if (!result) throw new NotFoundError('Card');
  return result;
}

// ── Link CRUD ────────────────────────────────────────────────────────────────

export async function createLink(
  userId: string,
  sourceCardId: string,
  targetCardId: string,
  linkType: 'related' = 'related',
): Promise<CardLink> {
  // Verify ownership of both cards in parallel
  await Promise.all([
    verifyCardOwnership(sourceCardId, userId),
    verifyCardOwnership(targetCardId, userId),
  ]);

  const [link] = await db
    .insert(cardLinks)
    .values({ sourceCardId, targetCardId, linkType })
    .onConflictDoNothing()
    .returning();

  if (!link) {
    // Link already exists — fetch and return it
    const [existing] = await db
      .select()
      .from(cardLinks)
      .where(
        and(
          eq(cardLinks.sourceCardId, sourceCardId),
          eq(cardLinks.targetCardId, targetCardId),
        ),
      )
      .limit(1);
    return existing;
  }

  return link;
}

export async function deleteLink(userId: string, linkId: string) {
  // Verify the link exists and user owns at least one of the cards
  const [link] = await db
    .select({
      id: cardLinks.id,
      sourceCardId: cardLinks.sourceCardId,
      targetCardId: cardLinks.targetCardId,
    })
    .from(cardLinks)
    .where(eq(cardLinks.id, linkId))
    .limit(1);

  if (!link) throw new NotFoundError('Card link');

  // Verify user owns at least the source card
  await verifyCardOwnership(link.sourceCardId, userId);

  await db.delete(cardLinks).where(eq(cardLinks.id, linkId));
  return { deleted: true };
}

export async function getCardLinks(userId: string, cardId: string) {
  await verifyCardOwnership(cardId, userId);

  const links = await db
    .select()
    .from(cardLinks)
    .where(
      or(
        eq(cardLinks.sourceCardId, cardId),
        eq(cardLinks.targetCardId, cardId),
      ),
    );

  // Split into outgoing/incoming
  const outgoing = links.filter((l) => l.sourceCardId === cardId);
  const incoming = links.filter((l) => l.targetCardId === cardId);

  // Fetch preview text for linked cards
  const linkedCardIds = [
    ...outgoing.map((l) => l.targetCardId),
    ...incoming.map((l) => l.sourceCardId),
  ];

  const previews = linkedCardIds.length > 0
    ? await getCardPreviews(linkedCardIds)
    : new Map<string, string>();

  return {
    outgoing: outgoing.map((l) => ({
      ...l,
      targetLabel: previews.get(l.targetCardId) ?? '',
    })),
    incoming: incoming.map((l) => ({
      ...l,
      sourceLabel: previews.get(l.sourceCardId) ?? '',
    })),
  };
}

// ── Deck graph ───────────────────────────────────────────────────────────────

/**
 * Get full graph data for a deck: nodes (cards) + edges (links).
 * Single JOIN query for nodes, single query for edges — no N+1.
 */
export async function getDeckGraph(
  userId: string,
  deckId: string,
): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  // Verify deck ownership
  const [deck] = await db
    .select({ id: decks.id })
    .from(decks)
    .where(and(eq(decks.id, deckId), eq(decks.userId, userId)))
    .limit(1);

  if (!deck) throw new NotFoundError('Deck');

  // Fetch all cards in deck with first field value (label) + retention
  const cardRows = await db
    .select({
      id: cards.id,
      sortOrder: cards.sortOrder,
    })
    .from(cards)
    .where(eq(cards.deckId, deckId))
    .orderBy(cards.sortOrder);

  if (cardRows.length === 0) return { nodes: [], edges: [] };

  const cardIds = cardRows.map((c) => c.id);

  // Parallel: retention + links (labels fetched separately via getCardLabels)
  const [progressRows, linkRows] = await Promise.all([
    db
      .select({
        cardId: studyProgress.cardId,
        stability: studyProgress.stability,
        intervalDays: studyProgress.intervalDays,
        easeFactor: studyProgress.easeFactor,
        lastReviewedAt: studyProgress.lastReviewedAt,
      })
      .from(studyProgress)
      .where(
        and(
          eq(studyProgress.userId, userId),
          inArray(studyProgress.cardId, cardIds),
        ),
      ),
    db
      .select()
      .from(cardLinks)
      .where(
        or(
          inArray(cardLinks.sourceCardId, cardIds),
          inArray(cardLinks.targetCardId, cardIds),
        ),
      ),
  ]);

  // Build label map using shared utility
  const labelMap = await getCardLabels(cardIds);

  // Build retention map
  const retentionMap = new Map<string, number>();
  const now = new Date();
  for (const p of progressRows) {
    if (!p.lastReviewedAt) continue;
    const elapsed = Math.max(
      0,
      (now.getTime() - p.lastReviewedAt.getTime()) / 86_400_000,
    );
    retentionMap.set(p.cardId, computeRetention(p.stability, p.intervalDays, p.easeFactor, elapsed));
  }

  // Build nodes
  const nodes: GraphNode[] = cardRows.map((c) => ({
    id: c.id,
    label: labelMap.get(c.id) ?? `Card ${c.sortOrder + 1}`,
    retention: retentionMap.has(c.id)
      ? Math.round(retentionMap.get(c.id)! * 1000) / 1000
      : null,
  }));

  // Build edges (only between cards within this deck)
  const cardIdSet = new Set(cardIds);
  const edges: GraphEdge[] = linkRows
    .filter(
      (l) => cardIdSet.has(l.sourceCardId) && cardIdSet.has(l.targetCardId),
    )
    .map((l) => ({
      id: l.id,
      source: l.sourceCardId,
      target: l.targetCardId,
      type: l.linkType,
    }));

  return { nodes, edges };
}

// ── Search for linking ───────────────────────────────────────────────────────

/**
 * Search user's cards for potential link targets.
 * Text-based ILIKE search — fast, no embedding needed.
 */
export async function searchCardsForLinking(
  userId: string,
  query: string,
  excludeCardId?: string,
  limit = 10,
): Promise<
  { cardId: string; deckId: string; deckName: string; label: string }[]
> {
  const pattern = `%${query.replace(/[%_]/g, '\\$&')}%`;

  const excludeClause = excludeCardId
    ? sql`AND c.id != ${excludeCardId}`
    : sql``;

  const rows = await db.execute<{
    card_id: string;
    deck_id: string;
    deck_name: string;
    label: string;
  }>(sql`
    SELECT DISTINCT ON (c.id)
      c.id AS card_id,
      d.id AS deck_id,
      d.name AS deck_name,
      cfv.value::text AS label
    FROM card_field_values cfv
    JOIN cards c ON cfv.card_id = c.id
    JOIN decks d ON c.deck_id = d.id
    JOIN template_fields tf ON cfv.template_field_id = tf.id
    WHERE d.user_id = ${userId}
      AND cfv.value::text ILIKE ${pattern}
      AND tf.side = 'front'
      ${excludeClause}
    ORDER BY c.id, tf.sort_order
    LIMIT ${limit}
  `);

  return rows.map((r) => ({
    cardId: r.card_id,
    deckId: r.deck_id,
    deckName: r.deck_name,
    label: r.label.slice(0, 100),
  }));
}
// Concept CRUD removed — no frontend consumer

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getCardPreviews(
  cardIds: string[],
): Promise<Map<string, string>> {
  if (cardIds.length === 0) return new Map();

  const rows = await db
    .select({
      cardId: cardFieldValues.cardId,
      value: cardFieldValues.value,
      sortOrder: templateFields.sortOrder,
    })
    .from(cardFieldValues)
    .innerJoin(
      templateFields,
      eq(cardFieldValues.templateFieldId, templateFields.id),
    )
    .where(
      and(
        inArray(cardFieldValues.cardId, cardIds),
        eq(templateFields.side, 'front'),
      ),
    )
    .orderBy(templateFields.sortOrder);

  const map = new Map<string, string>();
  for (const r of rows) {
    if (map.has(r.cardId)) continue;
    const text =
      typeof r.value === 'string'
        ? r.value
        : r.value && typeof r.value === 'object' && 'text' in r.value
          ? String((r.value as { text: unknown }).text)
          : JSON.stringify(r.value);
    map.set(r.cardId, text.slice(0, 80));
  }

  return map;
}
