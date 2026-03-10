/**
 * AI Card Factory Service
 *
 * Uses Google Gemini to generate flashcards from user-provided text/topic.
 * Mode (vocabulary / Q&A) is auto-detected from the deck's card template.
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

const GEMINI_MODEL = 'gemini-2.5-flash';
const AI_TIMEOUT_MS = 30_000;

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
    throw new Error(
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

/**
 * Vocabulary prompt — generates rich cards with ipa, wordType, examples.
 * Only "back" (definition) is translated when lang='vi'.
 * All other fields stay in the original/standard language of the source.
 */
function buildVocabPrompt(sourceText: string, lang: BackLanguage): string {
  const defLang = lang === 'vi' ? 'Vietnamese' : 'English';
  return `You are a professional vocabulary flashcard creator.

Task: Extract every meaningful term, word, or phrase from the text and produce one flashcard per term.

Each flashcard MUST be a JSON object with these fields:
- "front": the term exactly as it appears in the source (keep original language and script)
- "back": a clear, concise definition or explanation written in ${defLang}
- "ipa": IPA phonetic transcription of the term (e.g. "/ɪˈfem.ər.əl/"). Omit if not applicable.
- "wordType": part of speech in English (e.g. "noun", "verb", "adjective", "phrase"). Omit if unclear.
- "examples": 1–2 natural example sentences using the term, written in the SAME language as the source text (do NOT translate). Omit if not helpful.

Strict rules:
1. ONLY include terms that genuinely appear in or are directly implied by the provided text.
2. Skip trivially common words ("the", "is", "and", etc.) unless the text is explicitly a word list.
3. If the input is random characters, gibberish, or has NO learnable vocabulary → return EXACTLY [].
4. Do NOT invent terms or definitions not grounded in the text.
5. Extract as many meaningful terms as the content supports — do not cap the count.
6. "ipa", "wordType", and "examples" must NEVER be translated — always keep original/standard form.

Source text:
${sourceText}

Respond with ONLY a valid JSON array. Example:
[{"front":"ephemeral","back":"${lang === 'vi' ? 'tồn tại trong thời gian ngắn' : 'lasting for a very short time'}","ipa":"/ɪˈfem.ər.əl/","wordType":"adjective","examples":"The ephemeral beauty of cherry blossoms draws millions of visitors."}]
Or [] if nothing to extract. No markdown fences, no extra text.`;
}

/**
 * Q&A prompt — generates comprehension question/answer cards.
 * The answer ("back") is written in the chosen language.
 */
function buildQAPrompt(sourceText: string, lang: BackLanguage): string {
  const answerLang = lang === 'vi' ? 'Vietnamese' : 'English';
  return `You are a professional Q&A flashcard creator for active recall learning.

Task: Generate flashcards that test deep understanding of the key concepts, facts, and ideas in the text.

Each flashcard MUST be a JSON object with exactly two fields:
- "front": a precise, clearly answerable question that targets ONE specific concept from the text
- "back": the correct answer written in ${answerLang}, derived strictly from the text

Strict rules:
1. Every question must be answerable using ONLY the provided text — no outside knowledge.
2. Each card tests exactly ONE concept. Avoid compound questions.
3. Prefer specific, concrete questions ("What causes X?" > "What is X mention?").
4. Avoid trivially obvious or meta questions ("What is the title?", "Who wrote this?").
5. If the input is random characters, gibberish, or has NO meaningful content → return EXACTLY [].
6. Generate as many cards as the content meaningfully supports — do not cap the count.

Source text:
${sourceText}

Respond with ONLY a valid JSON array like [{"front":"...","back":"..."}] or [] if nothing to generate. No markdown fences, no extra text.`;
}

// ── Core functions ──────────────────────────────────────

/**
 * Generate flashcards from text using Gemini. Returns a preview (job).
 * Mode is auto-detected from the deck's card template:
 *   - template with a "word" field → vocabulary mode (rich cards with ipa/wordType/examples)
 *   - otherwise → Q&A mode (front question / back answer)
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

  const genAI = getGenAI();
  const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });

  const prompt =
    mode === 'vocabulary'
      ? buildVocabPrompt(sourceText, backLanguage)
      : buildQAPrompt(sourceText, backLanguage);

  const result = await withTimeout(
    model.generateContent(prompt),
    AI_TIMEOUT_MS,
    'generating cards',
  );
  const text = result.response.text();

  // Parse the JSON response
  let generatedCards: GeneratedCard[];
  try {
    const cleaned = text
      .replace(/```(?:json)?\s*/g, '')
      .replace(/```/g, '')
      .trim();
    generatedCards = JSON.parse(cleaned);
    if (!Array.isArray(generatedCards)) throw new Error('Not an array');
  } catch {
    throw new Error('AI returned invalid response. Please try again.');
  }

  // Validate structure (no length cap — AI decides)
  generatedCards = generatedCards.filter(
    (c) => typeof c.front === 'string' && typeof c.back === 'string',
  );

  // If the model determined no meaningful content → return without saving a job
  if (generatedCards.length === 0) {
    return {
      jobId: null,
      cards: [],
      count: 0,
      message:
        'No meaningful content found in the provided text. Please enter a more specific topic or a document with learnable content.',
    };
  }

  // Save as a pending job
  const [job] = await db
    .insert(aiGenerationJobs)
    .values({
      userId,
      deckId,
      sourceText: sourceText.slice(0, 10000),
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
    message: null,
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
