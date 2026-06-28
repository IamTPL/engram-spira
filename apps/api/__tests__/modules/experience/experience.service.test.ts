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
import { createExperienceFixtureRows } from '../../helpers/fixtures';
import {
  getCommandCenter,
  type CommandCenterLoaders,
} from '../../../src/modules/experience/command-center.service';
import {
  getDeckWorkspace,
  type DeckWorkspaceLoaders,
} from '../../../src/modules/experience/deck-workspace.service';
import {
  getInsightsOverview,
  type InsightsOverviewLoaders,
} from '../../../src/modules/experience/insights-overview.service';
import {
  getLibraryExplorer,
  type LibraryExplorerLoaders,
} from '../../../src/modules/experience/library-explorer.service';
import {
  getStudyQueue,
  type StudyQueueLoaders,
} from '../../../src/modules/experience/study-queue.service';

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

const fixture = createExperienceFixtureRows();

function commandCenterLoaders(
  overrides: Partial<CommandCenterLoaders> = {},
): CommandCenterLoaders {
  return {
    loadReviewQueue: async () => ({
      dueCount: 1,
      newCount: 1,
      learningCount: 1,
      atRiskCount: 1,
      nextAction: { id: 'study.due', label: 'Study due cards' },
    }),
    loadStreak: async () => ({ current: 3, longest: 8 }),
    loadDueDecks: async () => [
      {
        id: 'deck-1',
        name: 'Test Deck',
        folderId: 'folder-1',
        dueCount: 1,
        newCount: 1,
        lastStudiedAt: '2026-06-27T10:00:00.000Z',
      },
    ],
    loadRecent: async () => ({
      decks: [{ id: 'deck-1', name: 'Test Deck', updatedAt: null }],
      cards: [
        {
          id: 'card-due',
          deckId: 'deck-1',
          title: 'Due front',
          updatedAt: null,
        },
      ],
    }),
    loadWeakAreas: async () => [
      {
        id: 'concept:grammar',
        label: 'grammar',
        cardCount: 2,
        avgRetention: 0.62,
        action: { id: 'study.smart-group', label: 'Review grammar' },
      },
    ],
    loadForecast: async () => ({
      days: [{ date: '2026-06-28', atRiskCount: 1, avgRetention: 0.82 }],
    }),
    loadPendingSuggestions: async () => ({ duplicates: 0, aiSuggestions: 1 }),
    loadNotifications: async () => [
      {
        id: 'notification-1',
        title: 'Cards due',
        body: null,
        createdAt: '2026-06-28T10:00:00.000Z',
        href: '/study',
      },
    ],
    ...overrides,
  };
}

describe('command center aggregate service', () => {
  test('returns aggregate envelope and nullable pendingSuggestions on optional failure', async () => {
    const response = await getCommandCenter(
      'user-1',
      commandCenterLoaders({
        loadPendingSuggestions: async () => {
          throw new Error('Suggestion lookup failed');
        },
      }),
    );

    expect(response.data.pendingSuggestions).toBeNull();
    expect(response.meta.sections.pendingSuggestions).toEqual({
      status: 'error',
      message: 'Suggestion lookup failed',
      retryable: true,
    });
  });

  test('returns exact command center section keys', async () => {
    const response = await getCommandCenter('user-1', commandCenterLoaders());

    expect(Object.keys(response.meta.sections)).toEqual([
      'reviewQueue',
      'streak',
      'dueDecks',
      'recent',
      'weakAreas',
      'forecast',
      'pendingSuggestions',
      'notifications',
    ]);
  });

  test('returns empty arrays and empty section statuses for a new user', async () => {
    const response = await getCommandCenter(
      'new-user',
      commandCenterLoaders({
        loadReviewQueue: async () => ({
          dueCount: 0,
          newCount: 0,
          learningCount: 0,
          atRiskCount: 0,
          nextAction: null,
        }),
        loadStreak: async () => null,
        loadDueDecks: async () => [],
        loadRecent: async () => ({ decks: [], cards: [] }),
        loadWeakAreas: async () => [],
        loadNotifications: async () => [],
      }),
    );

    expect(response.data.dueDecks).toEqual([]);
    expect(response.data.recent).toEqual({ decks: [], cards: [] });
    expect(response.data.weakAreas).toEqual([]);
    expect(response.data.notifications).toEqual([]);
    expect(response.meta.sections.reviewQueue.status).toBe('empty');
    expect(response.meta.sections.streak.status).toBe('empty');
    expect(response.meta.sections.dueDecks.status).toBe('empty');
    expect(response.meta.sections.recent.status).toBe('empty');
    expect(response.meta.sections.weakAreas.status).toBe('empty');
    expect(response.meta.sections.notifications.status).toBe('empty');
  });

  test('does not return a partial envelope when a required section fails', async () => {
    await expect(
      getCommandCenter(
        'user-1',
        commandCenterLoaders({
          loadReviewQueue: async () => {
            throw new Error('Review queue failed');
          },
        }),
      ),
    ).rejects.toThrow('Review queue failed');
  });
});

function libraryLoaders(
  overrides: Partial<LibraryExplorerLoaders> = {},
): LibraryExplorerLoaders {
  return {
    loadClasses: async () => [
      {
        id: 'class-1',
        name: 'Test Class',
        description: null,
        folderCount: 1,
        deckCount: 1,
        cardCount: 4,
        dueCount: 2,
        folders: [
          {
            id: 'folder-1',
            name: 'Test Folder',
            deckCount: 1,
            cardCount: 4,
            dueCount: 2,
            decks: [
              {
                id: 'deck-1',
                name: 'Test Deck',
                cardCount: 4,
                dueCount: 2,
                updatedAt: null,
              },
            ],
          },
        ],
      },
    ],
    loadRecentDeckIds: async () => ['deck-1'],
    ...overrides,
  };
}

describe('library explorer aggregate service', () => {
  test('treats class lookup failure as required failure', async () => {
    await expect(
      getLibraryExplorer(
        'user-1',
        libraryLoaders({
          loadClasses: async () => {
            throw new Error('Class count failed');
          },
        }),
      ),
    ).rejects.toThrow('Class count failed');
  });

  test('returns exact section keys', async () => {
    const response = await getLibraryExplorer('user-1', libraryLoaders());

    expect(Object.keys(response.meta.sections)).toEqual([
      'classes',
      'recentDecks',
    ]);
  });

  test('falls back to empty recentDeckIds when recent deck lookup fails', async () => {
    const response = await getLibraryExplorer(
      'user-1',
      libraryLoaders({
        loadRecentDeckIds: async () => {
          throw new Error('Recent decks failed');
        },
      }),
    );

    expect(response.data.recentDeckIds).toEqual([]);
    expect(response.meta.sections.recentDecks.status).toBe('error');
  });

  test('returns empty classes with classes section empty for a new user', async () => {
    const response = await getLibraryExplorer(
      'new-user',
      libraryLoaders({ loadClasses: async () => [] }),
    );

    expect(response.data.classes).toEqual([]);
    expect(response.meta.sections.classes.status).toBe('empty');
  });
});

function deckWorkspaceLoaders(
  overrides: Partial<DeckWorkspaceLoaders> = {},
): DeckWorkspaceLoaders {
  return {
    loadDeck: async () => ({
      id: 'deck-1',
      name: 'Test Deck',
      folderId: 'folder-1',
      cardTemplateId: 'template-1',
      cardCount: 4,
    }),
    loadCards: async () => ({
      items: [
        {
          id: 'card-due',
          title: 'Due front',
          preview: 'Due back',
          updatedAt: null,
        },
      ],
      page: 2,
      pageSize: 1,
      total: 4,
    }),
    loadStudy: async () => ({
      dueCount: 1,
      newCount: 1,
      learningCount: 1,
      lastStudiedAt: '2026-06-27T10:00:00.000Z',
    }),
    loadAnalytics: async () => ({ avgRetention: 0.76, atRiskCount: 1 }),
    loadCounters: async () => ({ graphLinks: 0, duplicates: 0, aiSuggestions: 0 }),
    ...overrides,
  };
}

describe('deck workspace aggregate service', () => {
  test('returns paginated card data and nullable counters', async () => {
    const response = await getDeckWorkspace(
      'user-1',
      'deck-1',
      { cardPage: 2, cardPageSize: 1 },
      deckWorkspaceLoaders({
        loadCounters: async () => {
          throw new Error('Counters unavailable');
        },
      }),
    );

    expect(response.data.cards).toMatchObject({ page: 2, pageSize: 1, total: 4 });
    expect(response.data.counters).toBeNull();
    expect(response.meta.sections.counters.status).toBe('error');
  });

  test('returns exact section keys', async () => {
    const response = await getDeckWorkspace(
      'user-1',
      'deck-1',
      {},
      deckWorkspaceLoaders(),
    );

    expect(Object.keys(response.meta.sections)).toEqual([
      'deck',
      'cards',
      'study',
      'analytics',
      'counters',
    ]);
  });

  test('rejects missing or unauthorized deck', async () => {
    await expect(
      getDeckWorkspace(
        'user-1',
        'missing-deck',
        {},
        deckWorkspaceLoaders({ loadDeck: async () => null }),
      ),
    ).rejects.toThrow('Deck not found');
  });
});

function insightsLoaders(
  overrides: Partial<InsightsOverviewLoaders> = {},
): InsightsOverviewLoaders {
  return {
    loadForecast: async () => ({
      days: [{ date: '2026-06-28', atRiskCount: 1, avgRetention: 0.82 }],
    }),
    loadWeakAreas: async () => [],
    loadAtRiskCards: async () => [
      {
        id: 'card-risk',
        deckId: 'deck-2',
        title: 'Risk front',
        retentionEstimate: 0.42,
      },
    ],
    loadHeatmap: async () => [{ date: '2026-06-28', count: 4 }],
    loadTrends: async () => ({ reviewedThisWeek: 12, retentionDelta: null }),
    ...overrides,
  };
}

describe('insights overview aggregate service', () => {
  test('returns aggregate envelope with stable section keys', async () => {
    const response = await getInsightsOverview('user-1', insightsLoaders());

    expect(response.data.forecast?.days).toHaveLength(1);
    expect(Object.keys(response.meta.sections)).toEqual([
      'forecast',
      'weakAreas',
      'atRiskCards',
      'heatmap',
      'trends',
    ]);
  });

  test('falls back for optional section failures', async () => {
    const response = await getInsightsOverview(
      'user-1',
      insightsLoaders({
        loadForecast: async () => {
          throw new Error('Forecast failed');
        },
        loadWeakAreas: async () => {
          throw new Error('Weak areas failed');
        },
        loadAtRiskCards: async () => {
          throw new Error('At-risk cards failed');
        },
        loadHeatmap: async () => {
          throw new Error('Heatmap failed');
        },
        loadTrends: async () => {
          throw new Error('Trends failed');
        },
      }),
    );

    expect(response.data.forecast).toBeNull();
    expect(response.data.weakAreas).toEqual([]);
    expect(response.data.atRiskCards).toEqual([]);
    expect(response.data.heatmap).toBeNull();
    expect(response.data.trends).toBeNull();
    expect(response.meta.sections.forecast.status).toBe('error');
    expect(response.meta.sections.weakAreas.status).toBe('error');
    expect(response.meta.sections.atRiskCards.status).toBe('error');
    expect(response.meta.sections.heatmap.status).toBe('error');
    expect(response.meta.sections.trends.status).toBe('error');
  });
});

function studyQueueLoaders(
  overrides: Partial<StudyQueueLoaders> = {},
): StudyQueueLoaders {
  return {
    ensureDeck: async () => {},
    ensureFolder: async () => {},
    ensureClass: async () => {},
    ensureSmartGroup: async () => {},
    loadQueueRows: async () => fixture.queueRows,
    ...overrides,
  };
}

describe('study queue service', () => {
  test('rejects missing scope IDs for scoped modes', async () => {
    await expect(
      getStudyQueue('user-1', { mode: 'deck' } as any, studyQueueLoaders()),
    ).rejects.toThrow('deckId is required');
    await expect(
      getStudyQueue('user-1', { mode: 'folder' } as any, studyQueueLoaders()),
    ).rejects.toThrow('folderId is required');
    await expect(
      getStudyQueue('user-1', { mode: 'class' } as any, studyQueueLoaders()),
    ).rejects.toThrow('classId is required');
    await expect(
      getStudyQueue(
        'user-1',
        { mode: 'smart-group' } as any,
        studyQueueLoaders(),
      ),
    ).rejects.toThrow('smartGroupId is required');
  });

  test('rejects nonexistent and unauthorized scoped IDs', async () => {
    await expect(
      getStudyQueue(
        'user-1',
        { mode: 'deck', deckId: 'missing' },
        studyQueueLoaders({
          ensureDeck: async () => {
            throw new Error('Deck not found');
          },
        }),
      ),
    ).rejects.toThrow('Deck not found');
    await expect(
      getStudyQueue(
        'user-1',
        { mode: 'folder', folderId: 'missing' },
        studyQueueLoaders({
          ensureFolder: async () => {
            throw new Error('Folder not found');
          },
        }),
      ),
    ).rejects.toThrow('Folder not found');
    await expect(
      getStudyQueue(
        'user-1',
        { mode: 'class', classId: 'missing' },
        studyQueueLoaders({
          ensureClass: async () => {
            throw new Error('Class not found');
          },
        }),
      ),
    ).rejects.toThrow('Class not found');
    await expect(
      getStudyQueue(
        'user-1',
        { mode: 'smart-group', smartGroupId: 'missing' },
        studyQueueLoaders({
          ensureSmartGroup: async () => {
            throw new Error('Smart group not found');
          },
        }),
      ),
    ).rejects.toThrow('Smart group not found');
    await expect(
      getStudyQueue(
        'user-1',
        { mode: 'at-risk', deckId: 'missing' },
        studyQueueLoaders({
          ensureDeck: async () => {
            throw new Error('Deck not found');
          },
        }),
      ),
    ).rejects.toThrow('Deck not found');
  });

  test('covers empty due, deck, folder, class, smart group, interleaved, and at-risk queues', async () => {
    for (const query of [
      { mode: 'due' },
      { mode: 'deck', deckId: 'deck-1' },
      { mode: 'folder', folderId: 'folder-1' },
      { mode: 'class', classId: 'class-1' },
      { mode: 'smart-group', smartGroupId: 'concept:grammar' },
      { mode: 'interleaved' },
      { mode: 'at-risk' },
    ] as any[]) {
      const response = await getStudyQueue(
        'user-1',
        query,
        studyQueueLoaders({ loadQueueRows: async () => [] }),
      );

      expect(response.cards).toEqual([]);
      expect(response.summary).toEqual({
        total: 0,
        due: 0,
        new: 0,
        learning: 0,
        atRisk: 0,
      });
    }
  });

  test('covers non-empty mixed queues with deterministic ordering, reason, and summary', async () => {
    const response = await getStudyQueue(
      'user-1',
      { mode: 'due', limit: 10 },
      studyQueueLoaders(),
    );

    expect(response.cards.map((card) => card.id)).toEqual([
      'card-due',
      'card-new',
      'card-learning',
      'card-risk',
    ]);
    expect(response.cards.map((card) => card.reason)).toEqual([
      'due',
      'new',
      'learning',
      'at-risk',
    ]);
    expect(response.summary).toEqual({
      total: 4,
      due: 1,
      new: 1,
      learning: 1,
      atRisk: 1,
    });
  });

  test('marks at-risk queue cards with at-risk reason', async () => {
    const response = await getStudyQueue(
      'user-1',
      { mode: 'at-risk', limit: 10 },
      studyQueueLoaders({
        loadQueueRows: async () => [fixture.queueRows[3]],
      }),
    );

    expect(response.cards).toHaveLength(1);
    expect(response.cards[0].id).toBe('card-risk');
    expect(response.cards[0].reason).toBe('at-risk');
    expect(response.summary).toEqual({
      total: 1,
      due: 0,
      new: 0,
      learning: 0,
      atRisk: 1,
    });
  });
});
