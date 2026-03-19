import { eq, and, sql, inArray } from 'drizzle-orm';
import { db } from '../../db';
import {
  studyProgress,
  cards,
  decks,
  cardFieldValues,
  templateFields,
} from '../../db/schema';

// ── Retention formula ────────────────────────────────────────────────────────
// FSRS: R(t) = e^(-t/S)   where S = stability, t = days elapsed
// SM-2 approx: S ≈ intervalDays × (easeFactor / 2.5), then same formula

function computeRetention(
  stability: number | null,
  intervalDays: number,
  easeFactor: number,
  daysSinceReview: number,
): number {
  // Use FSRS stability if available, otherwise approximate from SM-2 params
  const S =
    stability && stability > 0
      ? stability
      : Math.max(1, intervalDays * (easeFactor / 2.5));

  return Math.exp(-daysSinceReview / S);
}

function daysBetween(a: Date, b: Date): number {
  return Math.max(0, (b.getTime() - a.getTime()) / 86_400_000);
}

// ── Types ────────────────────────────────────────────────────────────────────

interface ProgressRow {
  cardId: string;
  stability: number | null;
  intervalDays: number;
  easeFactor: number;
  lastReviewedAt: Date | null;
  nextReviewAt: Date;
}

export interface ForecastDay {
  date: string;
  atRiskCount: number;
  avgRetention: number;
}

export interface HeatmapCard {
  cardId: string;
  retention: number;
  lastReviewed: string | null;
  nextReview: string;
  stability: number | null;
}

export interface AtRiskCard {
  cardId: string;
  deckId: string;
  deckName: string;
  retention: number;
  fields: { fieldName: string; side: string; value: unknown }[];
}

// ── Forecast endpoint ────────────────────────────────────────────────────────

/**
 * Predict how many cards will drop below retention threshold each day.
 *
 * Performance: single DB query → in-memory R(t) computation.
 * 1000 cards × 30 days = 30K Math.exp() calls ≈ <5ms.
 */
export async function getForecast(
  userId: string,
  days: number,
): Promise<{ forecast: ForecastDay[] }> {
  const clampedDays = Math.min(Math.max(days, 1), 90);
  const now = new Date();

  const progress = await fetchUserProgress(userId);

  const forecast: ForecastDay[] = [];

  for (let d = 0; d < clampedDays; d++) {
    const targetDate = new Date(now.getTime() + d * 86_400_000);
    let atRiskCount = 0;
    let totalRetention = 0;
    let reviewedCards = 0;

    for (const p of progress) {
      if (!p.lastReviewedAt) continue;
      reviewedCards++;

      const elapsed = daysBetween(p.lastReviewedAt, targetDate);
      const R = computeRetention(
        p.stability,
        p.intervalDays,
        p.easeFactor,
        elapsed,
      );
      totalRetention += R;

      if (R < 0.8) atRiskCount++;
    }

    forecast.push({
      date: targetDate.toISOString().slice(0, 10),
      atRiskCount,
      avgRetention:
        reviewedCards > 0
          ? Math.round((totalRetention / reviewedCards) * 1000) / 1000
          : 1,
    });
  }

  return { forecast };
}

// ── Retention heatmap ────────────────────────────────────────────────────────

/**
 * Get per-card retention values for a specific deck.
 * Frontend renders as color-coded grid (green → red).
 */
export async function getRetentionHeatmap(
  userId: string,
  deckId: string,
): Promise<{ cards: HeatmapCard[] }> {
  // Verify ownership
  const [deck] = await db
    .select({ id: decks.id })
    .from(decks)
    .where(and(eq(decks.id, deckId), eq(decks.userId, userId)))
    .limit(1);

  if (!deck) return { cards: [] };

  const now = new Date();

  const rows = await db
    .select({
      cardId: studyProgress.cardId,
      stability: studyProgress.stability,
      intervalDays: studyProgress.intervalDays,
      easeFactor: studyProgress.easeFactor,
      lastReviewedAt: studyProgress.lastReviewedAt,
      nextReviewAt: studyProgress.nextReviewAt,
    })
    .from(studyProgress)
    .innerJoin(cards, eq(studyProgress.cardId, cards.id))
    .where(and(eq(studyProgress.userId, userId), eq(cards.deckId, deckId)));

  const heatmapCards: HeatmapCard[] = rows.map((p) => {
    const elapsed = p.lastReviewedAt ? daysBetween(p.lastReviewedAt, now) : 0;
    const retention = computeRetention(
      p.stability,
      p.intervalDays,
      p.easeFactor,
      elapsed,
    );

    return {
      cardId: p.cardId,
      retention: Math.round(retention * 1000) / 1000,
      lastReviewed: p.lastReviewedAt?.toISOString() ?? null,
      nextReview: p.nextReviewAt.toISOString(),
      stability: p.stability,
    };
  });

  // Sort: lowest retention first (most at-risk on top)
  heatmapCards.sort((a, b) => a.retention - b.retention);

  return { cards: heatmapCards };
}

// ── At-risk cards ────────────────────────────────────────────────────────────

/**
 * Find cards that haven't reached their due date yet but already have
 * low predicted retention. These are "silently decaying" cards.
 */
export async function getAtRiskCards(
  userId: string,
  threshold = 0.8,
  limit = 20,
): Promise<{ atRisk: AtRiskCard[]; total: number }> {
  const now = new Date();

  // Fetch progress for cards NOT yet due (nextReviewAt > now)
  // but whose predicted retention may be low
  const progress = await db
    .select({
      cardId: studyProgress.cardId,
      deckId: cards.deckId,
      stability: studyProgress.stability,
      intervalDays: studyProgress.intervalDays,
      easeFactor: studyProgress.easeFactor,
      lastReviewedAt: studyProgress.lastReviewedAt,
    })
    .from(studyProgress)
    .innerJoin(cards, eq(studyProgress.cardId, cards.id))
    .innerJoin(decks, eq(cards.deckId, decks.id))
    .where(
      and(
        eq(studyProgress.userId, userId),
        eq(decks.userId, userId),
        sql`${studyProgress.nextReviewAt} > NOW()`,
        sql`${studyProgress.lastReviewedAt} IS NOT NULL`,
      ),
    );

  // Compute retention and filter
  const atRiskRaw: { cardId: string; deckId: string; retention: number }[] = [];

  for (const p of progress) {
    if (!p.lastReviewedAt) continue;
    const elapsed = daysBetween(p.lastReviewedAt, now);
    const R = computeRetention(
      p.stability,
      p.intervalDays,
      p.easeFactor,
      elapsed,
    );

    if (R < threshold) {
      atRiskRaw.push({ cardId: p.cardId, deckId: p.deckId, retention: R });
    }
  }

  // Sort by retention ascending (most at-risk first)
  atRiskRaw.sort((a, b) => a.retention - b.retention);

  const total = atRiskRaw.length;
  const topN = atRiskRaw.slice(0, limit);

  if (topN.length === 0) return { atRisk: [], total: 0 };

  // Enrich with fields + deck names
  const cardIds = topN.map((r) => r.cardId);
  const deckIds = [...new Set(topN.map((r) => r.deckId))];

  const [fieldRows, deckRows] = await Promise.all([
    db
      .select({
        cardId: cardFieldValues.cardId,
        fieldName: templateFields.name,
        side: templateFields.side,
        value: cardFieldValues.value,
      })
      .from(cardFieldValues)
      .innerJoin(
        templateFields,
        eq(cardFieldValues.templateFieldId, templateFields.id),
      )
      .where(inArray(cardFieldValues.cardId, cardIds)),
    db
      .select({ id: decks.id, name: decks.name })
      .from(decks)
      .where(inArray(decks.id, deckIds)),
  ]);

  const fieldsByCard = new Map<string, typeof fieldRows>();
  for (const f of fieldRows) {
    const arr = fieldsByCard.get(f.cardId) ?? [];
    arr.push(f);
    fieldsByCard.set(f.cardId, arr);
  }
  const deckNameMap = new Map(deckRows.map((d) => [d.id, d.name]));

  const atRisk: AtRiskCard[] = topN.map((r) => ({
    cardId: r.cardId,
    deckId: r.deckId,
    deckName: deckNameMap.get(r.deckId) ?? '',
    retention: Math.round(r.retention * 1000) / 1000,
    fields: (fieldsByCard.get(r.cardId) ?? []).map((f) => ({
      fieldName: f.fieldName,
      side: f.side,
      value: f.value,
    })),
  }));

  return { atRisk, total };
}

// ── Shared helper ────────────────────────────────────────────────────────────

async function fetchUserProgress(userId: string): Promise<ProgressRow[]> {
  return db
    .select({
      cardId: studyProgress.cardId,
      stability: studyProgress.stability,
      intervalDays: studyProgress.intervalDays,
      easeFactor: studyProgress.easeFactor,
      lastReviewedAt: studyProgress.lastReviewedAt,
      nextReviewAt: studyProgress.nextReviewAt,
    })
    .from(studyProgress)
    .where(eq(studyProgress.userId, userId));
}
