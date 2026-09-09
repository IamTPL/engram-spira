import { sql, type SQL } from 'drizzle-orm';
import { db } from '../../db';
import { NotFoundError } from '../../shared/errors';
import {
  FSRS_LEARNING,
  FSRS_NEW,
  fsrsAsOf,
  fsrsAtRisk,
  fsrsRetrievability,
  fsrsStateJoin,
} from '../study/fsrs-sql';
import { aggregateResponse, resolveSection } from './aggregate.helpers';
import type {
  AggregateResponse,
  DeckWorkspaceQuery,
  DeckWorkspaceResponse,
  DeckWorkspaceSections,
} from './experience.types';

export type DeckStudySummary = {
  study: DeckWorkspaceResponse['study'];
  analytics: DeckWorkspaceResponse['analytics'];
};

export type DeckWorkspaceLoaders = {
  loadDeck: (
    userId: string,
    deckId: string,
  ) => Promise<DeckWorkspaceResponse['deck'] | null>;
  loadCards: (
    userId: string,
    deckId: string,
    query: DeckWorkspaceQuery,
  ) => Promise<DeckWorkspaceResponse['cards']>;
  loadStudySummary: (
    userId: string,
    deckId: string,
  ) => Promise<DeckStudySummary>;
  loadCounters: (
    userId: string,
    deckId: string,
  ) => Promise<DeckWorkspaceResponse['counters']>;
};

export async function getDeckWorkspace(
  userId: string,
  deckId: string,
  query: DeckWorkspaceQuery = {},
  loaders: DeckWorkspaceLoaders = defaultDeckWorkspaceLoaders,
): Promise<AggregateResponse<DeckWorkspaceResponse, DeckWorkspaceSections>> {
  const deck = await resolveSection({
    required: true,
    load: async () => {
      const loaded = await loaders.loadDeck(userId, deckId);
      if (!loaded) throw new NotFoundError('Deck');
      return loaded;
    },
  });
  const cards = await resolveSection({
    required: true,
    load: () => loaders.loadCards(userId, deckId, query),
    empty: (data) => data.items.length === 0,
  });
  const summary = await resolveSection<DeckStudySummary>({
    load: () => loaders.loadStudySummary(userId, deckId),
    fallback: { study: null, analytics: null },
    empty: (data) => data.study === null && data.analytics === null,
  });
  const counters = await resolveSection({
    load: () => loaders.loadCounters(userId, deckId),
    fallback: null,
    empty: (data) => data === null,
  });

  return aggregateResponse(
    {
      deck: deck.data,
      cards: cards.data,
      study: summary.data.study,
      analytics: summary.data.analytics,
      counters: counters.data,
    },
    {
      deck: deck.meta,
      cards: cards.meta,
      study: summary.meta,
      analytics: summary.meta,
      counters: counters.meta,
    } satisfies DeckWorkspaceSections,
  );
}

export const defaultDeckWorkspaceLoaders: DeckWorkspaceLoaders = {
  loadDeck,
  loadCards,
  loadStudySummary: (userId, deckId) => loadStudySummary(userId, deckId),
  loadCounters,
};

async function loadDeck(userId: string, deckId: string) {
  if (!isUuid(deckId)) return null;

  const [row] = await db.execute<DeckWorkspaceResponse['deck']>(sql`
    SELECT
      d.id,
      d.name,
      d.folder_id AS "folderId",
      d.card_template_id AS "cardTemplateId",
      COUNT(c.id)::int AS "cardCount"
    FROM decks d
    LEFT JOIN cards c ON c.deck_id = d.id
    WHERE d.id = ${deckId} AND d.user_id = ${userId}
    GROUP BY d.id, d.name, d.folder_id, d.card_template_id
    LIMIT 1
  `);

  return row ?? null;
}

async function loadCards(
  userId: string,
  deckId: string,
  query: DeckWorkspaceQuery,
) {
  const page = Math.max(query.cardPage ?? 1, 1);
  const pageSize = Math.min(Math.max(query.cardPageSize ?? 50, 1), 100);
  const offset = (page - 1) * pageSize;
  const search = query.cardSearch?.trim();
  const searchClause = search
    ? sql`AND EXISTS (
        SELECT 1
        FROM card_field_values search_cfv
        WHERE search_cfv.card_id = c.id
          AND search_cfv.value::text ILIKE ${'%' + search + '%'}
      )`
    : sql``;

  const [[countRow], rows] = await Promise.all([
    db.execute<{ total: number }>(sql`
      SELECT COUNT(c.id)::int AS total
      FROM cards c
      JOIN decks d ON d.id = c.deck_id
      WHERE c.deck_id = ${deckId} AND d.user_id = ${userId}
      ${searchClause}
    `),
    db.execute<{
      id: string;
      title: string | null;
      preview: string | null;
      updatedAt: Date | string | null;
    }>(sql`
      SELECT
        c.id,
        MIN(CASE WHEN tf.side = 'front' THEN cfv.value #>> '{}' END) AS title,
        MIN(CASE WHEN tf.side = 'back' THEN cfv.value #>> '{}' END) AS preview,
        c.created_at AS "updatedAt"
      FROM cards c
      JOIN decks d ON d.id = c.deck_id
      LEFT JOIN card_field_values cfv ON cfv.card_id = c.id
      LEFT JOIN template_fields tf ON tf.id = cfv.template_field_id
      WHERE c.deck_id = ${deckId} AND d.user_id = ${userId}
      ${searchClause}
      GROUP BY c.id, c.created_at, c.sort_order
      ORDER BY c.sort_order ASC, c.id ASC
      LIMIT ${pageSize}
      OFFSET ${offset}
    `),
  ]);

  return {
    items: rows.map((row) => ({
      id: row.id,
      title: row.title ?? '',
      preview: row.preview ?? '',
      updatedAt: toIso(row.updatedAt),
    })),
    page,
    pageSize,
    total: countRow?.total ?? 0,
  };
}

/** One pass over a deck's canonical FSRS state feeding both the study and analytics sections. */
export function deckStudySummarySql(
  userId: string,
  deckId: string,
  asOf: Date,
): SQL {
  return sql`
    SELECT
      COUNT(c.id) FILTER (WHERE s.id IS NOT NULL AND s.next_review_at <= ${fsrsAsOf(asOf)})::int AS "dueCount",
      COUNT(c.id) FILTER (WHERE ${FSRS_NEW})::int AS "newCount",
      COUNT(c.id) FILTER (WHERE ${FSRS_LEARNING})::int AS "learningCount",
      MAX(s.last_reviewed_at) AS "lastStudiedAt",
      AVG(${fsrsRetrievability(asOf)})::real AS "avgRetention",
      COUNT(c.id) FILTER (WHERE ${fsrsAtRisk(asOf)})::int AS "atRiskCount"
    FROM cards c
    JOIN decks d ON d.id = c.deck_id
    ${fsrsStateJoin(userId)}
    WHERE d.id = ${deckId}::uuid AND d.user_id = ${userId}::uuid`;
}

async function loadStudySummary(
  userId: string,
  deckId: string,
  asOf = new Date(),
): Promise<DeckStudySummary> {
  const [row] = await db.execute<{
    dueCount: number;
    newCount: number;
    learningCount: number;
    lastStudiedAt: Date | string | null;
    avgRetention: number | null;
    atRiskCount: number;
  }>(deckStudySummarySql(userId, deckId, asOf));

  return {
    study: {
      dueCount: row?.dueCount ?? 0,
      newCount: row?.newCount ?? 0,
      learningCount: row?.learningCount ?? 0,
      lastStudiedAt: toIso(row?.lastStudiedAt ?? null),
    },
    analytics: {
      avgRetention: row?.avgRetention ?? null,
      atRiskCount: row?.atRiskCount ?? 0,
    },
  };
}

async function loadCounters() {
  return { graphLinks: 0, duplicates: 0, aiSuggestions: 0 };
}

function toIso(value: Date | string | null) {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
