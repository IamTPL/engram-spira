/**
 * AI Card Factory Service
 *
 * Uses Google Gemini to generate flashcards from user-provided text/topic.
 * Mode (vocabulary / Q&A) is auto-detected from the deck's card template.
 */
import { eq, and, lt, sql, inArray } from 'drizzle-orm';
import { db } from '../../db';
import {
  aiGenerationJobs,
  decks,
  cards,
  cardFieldValues,
  templateFields,
} from '../../db/schema';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../shared/errors';
import { getGenAI, checkAiRateLimit } from '../../config/ai';
import { buildVocabPrompt } from './vocab.prompt';
import { buildQAPrompt } from './qa.prompt';
import { ENV } from '../../config/env';

// ── AI timing constants ────────────────────────────────────────────────────
// Maximum wall-clock time for the entire streaming generation.
// Streaming keeps the connection active throughout, so this is a true
// safety net (e.g. Gemini hangs mid-stream) rather than an idle timeout.
const AI_STREAM_TIMEOUT_MS = 3 * 60 * 1_000; // 3 minutes

export type BackLanguage = 'vi' | 'en';

/**
 * Shape returned by the AI for both modes.
 * Vocabulary cards include extra fields (ipa, wordType, examples).
 * Q&A cards only use front + back.
 */
export interface GeneratedCard {
  front: string; // word (vocab) | question (qa)
  back: string; // definition (vocab) | answer (qa)
  ipa?: string; // IPA phonetics — vocab only, always in original language
  wordType?: string; // part of speech in English — vocab only
  examples?: string; // example sentences — vocab only, always in original language
}

interface TemplateInfo {
  mode: 'vocabulary' | 'qa';
  /** lowercase field name → field id */
  fieldMap: Map<string, string>;
  frontFieldId: string;
  backFieldId: string;
}

// ── Helpers ─────────────────────────────────────────────

async function verifyDeckOwnership(deckId: string, userId: string) {
  const [result] = await db
    .select({ id: decks.id, cardTemplateId: decks.cardTemplateId })
    .from(decks)
    .where(and(eq(decks.id, deckId), eq(decks.userId, userId)))
    .limit(1);
  if (!result) throw new NotFoundError('Deck');
  return result;
}

/**
 * Query template fields and return:
 *  - mode: 'vocabulary' if the template has a "word" field, else 'qa'
 *  - fieldMap: lowercase field name → field id (for saving vocab extras)
 *  - frontFieldId / backFieldId: primary field ids (first by sortOrder per side)
 */
async function getTemplateInfo(templateId: string): Promise<TemplateInfo> {
  const fields = await db
    .select({
      id: templateFields.id,
      name: templateFields.name,
      side: templateFields.side,
      sortOrder: templateFields.sortOrder,
    })
    .from(templateFields)
    .where(eq(templateFields.templateId, templateId));

  const sorted = fields.slice().sort((a, b) => a.sortOrder - b.sortOrder);
  const frontField = sorted.find((f) => f.side === 'front');
  const backField = sorted.find((f) => f.side === 'back');

  if (!frontField || !backField) {
    throw new ValidationError(
      'Deck template must have at least one front and one back field for AI generation',
    );
  }

  const fieldMap = new Map<string, string>();
  for (const f of sorted) {
    fieldMap.set(f.name.toLowerCase(), f.id);
  }

  // Vocabulary template contains a field named "word"
  const mode: 'vocabulary' | 'qa' = fieldMap.has('word') ? 'vocabulary' : 'qa';

  return {
    mode,
    fieldMap,
    frontFieldId: frontField.id,
    backFieldId: backField.id,
  };
}

// ── Core functions ──────────────────────────────────────

/**
 * Generate flashcards from text using Gemini.
 *
 * Returns immediately with a jobId (status='processing').
 * Gemini runs in the background — client polls GET /ai/jobs/:jobId.
 * On success: job transitions to 'pending' with cards.
 * On failure: job transitions to 'failed' with errorMessage.
 */
export async function generateCardsFromText(
  userId: string,
  deckId: string,
  sourceText: string,
  backLanguage: BackLanguage = 'vi',
) {
  checkAiRateLimit(userId);
  const deck = await verifyDeckOwnership(deckId, userId);
  const { mode } = await getTemplateInfo(deck.cardTemplateId);

  // Insert job immediately so client has a jobId to poll
  const [job] = await db
    .insert(aiGenerationJobs)
    .values({
      userId,
      deckId,
      sourceText: sourceText.slice(0, 10_000),
      cardCount: 0,
      generatedCards: null,
      model: ENV.GEMINI_MODEL,
      status: 'processing',
    })
    .returning();

  // Fire and forget — do not await
  void processJobInBackground(job.id, mode, sourceText, backLanguage);

  return { jobId: job.id, status: 'processing' };
}

/**
 * Calls Gemini and updates the job record when done.
 * Never throws — all errors become job status='failed'.
 */
async function processJobInBackground(
  jobId: string,
  mode: 'vocabulary' | 'qa',
  sourceText: string,
  backLanguage: BackLanguage,
) {
  const abortCtrl = new AbortController();
  const timer = setTimeout(() => abortCtrl.abort(), AI_STREAM_TIMEOUT_MS);

  try {
    const genAI = getGenAI();
    const model = genAI.getGenerativeModel(
      { model: ENV.GEMINI_MODEL },
      // Pass the signal so the underlying fetch is cancelled on timeout/abort
      { timeout: AI_STREAM_TIMEOUT_MS },
    );
    const prompt =
      mode === 'vocabulary'
        ? buildVocabPrompt(sourceText, backLanguage)
        : buildQAPrompt(sourceText, backLanguage);

    // Stream response — Gemini sends tokens progressively, so the connection
    // is always active. No idle-wait problem regardless of text length.
    const streamResult = await model.generateContentStream(prompt);

    let text = '';
    for await (const chunk of streamResult.stream) {
      if (abortCtrl.signal.aborted) {
        throw new Error(
          `AI generation timed out after ${AI_STREAM_TIMEOUT_MS / 1000}s`,
        );
      }
      text += chunk.text();
    }

    const cleaned = text
      .replace(/```(?:json)?\s*/g, '')
      .replace(/```/g, '')
      .trim();

    let generatedCards: GeneratedCard[];
    generatedCards = JSON.parse(cleaned);
    if (!Array.isArray(generatedCards)) throw new Error('Not an array');

    generatedCards = generatedCards.filter(
      (c) => typeof c.front === 'string' && typeof c.back === 'string',
    );

    // Vocabulary card fronts use Title Case (e.g. "peak performance", "machine learning" → "Peak Performance")
    if (mode === 'vocabulary') {
      generatedCards = generatedCards.map((c) => ({
        ...c,
        front: c.front.replace(/\b\w/g, (ch) => ch.toUpperCase()),
      }));
    }

    if (generatedCards.length === 0) {
      await db
        .update(aiGenerationJobs)
        .set({
          status: 'failed',
          errorMessage:
            'No meaningful content found. Please enter a more specific topic.',
        })
        .where(eq(aiGenerationJobs.id, jobId));
      return;
    }

    await db
      .update(aiGenerationJobs)
      .set({
        status: 'pending',
        generatedCards,
        cardCount: generatedCards.length,
      })
      .where(eq(aiGenerationJobs.id, jobId));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'AI generation failed';
    await db
      .update(aiGenerationJobs)
      .set({ status: 'failed', errorMessage: message })
      .where(eq(aiGenerationJobs.id, jobId));
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Save previously generated cards from a job into the deck.
 * Optionally accepts edited cards to override the AI output.
 */
export async function saveGeneratedCards(
  userId: string,
  jobId: string,
  editedCards?: GeneratedCard[],
) {
  const [job] = await db
    .select()
    .from(aiGenerationJobs)
    .where(
      and(eq(aiGenerationJobs.id, jobId), eq(aiGenerationJobs.userId, userId)),
    )
    .limit(1);

  if (!job) throw new NotFoundError('AI generation job');
  if (job.status !== 'pending') {
    throw new ConflictError('Job has already been saved or expired');
  }

  const deck = await verifyDeckOwnership(job.deckId, userId);
  const { mode, fieldMap, frontFieldId, backFieldId } = await getTemplateInfo(
    deck.cardTemplateId,
  );

  // If editedCards is provided (user edited in preview), merge with original AI output
  // to preserve vocab extra fields (ipa, wordType, examples) by index.
  const originalCards = job.generatedCards as GeneratedCard[];
  const cardsToSave: GeneratedCard[] = editedCards
    ? editedCards.map((edited, i) => ({
        ...(originalCards[i] ?? {}),
        front: edited.front,
        back: edited.back,
        // honour any extra fields explicitly sent by the client
        ...(edited.ipa !== undefined ? { ipa: edited.ipa } : {}),
        ...(edited.wordType !== undefined ? { wordType: edited.wordType } : {}),
        ...(edited.examples !== undefined ? { examples: edited.examples } : {}),
      }))
    : originalCards;

  if (!cardsToSave || cardsToSave.length === 0) {
    throw new ValidationError('No cards to save');
  }

  // Insert cards in a transaction
  const createdCards = await db.transaction(async (tx) => {
    // Lock deck row to serialize sort order assignment per deck.
    await tx.execute(
      sql`SELECT id FROM decks WHERE id = ${job.deckId} FOR UPDATE`,
    );

    const existing = await tx
      .select({ sortOrder: cards.sortOrder })
      .from(cards)
      .where(eq(cards.deckId, job.deckId))
      .orderBy(sql`${cards.sortOrder} DESC`)
      .limit(1);

    let nextOrder = existing.length > 0 ? existing[0].sortOrder + 1 : 0;

    const created = [];
    for (const card of cardsToSave) {
      const [newCard] = await tx
        .insert(cards)
        .values({ deckId: job.deckId, sortOrder: nextOrder++ })
        .returning();

      if (mode === 'vocabulary') {
        // Save all vocab fields by name lookup
        const wordFieldId = fieldMap.get('word') ?? frontFieldId;
        const defFieldId = fieldMap.get('definition') ?? backFieldId;
        const fieldValues: {
          cardId: string;
          templateFieldId: string;
          value: string;
        }[] = [
          {
            cardId: newCard.id,
            templateFieldId: wordFieldId,
            value: card.front,
          },
          { cardId: newCard.id, templateFieldId: defFieldId, value: card.back },
        ];
        if (card.ipa && fieldMap.has('ipa')) {
          fieldValues.push({
            cardId: newCard.id,
            templateFieldId: fieldMap.get('ipa')!,
            value: card.ipa,
          });
        }
        if (card.wordType && fieldMap.has('type')) {
          fieldValues.push({
            cardId: newCard.id,
            templateFieldId: fieldMap.get('type')!,
            value: card.wordType,
          });
        }
        if (card.examples && fieldMap.has('examples')) {
          fieldValues.push({
            cardId: newCard.id,
            templateFieldId: fieldMap.get('examples')!,
            value: card.examples,
          });
        }
        await tx.insert(cardFieldValues).values(fieldValues);
      } else {
        // Q&A: simple front → first front field, back → first back field
        await tx.insert(cardFieldValues).values([
          {
            cardId: newCard.id,
            templateFieldId: frontFieldId,
            value: card.front,
          },
          {
            cardId: newCard.id,
            templateFieldId: backFieldId,
            value: card.back,
          },
        ]);
      }

      created.push({ id: newCard.id, front: card.front, back: card.back });
    }
    return created;
  });

  // Mark job as saved
  await db
    .update(aiGenerationJobs)
    .set({ status: 'saved' })
    .where(eq(aiGenerationJobs.id, jobId));

  return { saved: createdCards.length, cards: createdCards };
}

/**
 * List AI generation jobs for a user (recent first).
 */
export async function listJobs(
  userId: string,
  limit: number = 20,
  status?: string,
) {
  const VALID_STATUSES = [
    'processing',
    'pending',
    'failed',
    'saved',
    'expired',
  ] as const;
  type ValidStatus = (typeof VALID_STATUSES)[number];

  const conditions = [eq(aiGenerationJobs.userId, userId)];
  if (status) {
    const statuses = status
      .split(',')
      .map((s) => s.trim())
      .filter((s): s is ValidStatus =>
        (VALID_STATUSES as readonly string[]).includes(s),
      );
    if (statuses.length > 0) {
      conditions.push(inArray(aiGenerationJobs.status, statuses));
    }
  }
  return db
    .select({
      id: aiGenerationJobs.id,
      deckId: aiGenerationJobs.deckId,
      status: aiGenerationJobs.status,
      cardCount: aiGenerationJobs.cardCount,
      model: aiGenerationJobs.model,
      createdAt: aiGenerationJobs.createdAt,
    })
    .from(aiGenerationJobs)
    .where(and(...conditions))
    .orderBy(sql`${aiGenerationJobs.createdAt} DESC`)
    .limit(limit);
}

/**
 * Get a specific job with generated cards.
 */
export async function getJob(userId: string, jobId: string) {
  const [job] = await db
    .select()
    .from(aiGenerationJobs)
    .where(
      and(eq(aiGenerationJobs.id, jobId), eq(aiGenerationJobs.userId, userId)),
    )
    .limit(1);

  if (!job) throw new NotFoundError('AI generation job');
  return job;
}

/**
 * Cleanup stale jobs older than 24h.
 * Marks 'pending' and 'processing' jobs as 'expired', deletes 'failed'.
 */
export async function cleanupExpiredJobs() {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [row] = await db.execute<{ expired: number }>(sql`
    WITH updated AS (
      UPDATE ai_generation_jobs
      SET status = 'expired'
      WHERE status IN ('pending', 'processing')
        AND created_at < ${cutoff}
      RETURNING 1
    )
    SELECT COUNT(*)::int AS expired FROM updated
  `);

  return { expired: row?.expired ?? 0 };
}

/**
 * Mark every 'processing' job as 'failed' on server startup.
 *
 * Any job still in 'processing' when the server starts is an orphan — its
 * background promise was killed by a previous server restart or crash.
 * The Gemini call will never complete, so we surface a clear error
 * immediately rather than leaving the frontend polling forever.
 */
export async function recoverOrphanedJobs() {
  const [row] = await db.execute<{ recovered: number }>(sql`
    WITH updated AS (
      UPDATE ai_generation_jobs
      SET status = 'failed',
          error_message = 'Generation was interrupted by a server restart. Please try again.'
      WHERE status = 'processing'
      RETURNING 1
    )
    SELECT COUNT(*)::int AS recovered FROM updated
  `);

  return { recovered: row?.recovered ?? 0 };
}
