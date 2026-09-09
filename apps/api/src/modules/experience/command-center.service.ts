import { sql, type SQL } from 'drizzle-orm';
import { db } from '../../db';
import * as forecastService from '../study/forecast.service';
import * as recommendationsService from '../study/recommendations.service';
import * as studyService from '../study/study.service';
import * as notificationsService from '../notifications/notifications.service';
import {
  FSRS_LEARNING,
  FSRS_NEW,
  fsrsAsOf,
  fsrsAtRisk,
  fsrsDue,
  fsrsStateJoin,
} from '../study/fsrs-sql';
import { aggregateResponse, resolveSection } from './aggregate.helpers';
import type {
  CommandCenterResponse,
  CommandCenterSections,
  AggregateResponse,
} from './experience.types';

export type CommandCenterLoaders = {
  loadReviewQueue: (userId: string) => Promise<CommandCenterResponse['reviewQueue']>;
  loadStreak: (userId: string) => Promise<CommandCenterResponse['streak']>;
  loadDueDecks: (userId: string) => Promise<CommandCenterResponse['dueDecks']>;
  loadRecent: (userId: string) => Promise<CommandCenterResponse['recent']>;
  loadWeakAreas: (userId: string) => Promise<CommandCenterResponse['weakAreas']>;
  loadForecast: (userId: string) => Promise<CommandCenterResponse['forecast']>;
  loadPendingSuggestions: (
    userId: string,
  ) => Promise<CommandCenterResponse['pendingSuggestions']>;
  loadNotifications: (
    userId: string,
  ) => Promise<CommandCenterResponse['notifications']>;
};

export async function getCommandCenter(
  userId: string,
  loaders: CommandCenterLoaders = defaultCommandCenterLoaders,
): Promise<AggregateResponse<CommandCenterResponse, CommandCenterSections>> {
  const reviewQueue = await resolveSection({
    required: true,
    load: () => loaders.loadReviewQueue(userId),
    empty: (data) =>
      data.dueCount + data.newCount + data.learningCount + data.atRiskCount === 0,
  });
  const streak = await resolveSection({
    required: true,
    load: () => loaders.loadStreak(userId),
    empty: (data) => data === null || (data.current === 0 && data.longest === 0),
  });
  const dueDecks = await resolveSection({
    required: true,
    load: () => loaders.loadDueDecks(userId),
    empty: (data) => data.length === 0,
  });
  const recent = await resolveSection({
    load: () => loaders.loadRecent(userId),
    fallback: { decks: [], cards: [] },
    empty: (data) => data.decks.length === 0 && data.cards.length === 0,
  });
  const weakAreas = await resolveSection({
    load: () => loaders.loadWeakAreas(userId),
    fallback: [],
    empty: (data) => data.length === 0,
  });
  const forecast = await resolveSection({
    load: () => loaders.loadForecast(userId),
    fallback: null,
    empty: (data) => data === null || data.days.length === 0,
  });
  const pendingSuggestions = await resolveSection({
    load: () => loaders.loadPendingSuggestions(userId),
    fallback: null,
    empty: (data) => data === null,
  });
  const notifications = await resolveSection({
    load: () => loaders.loadNotifications(userId),
    fallback: [],
    empty: (data) => data.length === 0,
  });

  return aggregateResponse(
    {
      reviewQueue: reviewQueue.data,
      streak: streak.data,
      dueDecks: dueDecks.data,
      recent: recent.data,
      weakAreas: weakAreas.data,
      forecast: forecast.data,
      pendingSuggestions: pendingSuggestions.data,
      notifications: notifications.data,
    },
    {
      reviewQueue: reviewQueue.meta,
      streak: streak.meta,
      dueDecks: dueDecks.meta,
      recent: recent.meta,
      weakAreas: weakAreas.meta,
      forecast: forecast.meta,
      pendingSuggestions: pendingSuggestions.meta,
      notifications: notifications.meta,
    } satisfies CommandCenterSections,
  );
}

export const defaultCommandCenterLoaders: CommandCenterLoaders = {
  loadReviewQueue,
  loadStreak,
  loadDueDecks,
  loadRecent,
  loadWeakAreas,
  loadForecast,
  loadPendingSuggestions,
  loadNotifications,
};

/** Queue counters over canonical FSRS state: due / new / learning-ahead / at-risk. */
export function reviewQueueSql(userId: string, asOf: Date): SQL {
  return sql`
    SELECT
      COUNT(*) FILTER (WHERE s.id IS NOT NULL AND s.next_review_at <= ${fsrsAsOf(asOf)})::int AS "dueCount",
      COUNT(*) FILTER (WHERE ${FSRS_NEW})::int AS "newCount",
      COUNT(*) FILTER (
        WHERE ${FSRS_LEARNING} AND s.next_review_at > ${fsrsAsOf(asOf)}
      )::int AS "learningCount",
      COUNT(*) FILTER (WHERE ${fsrsAtRisk(asOf)})::int AS "atRiskCount"
    FROM cards c
    JOIN decks d ON d.id = c.deck_id AND d.user_id = ${userId}::uuid
    ${fsrsStateJoin(userId)}`;
}

async function loadReviewQueue(userId: string, asOf = new Date()) {
  const [row] = await db.execute<{
    dueCount: number;
    newCount: number;
    learningCount: number;
    atRiskCount: number;
  }>(reviewQueueSql(userId, asOf));

  const dueCount = row?.dueCount ?? 0;
  const newCount = row?.newCount ?? 0;
  const learningCount = row?.learningCount ?? 0;
  const atRiskCount = row?.atRiskCount ?? 0;

  return {
    dueCount,
    newCount,
    learningCount,
    atRiskCount,
    nextAction:
      dueCount + newCount + learningCount + atRiskCount > 0
        ? { id: 'study.queue', label: 'Study queue' }
        : null,
  };
}

async function loadStreak(userId: string) {
  const streak = await studyService.getUserStreak(userId);
  return {
    current: streak.currentStreak,
    longest: streak.longestStreak,
  };
}

/** Top decks that have at least one due card, with their new count and last review. */
export function dueDecksSummarySql(userId: string, asOf: Date): SQL {
  return sql`
    SELECT
      d.id,
      d.name,
      d.folder_id AS "folderId",
      COUNT(*) FILTER (WHERE ${fsrsDue(asOf)})::int AS "dueCount",
      COUNT(*) FILTER (WHERE ${FSRS_NEW})::int AS "newCount",
      MAX(s.last_reviewed_at) AS "lastStudiedAt"
    FROM decks d
    JOIN cards c ON c.deck_id = d.id
    ${fsrsStateJoin(userId)}
    WHERE d.user_id = ${userId}::uuid
    GROUP BY d.id, d.name, d.folder_id
    HAVING COUNT(*) FILTER (WHERE ${fsrsDue(asOf)}) > 0
    ORDER BY "dueCount" DESC, d.name ASC
    LIMIT 10`;
}

async function loadDueDecks(userId: string, asOf = new Date()) {
  const rows = await db.execute<{
    id: string;
    name: string;
    folderId: string | null;
    dueCount: number;
    newCount: number;
    lastStudiedAt: Date | string | null;
  }>(dueDecksSummarySql(userId, asOf));

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    folderId: row.folderId,
    dueCount: row.dueCount,
    newCount: row.newCount,
    lastStudiedAt: toIso(row.lastStudiedAt),
  }));
}

async function loadRecent(userId: string) {
  const [recentDecks, recentCards] = await Promise.all([
    db.execute<{ id: string; name: string; updatedAt: Date | string | null }>(sql`
      SELECT id, name, created_at AS "updatedAt"
      FROM decks
      WHERE user_id = ${userId}
      ORDER BY created_at DESC
      LIMIT 5
    `),
    db.execute<{
      id: string;
      deckId: string;
      title: string | null;
      updatedAt: Date | string | null;
    }>(sql`
      SELECT
        c.id,
        c.deck_id AS "deckId",
        MIN(CASE WHEN tf.side = 'front' THEN cfv.value #>> '{}' END) AS title,
        c.created_at AS "updatedAt"
      FROM cards c
      JOIN decks d ON d.id = c.deck_id
      LEFT JOIN card_field_values cfv ON cfv.card_id = c.id
      LEFT JOIN template_fields tf ON tf.id = cfv.template_field_id
      WHERE d.user_id = ${userId}
      GROUP BY c.id, c.deck_id, c.created_at
      ORDER BY c.created_at DESC
      LIMIT 5
    `),
  ]);

  return {
    decks: recentDecks.map((deck) => ({
      id: deck.id,
      name: deck.name,
      updatedAt: toIso(deck.updatedAt),
    })),
    cards: recentCards.map((card) => ({
      id: card.id,
      deckId: card.deckId,
      title: card.title ?? '',
      updatedAt: toIso(card.updatedAt),
    })),
  };
}

async function loadWeakAreas(userId: string) {
  const { groups } = await recommendationsService.getSmartGroups(userId, 5);
  return groups.map((group) => ({
    id: `concept:${group.name}`,
    label: group.name,
    cardCount: group.cardCount,
    avgRetention: group.avgRetention,
    action: {
      id: 'study.smart-group',
      label: `Review ${group.name}`,
      params: { smartGroupId: group.name },
    },
  }));
}

async function loadForecast(userId: string) {
  const { forecast } = await forecastService.getForecast(userId, 7);
  return {
    days: forecast.map((day) => ({
      date: day.date,
      atRiskCount: day.atRiskCount,
      avgRetention: day.avgRetention,
    })),
  };
}

async function loadPendingSuggestions() {
  return { duplicates: 0, aiSuggestions: 0 };
}

async function loadNotifications(userId: string) {
  const dueDecks = await notificationsService.getDueDecks(userId);
  return dueDecks.map((deck) => ({
    id: `due:${deck.deckId}`,
    title: `${deck.dueCount} cards due in ${deck.deckName}`,
    body: null,
    createdAt: new Date().toISOString(),
    href: `/study?deckId=${deck.deckId}`,
  }));
}

function toIso(value: Date | string | null) {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
