import { sql } from 'drizzle-orm';
import { db } from '../../db';
import { NotFoundError } from '../../shared/errors';
import { aggregateResponse, resolveSection } from './aggregate.helpers';
import type {
  AggregateResponse,
  DeckWorkspaceQuery,
  DeckWorkspaceResponse,
  DeckWorkspaceSections,
} from './experience.types';

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
  loadStudy: (
    userId: string,
    deckId: string,
  ) => Promise<DeckWorkspaceResponse['study']>;
  loadAnalytics: (
    userId: string,
    deckId: string,
  ) => Promise<DeckWorkspaceResponse['analytics']>;
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
  const study = await resolveSection({
    load: () => loaders.loadStudy(userId, deckId),
    fallback: null,
    empty: (data) => data === null,
  });
  const analytics = await resolveSection({
    load: () => loaders.loadAnalytics(userId, deckId),
    fallback: null,
    empty: (data) => data === null,
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
      study: study.data,
      analytics: analytics.data,
      counters: counters.data,
    },
    {
      deck: deck.meta,
      cards: cards.meta,
      study: study.meta,
      analytics: analytics.meta,
      counters: counters.meta,
    } satisfies DeckWorkspaceSections,
  );
}

export const defaultDeckWorkspaceLoaders: DeckWorkspaceLoaders = {
  loadDeck,
  loadCards,
  loadStudy,
  loadAnalytics,
  loadCounters,
};

async function loadDeck(userId: string, deckId: string) {
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

async function loadStudy(userId: string, deckId: string) {
  const [row] = await db.execute<{
    dueCount: number;
    newCount: number;
    learningCount: number;
    lastStudiedAt: Date | string | null;
  }>(sql`
    SELECT
      COUNT(c.id) FILTER (WHERE sp.id IS NOT NULL AND sp.next_review_at <= NOW())::int AS "dueCount",
      COUNT(c.id) FILTER (WHERE sp.id IS NULL)::int AS "newCount",
      COUNT(c.id) FILTER (WHERE sp.id IS NOT NULL AND sp.box_level = 0)::int AS "learningCount",
      MAX(sp.last_reviewed_at) AS "lastStudiedAt"
    FROM cards c
    JOIN decks d ON d.id = c.deck_id
    LEFT JOIN study_progress sp ON sp.card_id = c.id AND sp.user_id = ${userId}
    WHERE d.id = ${deckId} AND d.user_id = ${userId}
  `);

  return {
    dueCount: row?.dueCount ?? 0,
    newCount: row?.newCount ?? 0,
    learningCount: row?.learningCount ?? 0,
    lastStudiedAt: toIso(row?.lastStudiedAt ?? null),
  };
}

async function loadAnalytics(userId: string, deckId: string) {
  const [row] = await db.execute<{
    avgRetention: number | null;
    atRiskCount: number;
  }>(sql`
    SELECT
      AVG(
        CASE
          WHEN sp.last_reviewed_at IS NULL THEN NULL
          ELSE GREATEST(
            0,
            LEAST(
              1,
              1 - (
                EXTRACT(EPOCH FROM (NOW() - sp.last_reviewed_at)) / 86400
              ) / GREATEST(COALESCE(sp.stability, sp.interval_days::real, 1), 1) * 0.1
            )
          )
        END
      )::real AS "avgRetention",
      COUNT(c.id) FILTER (
        WHERE sp.id IS NOT NULL
          AND sp.next_review_at > NOW()
          AND sp.last_reviewed_at IS NOT NULL
      )::int AS "atRiskCount"
    FROM cards c
    JOIN decks d ON d.id = c.deck_id
    LEFT JOIN study_progress sp ON sp.card_id = c.id AND sp.user_id = ${userId}
    WHERE d.id = ${deckId} AND d.user_id = ${userId}
  `);

  return {
    avgRetention: row?.avgRetention ?? null,
    atRiskCount: row?.atRiskCount ?? 0,
  };
}

async function loadCounters() {
  return { graphLinks: 0, duplicates: 0, aiSuggestions: 0 };
}

function toIso(value: Date | string | null) {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
