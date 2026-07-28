import { describe, expect, test } from 'bun:test';

import { ConflictError, ValidationError } from '../../../src/shared/errors';
import {
  acceptKnowledgeGraphSuggestion,
  dismissKnowledgeGraphSuggestion,
  listKnowledgeGraphSuggestions,
  type SuggestionListRow,
  type SuggestionReviewRepository,
} from '../../../src/modules/knowledge-graph/kg-suggestion-review.service';

const id = (value: number) =>
  `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;

function artifact(cardId: string, lemma: string, hash: string) {
  return {
    cardId,
    sourceLanguageTag: 'en',
    definitionLanguageTag: 'vi',
    lemma,
    normalizedLemma: lemma.toLocaleLowerCase('en'),
    partOfSpeech: 'noun',
    definition: `definition ${lemma}`,
    normalizedDefinition: `definition ${lemma}`.toLocaleLowerCase('vi'),
    ipa: null,
    examples: [],
    contentHash: hash,
    representationVersion: 'v1' as const,
  };
}

function suggestionRow(index: number): SuggestionListRow {
  const sourceHash = `${index + 1}`.padStart(64, 'a');
  const targetHash = `${index + 2}`.padStart(64, 'b');
  const sourceCardId = id(index * 2 + 10);
  const targetCardId = id(index * 2 + 11);
  return {
    id: id(index),
    runId: id(100),
    status: 'pending',
    sourceCardId,
    targetCardId,
    sourceSenseId: id(index * 2 + 200),
    targetSenseId: id(index * 2 + 201),
    sourceArtifact: artifact(sourceCardId, `source-${index}`, sourceHash),
    targetArtifact: artifact(targetCardId, `target-${index}`, targetHash),
    relationType: 'synonym',
    direction: 'symmetric',
    confidenceBand: 'high',
    reason: `reason-${index}`,
    evidence: null,
    retrievalSimilarity: 0.9,
    mutualKnn: true,
    acceptedRelationId: null,
    createdAt: new Date(`2026-07-27T00:00:0${index}.000Z`),
    updatedAt: new Date(`2026-07-27T00:00:0${index}.000Z`),
  };
}

function inMemoryRepository(rows: SuggestionListRow[]): SuggestionReviewRepository {
  return {
    async list(userId, runId, status, cursor, limit) {
      if (userId !== id(1) || runId !== id(100)) {
        throw new Error('Knowledge graph run not found');
      }
      const filtered = rows
        .filter((row) => row.status === status)
        .filter(
          (row) =>
            cursor === null ||
            row.createdAt < cursor.createdAt ||
            (row.createdAt.getTime() === cursor.createdAt.getTime() &&
              row.id < cursor.id),
        )
        .sort(
          (left, right) =>
            right.createdAt.getTime() - left.createdAt.getTime() ||
            right.id.localeCompare(left.id),
        );
      return filtered.slice(0, limit);
    },
    async accept() {
      return {
        outcome: 'accepted',
        suggestion: { ...rows[0]!, status: 'accepted' },
        relationId: id(900),
      };
    },
    async dismiss() {
      return {
        id: rows[0]!.id,
        runId: rows[0]!.runId,
        relationType: rows[0]!.relationType,
        confidenceBand: rows[0]!.confidenceBand,
        status: 'dismissed',
        dismissedAt: new Date('2026-07-27T01:00:00.000Z'),
      };
    },
  };
}

describe('knowledge graph suggestion review service', () => {
  test('returns stable opaque cursor pages without leaking the peek row', async () => {
    const repository = inMemoryRepository([
      suggestionRow(1),
      suggestionRow(2),
      suggestionRow(3),
    ]);

    const first = await listKnowledgeGraphSuggestions(
      id(1),
      id(100),
      { status: 'pending', limit: 2 },
      repository,
    );
    expect(first.items.map((item) => item.id)).toEqual([id(3), id(2)]);
    expect(first.pageInfo.nextCursor).toBeString();
    expect(first.pageInfo.nextCursor).not.toContain(id(2));

    const second = await listKnowledgeGraphSuggestions(
      id(1),
      id(100),
      {
        status: 'pending',
        limit: 2,
        cursor: first.pageInfo.nextCursor!,
      },
      repository,
    );
    expect(second.items.map((item) => item.id)).toEqual([id(1)]);
    expect(second.pageInfo.nextCursor).toBeNull();
  });

  test('rejects malformed cursors and limits outside the public contract', async () => {
    const repository = inMemoryRepository([suggestionRow(1)]);
    await expect(
      listKnowledgeGraphSuggestions(
        id(1),
        id(100),
        { status: 'pending', cursor: 'not-a-cursor', limit: 20 },
        repository,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      listKnowledgeGraphSuggestions(
        id(1),
        id(100),
        { status: 'pending', limit: 51 },
        repository,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test('commits superseded state before surfacing a card-edit conflict', async () => {
    let persisted = false;
    const repository: SuggestionReviewRepository = {
      ...inMemoryRepository([suggestionRow(1)]),
      async accept() {
        persisted = true;
        return { outcome: 'superseded' };
      },
    };

    await expect(
      acceptKnowledgeGraphSuggestion(id(1), id(1), repository),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(persisted).toBe(true);
  });

  test('returns the same accepted relation on repeat accept and dismiss is idempotent', async () => {
    const repository = inMemoryRepository([suggestionRow(1)]);
    const first = await acceptKnowledgeGraphSuggestion(id(1), id(1), repository);
    const second = await acceptKnowledgeGraphSuggestion(id(1), id(1), repository);
    expect(first).toEqual(second);
    expect(first).toEqual({
      suggestionId: id(1),
      status: 'accepted',
      relationId: id(900),
    });

    const dismissedFirst = await dismissKnowledgeGraphSuggestion(
      id(1),
      id(1),
      repository,
    );
    const dismissedSecond = await dismissKnowledgeGraphSuggestion(
      id(1),
      id(1),
      repository,
    );
    expect(dismissedFirst).toEqual(dismissedSecond);
    expect(dismissedFirst.status).toBe('dismissed');
  });

  test('emits review telemetry by relation type and verifier confidence band', async () => {
    const row = suggestionRow(1);
    row.relationType = 'antonym';
    row.confidenceBand = 'medium';
    const repository = inMemoryRepository([row]);
    const events: Record<string, unknown>[] = [];
    const eventLogger = {
      info(context: Record<string, unknown>) {
        events.push(context);
      },
    };

    await acceptKnowledgeGraphSuggestion(
      id(1),
      id(1),
      repository,
      eventLogger,
    );
    await dismissKnowledgeGraphSuggestion(
      id(1),
      id(1),
      repository,
      eventLogger,
    );

    expect(events).toEqual([
      expect.objectContaining({
        event: 'kg_relation_suggestion_reviewed',
        action: 'accepted',
        relationType: 'antonym',
        confidenceBand: 'medium',
      }),
      expect.objectContaining({
        event: 'kg_relation_suggestion_reviewed',
        action: 'dismissed',
        relationType: 'antonym',
        confidenceBand: 'medium',
      }),
    ]);
  });
});
