import { describe, expect, test } from 'bun:test';

import type { GeminiProvider } from '../../../src/modules/ai/gemini-provider';
import {
  generateEmbedding,
  generateEmbeddings,
} from '../../../src/modules/embedding/embedding.service';

const vector = (value: number) =>
  Array.from({ length: 768 }, () => value);

describe('legacy embedding compatibility wrappers', () => {
  test('preserves single and batch raw-vector return values', async () => {
    const requests: string[][] = [];
    const provider = {
      async embedTexts(inputs: string[]) {
        requests.push(inputs);
        return {
          value: inputs.map((_, index) => vector(index + 0.1)),
          usage: { inputTokens: null, outputTokens: null },
        };
      },
    } as Pick<GeminiProvider, 'embedTexts'>;

    const single = await generateEmbedding('single', provider);
    const batch = await generateEmbeddings(['first', 'second'], provider);

    expect(single).toEqual(vector(0.1));
    expect(batch).toEqual([vector(0.1), vector(1.1)]);
    expect(requests).toEqual([['single'], ['first', 'second']]);
  });
});
