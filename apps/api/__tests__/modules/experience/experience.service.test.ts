import { describe, expect, test } from 'bun:test';

import {
  aggregateResponse,
  emptySection,
  errorSection,
  okSection,
  resolveSection,
} from '../../../src/modules/experience/aggregate.helpers';
import type {
  CommandCenterSections,
  CreateCommitRequest,
  StudyQueueQuery,
} from '../../../src/modules/experience/experience.types';

type Equal<TActual, TExpected> =
  (<T>() => T extends TActual ? 1 : 2) extends
  (<T>() => T extends TExpected ? 1 : 2)
    ? true
    : false;
type Expect<TValue extends true> = TValue;

const commandCenterSections = {
  reviewQueue: okSection(),
  streak: okSection(),
  dueDecks: okSection(),
  recent: emptySection(),
  weakAreas: emptySection(),
  forecast: errorSection('Forecast unavailable', true),
  pendingSuggestions: okSection(),
  notifications: okSection(),
} satisfies CommandCenterSections;

const commandCenterResponse = aggregateResponse(
  { ready: true },
  commandCenterSections,
);

type CommandCenterSectionKeys = keyof typeof commandCenterResponse.meta.sections;
type _PreservesCommandCenterSectionKeys = Expect<
  Equal<CommandCenterSectionKeys, keyof CommandCenterSections>
>;

// @ts-expect-error aggregateResponse must preserve exact section keys.
commandCenterResponse.meta.sections.notASection;

const dueStudyQueueQuery: StudyQueueQuery = { mode: 'due', limit: 20 };
const deckStudyQueueQuery: StudyQueueQuery = {
  mode: 'deck',
  deckId: 'deck-1',
};
const atRiskStudyQueueQuery: StudyQueueQuery = {
  mode: 'at-risk',
  deckId: 'deck-1',
};

void dueStudyQueueQuery;
void deckStudyQueueQuery;
void atRiskStudyQueueQuery;

// @ts-expect-error deck mode requires deckId.
const deckStudyQueueMissingId: StudyQueueQuery = { mode: 'deck' };
// @ts-expect-error folder mode does not accept deckId instead of folderId.
const folderStudyQueueWrongId: StudyQueueQuery = {
  mode: 'folder',
  deckId: 'deck-1',
};

void deckStudyQueueMissingId;
void folderStudyQueueWrongId;

const createCommitRequest: CreateCommitRequest = {
  previewId: 'preview-1',
  idempotencyKey: 'key-1',
  cards: [{ clientId: 'card-1', resolution: 'create', fields: { front: 'A' } }],
};
const skipCommitRequest: CreateCommitRequest = {
  previewId: 'preview-1',
  idempotencyKey: 'key-2',
  cards: [{ clientId: 'card-1', resolution: 'skip' }],
};
const mergeCommitRequest: CreateCommitRequest = {
  previewId: 'preview-1',
  idempotencyKey: 'key-3',
  cards: [
    {
      clientId: 'card-1',
      resolution: 'merge',
      mergeTargetCardId: 'target-card-1',
      fields: { back: 'B' },
    },
  ],
};

void createCommitRequest;
void skipCommitRequest;
void mergeCommitRequest;

const mergeCommitWithoutTarget: CreateCommitRequest = {
  previewId: 'preview-1',
  idempotencyKey: 'key-4',
  cards: [
    // @ts-expect-error merge resolution requires mergeTargetCardId.
    { clientId: 'card-1', resolution: 'merge' },
  ],
};
const createCommitWithMergeTarget: CreateCommitRequest = {
  previewId: 'preview-1',
  idempotencyKey: 'key-5',
  cards: [
    // @ts-expect-error create resolution cannot include mergeTargetCardId.
    {
      clientId: 'card-1',
      resolution: 'create',
      mergeTargetCardId: 'target-card-1',
    },
  ],
};
const skipCommitWithFields: CreateCommitRequest = {
  previewId: 'preview-1',
  idempotencyKey: 'key-6',
  cards: [
    // @ts-expect-error skip resolution cannot include replacement fields.
    { clientId: 'card-1', resolution: 'skip', fields: { front: 'A' } },
  ],
};
const skipCommitWithMergeTarget: CreateCommitRequest = {
  previewId: 'preview-1',
  idempotencyKey: 'key-7',
  cards: [
    // @ts-expect-error skip resolution cannot include mergeTargetCardId.
    {
      clientId: 'card-1',
      resolution: 'skip',
      mergeTargetCardId: 'target-card-1',
    },
  ],
};

void mergeCommitWithoutTarget;
void createCommitWithMergeTarget;
void skipCommitWithFields;
void skipCommitWithMergeTarget;

describe('experience aggregate helpers', () => {
  test('builds an aggregate envelope with ok, empty, and error sections', () => {
    const response = aggregateResponse(
      { recentDeckIds: [] },
      {
        classes: okSection(),
        recentDecks: emptySection(),
        trends: errorSection('Trend service unavailable', true),
      },
    );

    expect(response.data.recentDeckIds).toEqual([]);
    expect(Date.parse(response.meta.generatedAt)).not.toBeNaN();
    expect(response.meta.sections.classes.status).toBe('ok');
    expect(response.meta.sections.recentDecks.status).toBe('empty');
    expect(response.meta.sections.trends).toEqual({
      status: 'error',
      message: 'Trend service unavailable',
      retryable: true,
    });
  });

  test('returns ok meta when a section loads successfully', async () => {
    const section = await resolveSection({
      load: async () => ['deck-1'],
      fallback: [] as string[],
    });

    expect(section.data).toEqual(['deck-1']);
    expect(section.meta).toEqual({ status: 'ok' });
  });

  test('returns empty meta when the empty predicate matches', async () => {
    const section = await resolveSection({
      load: async () => [] as string[],
      fallback: [] as string[],
      empty: (deckIds) => deckIds.length === 0,
    });

    expect(section.data).toEqual([]);
    expect(section.meta).toEqual({ status: 'empty' });
  });

  test('throws when a required section fails', async () => {
    await expect(
      resolveSection({
        required: true,
        load: async () => {
          throw new Error('Required section failed');
        },
      }),
    ).rejects.toThrow('Required section failed');
  });

  test('returns fallback data and retryable error meta when an optional section fails', async () => {
    const recentDecks = await resolveSection({
      load: async () => {
        throw new Error('Recent deck lookup failed');
      },
      fallback: [] as string[],
    });

    expect(recentDecks.data).toEqual([]);
    expect(recentDecks.meta).toEqual({
      status: 'error',
      message: 'Recent deck lookup failed',
      retryable: true,
    });
  });

  test('preserves explicit retryable false when an optional section fails', async () => {
    const recentDecks = await resolveSection({
      load: async () => {
        throw new Error('Recent deck lookup failed');
      },
      fallback: [] as string[],
      retryable: false,
    });

    const response = aggregateResponse(
      { recentDeckIds: recentDecks.data },
      { recentDecks: recentDecks.meta },
    );

    expect(response.data.recentDeckIds).toEqual([]);
    expect(response.meta.sections.recentDecks).toEqual({
      status: 'error',
      message: 'Recent deck lookup failed',
      retryable: false,
    });
  });

  test('turns non-Error thrown values into string messages', async () => {
    const trends = await resolveSection({
      load: async () => {
        throw 'Trend lookup failed';
      },
      fallback: null as null | { reviewedThisWeek: number },
    });

    expect(trends.data).toBeNull();
    expect(trends.meta).toEqual({
      status: 'error',
      message: 'Trend lookup failed',
      retryable: true,
    });
  });
});
