import { eq, and, inArray } from 'drizzle-orm';
import { db } from '../db';
import { cardFieldValues, templateFields } from '../db/schema';

// ── Text Extraction ──────────────────────────────────────────────────────────

/**
 * Build a single searchable text representation for a card by concatenating
 * its field values. Uses "front" fields first for search relevance.
 */
export async function getCardText(cardId: string): Promise<string | null> {
  const fields = await db
    .select({
      value: cardFieldValues.value,
      side: templateFields.side,
      sortOrder: templateFields.sortOrder,
    })
    .from(cardFieldValues)
    .innerJoin(
      templateFields,
      eq(cardFieldValues.templateFieldId, templateFields.id),
    )
    .where(eq(cardFieldValues.cardId, cardId))
    .orderBy(templateFields.side, templateFields.sortOrder);

  if (fields.length === 0) return null;

  const text = fields
    .map((f) => {
      const val = f.value;
      if (typeof val === 'string') return val;
      if (Array.isArray(val))
        return val.filter((x) => typeof x === 'string').join(' ');
      if (val && typeof val === 'object' && 'text' in val)
        return String((val as { text: unknown }).text);
      return JSON.stringify(val);
    })
    .filter(Boolean)
    .join(' ');

  return text.trim() || null;
}

// ── Label Extraction ─────────────────────────────────────────────────────────

/**
 * Get short front-field labels for multiple cards.
 * Returns: Map<cardId, label> — first front field value, truncated to 80 chars.
 */
export async function getCardLabels(
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
    if (map.has(r.cardId)) continue; // keep first (lowest sortOrder)
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

// ── Vector Math ──────────────────────────────────────────────────────────────

/**
 * Cosine similarity between two vectors.
 * Returns a value between -1 and 1 (1 = identical direction).
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ── Retention Formula ────────────────────────────────────────────────────────

/**
 * Compute retention using FSRS/SM-2 formula: R(t) = e^(-t/S)
 * Uses FSRS stability if available, otherwise approximates from SM-2 params.
 */
export function computeRetention(
  stability: number | null,
  intervalDays: number,
  easeFactor: number,
  daysSinceReview: number,
): number {
  const S =
    stability && stability > 0
      ? stability
      : Math.max(1, intervalDays * (easeFactor / 2.5));
  return Math.exp(-daysSinceReview / S);
}
