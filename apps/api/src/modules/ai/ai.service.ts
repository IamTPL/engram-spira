/**
 * AI Card Factory Service
 *
 * Uses Google Gemini to generate flashcards from user-provided text/topic.
 * Supports: generate (preview), save, improve single card.
 */
import { eq, and, lt, sql } from 'drizzle-orm';
import { db } from '../../db';
import {
  aiGenerationJobs,
  decks,
  cards,
  cardFieldValues,
  templateFields,
} from '../../db/schema';
import { NotFoundError } from '../../shared/errors';
import { getGenAI, checkAiRateLimit } from '../../config/ai';

const GEMINI_MODEL = 'gemini-2.0-flash';
const AI_TIMEOUT_MS = 30_000;

export interface GeneratedCard {
  front: string;
  back: string;
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  op: string,
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`AI timeout while ${op}`)), ms);
    }),
  ]);
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

/** Get the Front and Back template field IDs for a deck's template. */
async function getTemplateFieldIds(templateId: string) {
  const fields = await db
    .select({ id: templateFields.id, name: templateFields.name })
    .from(templateFields)
    .where(eq(templateFields.templateId, templateId));

  const frontField = fields.find(
    (f) =>
      f.name.toLowerCase() === 'front' || f.name.toLowerCase() === 'mặt trước', // legacy Vietnamese field name
  );
  const backField = fields.find(
    (f) =>
      f.name.toLowerCase() === 'back' || f.name.toLowerCase() === 'mặt sau', // legacy Vietnamese field name
  );

  if (!frontField || !backField) {
    throw new Error(
      'Deck template must have Front and Back fields for AI generation',
    );
  }

  return { frontFieldId: frontField.id, backFieldId: backField.id };
}

function buildPrompt(sourceText: string, cardCount: number): string {
  return `You are an expert flashcard creator. Generate exactly ${cardCount} high-quality flashcards from the following text/topic.

Rules:
- Each card should test ONE concept
- Front: Clear, specific question or prompt
- Back: Concise, accurate answer
- Avoid trivial or overly broad questions
- Use active recall principles
- If the text is in Vietnamese, generate cards in Vietnamese
- If the text is in English, generate cards in English

Source text:
${sourceText}

Respond ONLY with a JSON array of objects, each with "front" and "back" keys. No extra text, no markdown fences.
Example: [{"front":"What is X?","back":"X is..."},{"front":"How does Y work?","back":"Y works by..."}]`;
}

function buildImprovePrompt(front: string, back: string): string {
  return `You are an expert flashcard editor. Improve this flashcard to be clearer, more concise, and more effective for learning.

Current card:
- Front: ${front}
- Back: ${back}

Rules:
- Keep the same language as the original
- Make the question more specific and testable
- Make the answer more concise and memorable
- Ensure factual accuracy

Respond ONLY with a JSON object: {"front":"...","back":"..."}. No extra text.`;
}

// ── Core functions ──────────────────────────────────────

/**
 * Generate flashcards from text using Gemini. Returns a preview (job).
 */
export async function generateCardsFromText(
  userId: string,
  deckId: string,
  sourceText: string,
  cardCount: number = 10,
) {
  checkAiRateLimit(userId);
  await verifyDeckOwnership(deckId, userId);

  const genAI = getGenAI();
  const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });

  const prompt = buildPrompt(sourceText, Math.min(cardCount, 50));
  const result = await withTimeout(
    model.generateContent(prompt),
    AI_TIMEOUT_MS,
    'generating cards',
  );
  const text = result.response.text();

  // Parse the JSON response
  let generatedCards: GeneratedCard[];
  try {
    // Strip markdown code fences if present
    const cleaned = text
      .replace(/```(?:json)?\s*/g, '')
      .replace(/```/g, '')
      .trim();
    generatedCards = JSON.parse(cleaned);
    if (!Array.isArray(generatedCards)) throw new Error('Not an array');
  } catch {
    throw new Error('AI returned invalid response. Please try again.');
  }

  // Validate structure
  generatedCards = generatedCards
    .filter((c) => typeof c.front === 'string' && typeof c.back === 'string')
    .slice(0, cardCount);

  // Save as a pending job
  const [job] = await db
    .insert(aiGenerationJobs)
    .values({
      userId,
      deckId,
      sourceText: sourceText.slice(0, 10000), // Limit stored text
      cardCount: generatedCards.length,
      generatedCards,
      model: GEMINI_MODEL,
      status: 'pending',
    })
    .returning();

  return {
    jobId: job.id,
    cards: generatedCards,
    count: generatedCards.length,
  };
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
    throw new Error('Job has already been saved or expired');
  }

  const deck = await verifyDeckOwnership(job.deckId, userId);
  const { frontFieldId, backFieldId } = await getTemplateFieldIds(
    deck.cardTemplateId,
  );

  const cardsToSave = editedCards ?? (job.generatedCards as GeneratedCard[]);
  if (!cardsToSave || cardsToSave.length === 0) {
    throw new Error('No cards to save');
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

      await tx.insert(cardFieldValues).values([
        {
          cardId: newCard.id,
          templateFieldId: frontFieldId,
          value: card.front,
        },
        { cardId: newCard.id, templateFieldId: backFieldId, value: card.back },
      ]);

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
 * Improve a single flashcard using AI.
 */
export async function improveCard(userId: string, front: string, back: string) {
  checkAiRateLimit(userId);

  const genAI = getGenAI();
  const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });

  const prompt = buildImprovePrompt(front, back);
  const result = await withTimeout(
    model.generateContent(prompt),
    AI_TIMEOUT_MS,
    'improving card',
  );
  const text = result.response.text();

  try {
    const cleaned = text
      .replace(/```(?:json)?\s*/g, '')
      .replace(/```/g, '')
      .trim();
    const improved = JSON.parse(cleaned);
    return {
      front: String(improved.front),
      back: String(improved.back),
    };
  } catch {
    throw new Error('AI returned invalid response. Please try again.');
  }
}

/**
 * List AI generation jobs for a user (recent first).
 */
export async function listJobs(userId: string, limit: number = 20) {
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
    .where(eq(aiGenerationJobs.userId, userId))
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
 * Cleanup expired pending jobs older than 24h.
 * Should be called periodically (e.g. cron or on-demand).
 */
export async function cleanupExpiredJobs() {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const result = await db
    .update(aiGenerationJobs)
    .set({ status: 'expired' })
    .where(
      and(
        eq(aiGenerationJobs.status, 'pending'),
        lt(aiGenerationJobs.createdAt, cutoff),
      ),
    );

  return { cleaned: (result as any).rowCount ?? 0 };
}

// =====================================================================
// Embedding & Duplicate Detection (pgvector)
// =====================================================================

const EMBEDDING_MODEL = 'text-embedding-004';

/**
 * Generate an embedding vector for a text string using Gemini.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const genAI = getGenAI();
  const model = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });
  const result = await withTimeout(
    model.embedContent(text),
    AI_TIMEOUT_MS,
    'embedding content',
  );
  return result.embedding.values;
}

/**
 * Store an embedding for a card_field_value row.
 * Called fire-and-forget after card creation.
 */
export async function storeEmbedding(cardFieldValueId: string, text: string) {
  try {
    const embedding = await generateEmbedding(text);
    const vecStr = `[${embedding.join(',')}]`;
    await db.execute(
      sql`UPDATE card_field_values SET embedding = ${vecStr}::vector WHERE id = ${cardFieldValueId}`,
    );
  } catch (err) {
    // Fire-and-forget: log but don't throw
    console.error('Failed to store embedding:', err);
  }
}

/**
 * Generate and store embeddings for all field values of a card.
 * Combines front+back text for the embedding.
 */
export async function embedCardFields(cardId: string) {
  const fieldValues = await db
    .select({
      id: cardFieldValues.id,
      value: cardFieldValues.value,
      fieldName: templateFields.name,
    })
    .from(cardFieldValues)
    .innerJoin(
      templateFields,
      eq(cardFieldValues.templateFieldId, templateFields.id),
    )
    .where(eq(cardFieldValues.cardId, cardId));

  // Embed the "front" field value — the most distinctive content for duplicate detection
  const frontField = fieldValues.find(
    (f) =>
      f.fieldName.toLowerCase() === 'front' ||
      f.fieldName.toLowerCase() === 'mặt trước', // legacy Vietnamese field name
  );
  if (frontField && typeof frontField.value === 'string') {
    await storeEmbedding(frontField.id, frontField.value);
  }
}

/**
 * Check for duplicate cards in a deck based on cosine similarity.
 * Returns cards with similarity above the threshold.
 */
export async function checkDuplicates(
  userId: string,
  deckId: string,
  text: string,
  threshold: number = 0.85,
) {
  checkAiRateLimit(userId);
  await verifyDeckOwnership(deckId, userId);

  const embedding = await generateEmbedding(text);
  const vecStr = `[${embedding.join(',')}]`;

  // Find similar cards in the same deck using cosine similarity
  const results = await db.execute(sql`
    SELECT
      cfv.card_id,
      cfv.value as front_text,
      1 - (cfv.embedding <=> ${vecStr}::vector) as similarity
    FROM card_field_values cfv
    INNER JOIN cards c ON c.id = cfv.card_id
    INNER JOIN template_fields tf ON tf.id = cfv.template_field_id
    WHERE c.deck_id = ${deckId}
      AND cfv.embedding IS NOT NULL
      AND LOWER(tf.name) IN ('front', 'mặt trước') /* legacy Vietnamese field name */
      AND 1 - (cfv.embedding <=> ${vecStr}::vector) > ${threshold}
    ORDER BY similarity DESC
    LIMIT 10
  `);

  return {
    duplicates: (results as any[]).map((r: any) => ({
      cardId: r.card_id,
      frontText: r.front_text,
      similarity: Math.round(r.similarity * 1000) / 1000,
    })),
  };
}

/**
 * Assess the quality of a flashcard using AI.
 */
export async function qualityScore(
  userId: string,
  front: string,
  back: string,
) {
  checkAiRateLimit(userId);

  const genAI = getGenAI();
  const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });

  const prompt = `Rate this flashcard's quality on a scale of 1-10. Consider:
- Specificity: Is the question clear and testable? (not too vague)
- Conciseness: Is the answer brief and focused?
- Accuracy: Does the answer correctly address the question?
- Recall-friendliness: Does it test active recall effectively?

Card:
- Front: ${front}
- Back: ${back}

Respond ONLY with a JSON object: {"score": <1-10>, "feedback": "<brief improvement suggestion>"}`;

  const result = await withTimeout(
    model.generateContent(prompt),
    AI_TIMEOUT_MS,
    'scoring card quality',
  );
  const text = result.response.text();

  try {
    const cleaned = text
      .replace(/```(?:json)?\s*/g, '')
      .replace(/```/g, '')
      .trim();
    const parsed = JSON.parse(cleaned);
    return {
      score: Math.max(1, Math.min(10, Number(parsed.score) || 5)),
      feedback: String(parsed.feedback ?? ''),
    };
  } catch {
    return {
      score: 5,
      feedback: 'Unable to assess quality. Please try again.',
    };
  }
}
