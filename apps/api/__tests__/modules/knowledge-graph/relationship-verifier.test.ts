import { describe, expect, test } from 'bun:test';

import type { GeminiProvider } from '../../../src/modules/ai/gemini-provider';
import { verifyRelationships } from '../../../src/modules/knowledge-graph/relationship-verifier';

describe('relationship-verifier', () => {
  describe('verifyRelationships', () => {
    test('preserves legacy per-pair JSON extraction through the provider boundary', async () => {
      const responses = [
        'Result: {"related":true,"reason":"same family"}',
        'not json',
      ];
      const prompts: string[] = [];
      const provider = {
        async generateText(request: { prompt: string }) {
          prompts.push(request.prompt);
          return {
            value: responses.shift()!,
            usage: { inputTokens: null, outputTokens: null },
          };
        },
      } as Pick<GeminiProvider, 'generateText'>;

      const result = await verifyRelationships(
        [
          {
            sourceCardId: 'card-1',
            targetCardId: 'card-2',
            sourceText: 'Father',
            targetText: 'Mother',
          },
          {
            sourceCardId: 'card-3',
            targetCardId: 'card-4',
            sourceText: 'Rain',
            targetText: 'Database',
          },
        ],
        provider,
      );

      expect(result).toEqual([
        {
          sourceCardId: 'card-1',
          targetCardId: 'card-2',
          related: true,
          reason: 'same family',
        },
      ]);
      expect(prompts).toHaveLength(2);
      expect(prompts[0]).toContain('Card A: "Father"');
      expect(prompts[0]).toContain('Card B: "Mother"');
    });
  });
});
