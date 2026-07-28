const MAX_MEMORY_HEALTH_STUDY_CARDS = 12;

export const MEMORY_HEALTH_DETAILS_DAYS = 30;

export type MemoryHealthStatus =
  | 'new'
  | 'due'
  | 'at_risk'
  | 'on_track'
  | 'unavailable';

export type MemoryHealthDate = string | Date;

export interface MemoryHealthOverview {
  asOf: MemoryHealthDate;
  algorithm: 'sm2' | 'fsrs';
  metric: {
    kind: 'predicted_recall' | 'schedule_status';
    average: number | null;
    target: number | null;
  };
  summary: {
    total: number;
    reviewed: number;
    new: number;
    due: number;
    atRisk: number;
    onTrack: number;
    unavailable: number;
  };
  distribution: {
    new: number;
    due: number;
    atRisk: number;
    onTrack: number;
    unavailable: number;
  };
  attentionTotal: number;
  attention: Array<{
    cardId: string;
    label: string;
    status: Extract<MemoryHealthStatus, 'due' | 'at_risk'>;
    retention: number | null;
    lastReviewedAt: MemoryHealthDate | null;
    nextReviewAt: MemoryHealthDate;
  }>;
  reviewCardIds: string[];
}

export interface MemoryHealthDetails {
  asOf: MemoryHealthDate;
  rangeDays: number;
  outcomes: {
    total: number;
    recalled: number;
    recallRate: number | null;
    again: number;
    hard: number;
    good: number;
    easy: number;
  };
  dailyOutcomes: Array<{
    date: MemoryHealthDate;
    total: number;
    recalled: number;
  }>;
  workload: Array<{
    date: MemoryHealthDate;
    count: number;
  }>;
  recentReviews: Array<{
    id: string;
    cardId: string;
    label: string;
    rating: 'again' | 'hard' | 'good' | 'easy';
    reviewedAt: MemoryHealthDate;
    elapsedDays: number;
    scheduledDays: number;
  }>;
}

export type MemoryHealthPrimaryAction =
  | {
      kind: 'review_due';
      label: string;
      cardCount: number;
      href: string;
    }
  | {
      kind: 'start_learning';
      label: string;
      cardCount: number;
      href: string;
    };

export interface MemoryHealthPresentation {
  headline: {
    title: string;
    description: string;
  };
  metric: {
    label: string;
    value: string;
    description: string;
  };
  counts: Array<{
    key: 'reviewed' | 'new' | 'due' | 'at_risk';
    label: string;
    count: number;
    description: string;
    tone: 'due' | 'risk' | 'success' | 'muted';
  }>;
  distribution: Array<{
    key: MemoryHealthStatus;
    label: string;
    count: number;
    percentage: number;
    tone: 'due' | 'risk' | 'success' | 'muted';
  }>;
  attention: MemoryHealthOverview['attention'];
}

export const memoryHealthKeys = {
  all: ['memory-health'] as const,
  deck(deckId: string) {
    return [...this.all, 'deck', deckId] as const;
  },
  overview(deckId: string, userId: string) {
    return [...this.deck(deckId), 'overview', userId] as const;
  },
  details(
    deckId: string,
    userId: string,
    days = MEMORY_HEALTH_DETAILS_DAYS,
  ) {
    return [...this.deck(deckId), 'details', userId, days] as const;
  },
};

export function shouldLoadMemoryHealthDetails(
  expanded: boolean,
  deckId: string,
  userId: string,
): boolean {
  return expanded && deckId.length > 0 && userId.length > 0;
}

export function getMemoryHealthCalendarDate(
  value: MemoryHealthDate,
): Date | null {
  let dateKey: string;
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) return null;
    dateKey = value.toISOString().slice(0, 10);
  } else {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (!match) return null;
    dateKey = match[0];
  }

  const [year, month, day] = dateKey.split('-').map(Number);
  const result = new Date(year, month - 1, day);
  if (
    result.getFullYear() !== year ||
    result.getMonth() !== month - 1 ||
    result.getDate() !== day
  ) {
    return null;
  }
  return result;
}

export function buildMemoryHealthStudyUrl(
  deckId: string,
  cardIds: string[],
): string {
  const uniqueCardIds = [...new Set(cardIds)].slice(
    0,
    MAX_MEMORY_HEALTH_STUDY_CARDS,
  );
  const path = `/study/${encodeURIComponent(deckId)}`;
  if (uniqueCardIds.length === 0) return path;

  const query = new URLSearchParams({
    mode: 'all',
    cardIds: uniqueCardIds.join(','),
  });
  return `${path}?${query.toString()}`;
}

export function getMemoryHealthPrimaryAction(
  deckId: string,
  overview: MemoryHealthOverview,
): MemoryHealthPrimaryAction | null {
  const dueCardIds = [...new Set(overview.reviewCardIds)].slice(
    0,
    MAX_MEMORY_HEALTH_STUDY_CARDS,
  );
  if (dueCardIds.length > 0) {
    return {
      kind: 'review_due',
      label:
        overview.summary.due > dueCardIds.length
          ? `Review first ${dueCardIds.length}`
          : `Review ${dueCardIds.length} now`,
      cardCount: dueCardIds.length,
      href: buildMemoryHealthStudyUrl(deckId, dueCardIds),
    };
  }

  if (overview.summary.new > 0) {
    return {
      kind: 'start_learning',
      label: 'Start studying',
      cardCount: overview.summary.new,
      href: buildMemoryHealthStudyUrl(deckId, []),
    };
  }

  return null;
}

export function getMemoryHealthPresentation(
  overview: MemoryHealthOverview,
): MemoryHealthPresentation {
  const metric =
    overview.metric.kind === 'predicted_recall'
      ? {
          label: 'Estimated recall',
          value:
            overview.metric.average === null
              ? 'Not enough data'
              : `${Math.round(overview.metric.average * 100)}%`,
          description: 'Prediction, not a test score',
        }
      : {
          label: 'Schedule status',
          value: `${overview.summary.due} due`,
          description:
            'SM-2 uses due dates, not a predicted recall percentage',
        };

  const counts: MemoryHealthPresentation['counts'] = [
    {
      key: 'reviewed',
      label: 'Reviewed',
      count: overview.summary.reviewed,
      description: 'Has study history',
      tone: 'success',
    },
    {
      key: 'new',
      label: 'New',
      count: overview.summary.new,
      description: 'Not reviewed yet',
      tone: 'muted',
    },
    {
      key: 'due',
      label: 'Due now',
      count: overview.summary.due,
      description: 'Ready for review',
      tone: 'due',
    },
    {
      key: 'at_risk',
      label: 'At risk',
      count: overview.summary.atRisk,
      description: 'May weaken soon',
      tone: 'risk',
    },
  ];
  const total = overview.summary.total;
  const distributionBase: Array<
    Omit<MemoryHealthPresentation['distribution'][number], 'percentage'>
  > = [
    {
      key: 'new',
      label: 'New',
      count: overview.distribution.new,
      tone: 'muted',
    },
    {
      key: 'due',
      label: 'Due',
      count: overview.distribution.due,
      tone: 'due',
    },
    {
      key: 'at_risk',
      label: 'At risk',
      count: overview.distribution.atRisk,
      tone: 'risk',
    },
    {
      key: 'on_track',
      label: 'On track',
      count: overview.distribution.onTrack,
      tone: 'success',
    },
    {
      key: 'unavailable',
      label: 'Unavailable',
      count: overview.distribution.unavailable,
      tone: 'muted',
    },
  ];
  const distribution: MemoryHealthPresentation['distribution'] =
    distributionBase.map((item) => ({
      ...item,
      percentage: total === 0 ? 0 : (item.count / total) * 100,
    }));

  return {
    headline: getHeadline(overview),
    metric,
    counts,
    distribution,
    attention: overview.attention.slice(0, 5),
  };
}

function getHeadline(
  overview: MemoryHealthOverview,
): MemoryHealthPresentation['headline'] {
  if (overview.summary.total === 0) {
    return {
      title: 'No cards to assess yet',
      description:
        'Add cards to this deck, then study them to build a memory profile.',
    };
  }
  if (overview.summary.due > 0) {
    return {
      title: `${overview.summary.due} ${
        overview.summary.due === 1 ? 'card is' : 'cards are'
      } due now`,
      description:
        'Reviewing due cards is the clearest next step. Each study set is capped at 12 cards.',
    };
  }
  if (overview.summary.atRisk > 0) {
    return {
      title: 'You are caught up',
      description: `${overview.summary.atRisk} ${
        overview.summary.atRisk === 1 ? 'card may' : 'cards may'
      } weaken before the next scheduled review. This is guidance, not an automatic study queue.`,
    };
  }
  if (overview.summary.new > 0) {
    return {
      title: 'Ready to build new memories',
      description: `${overview.summary.new} ${
        overview.summary.new === 1 ? 'card has' : 'cards have'
      } not been reviewed yet.`,
    };
  }
  return {
    title: 'Everything is on schedule',
    description:
      'There are no due or at-risk cards right now. Keep following the review schedule.',
  };
}
