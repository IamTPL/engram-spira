import { describe, expect, test } from 'bun:test';

import {
  assertKnowledgeGraphV2Enabled,
  createDeckRun,
  createSenseExpansionRun,
} from '../../../src/modules/knowledge-graph/kg-api.service';
import { ConflictError } from '../../../src/shared/errors';

const id = (value: number) =>
  `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;

describe('knowledge graph API facade feature gate', () => {
  test('rejects both enqueue entry points while the worker feature is disabled', () => {
    expect(() =>
      createDeckRun(id(1), {
        deckId: id(2),
        sourceLanguageTag: 'en',
        definitionLanguageTag: 'vi',
      }),
    ).toThrow(ConflictError);
    expect(() => createSenseExpansionRun(id(1), id(10))).toThrow(
      'Knowledge graph v2 is disabled',
    );
  });

  test('allows enqueue facade execution when the feature is enabled', () => {
    expect(() => assertKnowledgeGraphV2Enabled(true)).not.toThrow();
    expect(() => assertKnowledgeGraphV2Enabled(false)).toThrow(
      'Knowledge graph v2 is disabled',
    );
  });
});
