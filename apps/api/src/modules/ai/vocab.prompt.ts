import type { BackLanguage } from './ai.service';

/**
 * Vocabulary prompt — word-level flashcard extraction.
 *
 * Goal: break text into INDIVIDUAL learnable words, each with definition,
 * IPA, part of speech, and example sentences.
 *
 * Key principle (modeled after Quizlet, Anki vocabulary decks, and
 * language-learning apps like Memrise/LingQ):
 *   → Maximize granularity — one word per card
 *   → Only keep multi-word as ONE card when it's a fixed term whose
 *     meaning cannot be understood from its parts (e.g. "machine learning")
 *   → For Vietnamese: keep compound từ ghép together because individual
 *     syllables have no standalone meaning
 */
export function buildVocabPrompt(
  sourceText: string,
  lang: BackLanguage,
): string {
  const defLang = lang === 'vi' ? 'Vietnamese' : 'English';
  return `You are an expert vocabulary flashcard creator for language learners. The student's goal is to BUILD THEIR VOCABULARY by learning individual words from a text.

## Task
Extract every word worth learning from the text. Create ONE flashcard per word. The student will memorize these words one by one using spaced repetition.

## Output format
Each flashcard MUST be a JSON object:
- "front": the word exactly as it appears in the source (keep original language/script, use base/dictionary form when appropriate — e.g. "observe" not "observed")
- "back": a clear, detailed definition in ${defLang}. Include:
  • Primary meaning as used in this text
  • Secondary common meanings if the word is polysemous (briefly)
  • For technical/domain terms: a plain-language explanation a student can understand
- "ipa": IPA phonetic transcription (e.g. "/ɪˈfem.ər.əl/"). Always include for English words.
- "wordType": part of speech in English (e.g. "noun", "verb", "adjective"). Always include.
- "examples": 1–2 example sentences using the word naturally, in the SAME language as the source text.

## Critical rules

### RULE 1 — MAXIMIZE word-level granularity (most important rule)
The purpose of vocabulary flashcards is to learn INDIVIDUAL WORDS. Break phrases into separate words whenever each word has independent meaning worth learning.

CORRECT approach for English text:
- "atmospheric phenomena" → TWO cards: "atmospheric" (adjective) + "phenomena" (noun)
- "severe convective storms" → THREE cards: "severe" + "convective" + "storm"
- "rapidly evolving" → TWO cards: "rapidly" (adverb) + "evolve" (verb, base form)

EXCEPTION — keep as ONE card ONLY when the phrase is a FIXED TERM whose meaning cannot be understood from its parts:
- "machine learning" → ONE card (technical term, not "machine" + "learning")
- "supply chain" → ONE card (business term)
- "Doppler radar" → ONE card (named technical concept)

For Vietnamese text: keep compound words (từ ghép) together because individual syllables often lack standalone meaning:
- "kỹ thuật" → ONE card (syllables "kỹ" and "thuật" are meaningless alone)
- "soạn thảo" → ONE card
- "hiện tượng" → ONE card

### RULE 2 — Use base/dictionary form
Convert inflected forms to their base form for the "front" field:
- "tornadoes" → "tornado"
- "phenomena" → keep "phenomenon" (or "phenomena" if learning the plural form is valuable)
- "evolving" → "evolve"
- "developed" → "develop"
This helps students learn the root word they can apply in any context.

### RULE 3 — Rich, detailed definitions
The "back" field is the student's primary learning material. Make it count:
- BAD: "atmospheric" → "relating to atmosphere" (too vague)
- GOOD: "atmospheric" → "${lang === 'vi' ? 'thuộc về khí quyển; liên quan đến tầng khí bao quanh Trái Đất. Trong ngữ cảnh khoa học: mô tả các hiện tượng xảy ra trong bầu khí quyển' : "relating to the atmosphere (the layer of gases surrounding Earth). In scientific contexts: describing phenomena that occur in the Earth's atmosphere. Also used figuratively to describe mood or ambiance."}"
- Include context-specific meaning + general meaning when relevant.

### RULE 4 — Skip common/trivial words
Do NOT create cards for basic words that any learner already knows:
- English: "the", "is", "a", "of", "to", "in", "and", "or", "such", "as", "by", "for", "with", "that", "this", "it", "was", "were", "be", "not", "on", "at", "from"
- Vietnamese: "của", "và", "là", "có", "được", "trong", "này", "để", "với", "các", "đã", "không", "cho", "như"
- Also skip: pronouns, basic prepositions, basic conjunctions, articles, determiners
- Focus on: nouns, verbs, adjectives, adverbs, and technical terms that carry REAL meaning

### RULE 5 — No duplicates
Each word appears as a flashcard only ONCE, even if it appears multiple times in the text. Use its most representative context for the example.

### RULE 6 — Grounded in source
Only extract words that actually appear in the text. Do NOT add related vocabulary not in the source.

### RULE 7 — Garbage in → empty out
If the input is gibberish, random characters, or has NO learnable vocabulary → return EXACTLY [].

### RULE 8 — Cover the text thoroughly
Extract ALL words worth learning — do not artificially limit the count. A paragraph with 15 learnable words should produce 15 cards. The student relies on completeness.

## Source text:
${sourceText}

Respond with ONLY a valid JSON array. Example for English text:
[{"front":"tornado","back":"${lang === 'vi' ? 'lốc xoáy; một cột không khí xoay mãnh liệt tiếp xúc với cả mặt đất và đám mây vũ tích. Là một trong những hiện tượng thời tiết nguy hiểm nhất, có thể đạt tốc độ gió trên 480 km/h' : 'a violently rotating column of air that extends from a thunderstorm cloud to the ground. One of the most destructive weather phenomena, with wind speeds that can exceed 300 mph'}","ipa":"/tɔːrˈneɪ.doʊ/","wordType":"noun","examples":"Scientists used mobile radar to observe tornadoes forming in real time."},{"front":"observation","back":"${lang === 'vi' ? 'sự quan sát; hành động theo dõi, ghi nhận một hiện tượng một cách có hệ thống. Trong khoa học: quá trình thu thập dữ liệu bằng cách quan sát trực tiếp' : 'the act of watching or monitoring something carefully and systematically. In science: the process of collecting data through direct watching and measurement'}","ipa":"/ˌɑːb.zɚˈveɪ.ʃən/","wordType":"noun","examples":"Mobile radar observation of tornadoes has revolutionized meteorology."}]
Or [] if nothing to extract. No markdown fences, no extra text.`;
}
