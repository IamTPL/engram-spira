import { GoogleGenerativeAI } from '@google/generative-ai';
import { ENV } from '../../config/env';
import { logger } from '../../shared/logger';

const verifierLogger = logger.child({ module: 'relationship-verifier' });

let _genAI: GoogleGenerativeAI | null = null;
function getGenAI(): GoogleGenerativeAI {
  if (!_genAI) _genAI = new GoogleGenerativeAI(ENV.GEMINI_API_KEY);
  return _genAI;
}

export interface VerificationResult {
  sourceCardId: string;
  targetCardId: string;
  related: boolean;
  reason: string;
}

const VERIFICATION_PROMPT = `You are an educational relationship classifier for a flashcard learning app. Given two flashcard contents, determine if they are meaningfully related for building a knowledge graph.

Card A: "{cardA}"
Card B: "{cardB}"

Respond with EXACTLY one JSON object, no markdown:
{"related": true/false, "reason": "one short sentence explaining the relationship"}

A pair IS related (true) when:
- They belong to the same semantic family or hierarchy (e.g. Father ↔ Mother, Dog ↔ Cat, CPU ↔ RAM)
- One is a parent/child/sibling/member of the same category as the other
- Synonyms, antonyms, cause-effect, part-whole, or complementary concepts
- Understanding one directly aids understanding the other
- They would logically appear together in a mind map, family tree, or taxonomy

A pair is NOT related (false) when:
- They share a broad domain but have no direct conceptual link (e.g. "Cloud" in weather vs "Database" in computing)
- The connection is superficial or requires multiple reasoning leaps
- They are completely different topics

When in doubt for vocabulary cards from the same deck, lean toward true — the user grouped them together intentionally.`;

/**
 * Verify a batch of relationship candidates using Gemini LLM.
 * Processes sequentially to respect rate limits.
 * Returns results for all candidates (both related and not).
 */
export async function verifyRelationships(
  candidates: {
    sourceCardId: string;
    targetCardId: string;
    sourceText: string;
    targetText: string;
  }[],
): Promise<VerificationResult[]> {
  if (candidates.length === 0) return [];

  const model = getGenAI().getGenerativeModel({
    model: ENV.GEMINI_MODEL ?? 'gemini-3-flash-preview',
  });

  const results: VerificationResult[] = [];

  for (const candidate of candidates) {
    try {
      const prompt = VERIFICATION_PROMPT.replace(
        '{cardA}',
        candidate.sourceText.slice(0, 200),
      ).replace('{cardB}', candidate.targetText.slice(0, 200));

      const result = await model.generateContent(prompt);
      const text = result.response.text().trim();

      // Parse JSON response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        verifierLogger.warn({ text }, 'LLM returned non-JSON response');
        continue;
      }

      const parsed = JSON.parse(jsonMatch[0]) as {
        related: boolean;
        reason: string;
      };
      results.push({
        sourceCardId: candidate.sourceCardId,
        targetCardId: candidate.targetCardId,
        related: parsed.related === true,
        reason: parsed.reason ?? '',
      });
    } catch (err) {
      verifierLogger.warn(
        {
          err: err instanceof Error ? err.message : String(err),
          pair: `${candidate.sourceCardId}:${candidate.targetCardId}`,
        },
        'LLM verification failed for pair — skipping',
      );
    }
  }

  return results;
}
