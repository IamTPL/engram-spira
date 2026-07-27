import { sql, type SQL } from 'drizzle-orm';
import { db } from '../../db';
import { NotFoundError, ValidationError } from '../../shared/errors';
import {
  atRiskRetentionFilterSql,
  retentionEstimateSelectSql,
} from './retention-sql';
import type { StudyQueueQuery, StudyQueueResponse } from './experience.types';

export type StudyQueueRow = {
  id: string;
  deckId: string;
  front: string | null;
  back: string | null;
  templateName: string | null;
  dueAt: Date | string | null;
  retentionEstimate: number | null;
  boxLevel: number | null;
  lastReviewedAt: Date | string | null;
  sortOrder: number;
};

type StudyQueueScope = {
  deckId?: string;
  folderId?: string;
  classId?: string;
  smartGroupId?: string;
};

export type StudyQueueLoaders = {
  ensureDeck: (userId: string, deckId: string) => Promise<void>;
  ensureFolder: (userId: string, folderId: string) => Promise<void>;
  ensureClass: (userId: string, classId: string) => Promise<void>;
  ensureSmartGroup: (userId: string, smartGroupId: string) => Promise<void>;
  loadQueueRows: (
    userId: string,
    query: StudyQueueQuery,
    scope: StudyQueueScope,
  ) => Promise<StudyQueueRow[]>;
};

export async function getStudyQueue(
  userId: string,
  query: StudyQueueQuery,
  loaders: StudyQueueLoaders = defaultStudyQueueLoaders,
): Promise<StudyQueueResponse> {
  const normalized = normalizeQuery(query);
  const scope = await validateScope(userId, normalized, loaders);
  const limit = Math.min(Math.max(normalized.limit ?? 50, 1), 200);
  const rows = await loaders.loadQueueRows(userId, { ...normalized, limit }, scope);
  const cards = rows.map((row) => toQueueCard(row, normalized.mode));
  const sortOrderByCard = new Map<string, number>();
  for (const row of rows) {
    if (!sortOrderByCard.has(row.id)) {
      sortOrderByCard.set(row.id, row.sortOrder);
    }
  }

  cards.sort((a, b) => {
    const reasonDiff = reasonRank(a.reason) - reasonRank(b.reason);
    if (reasonDiff !== 0) return reasonDiff;
    const orderDiff =
      (sortOrderByCard.get(a.id) ?? 0) - (sortOrderByCard.get(b.id) ?? 0);
    if (orderDiff !== 0) return orderDiff;
    return a.id.localeCompare(b.id);
  });

  const limitedCards = cards.slice(0, limit);

  return {
    mode: normalized.mode,
    title: titleForMode(normalized.mode),
    cards: limitedCards,
    summary: summarize(limitedCards),
  };
}

function normalizeQuery(query: StudyQueueQuery): StudyQueueQuery {
  const mode = query.mode ?? 'due';
  if (
    mode !== 'due' &&
    mode !== 'deck' &&
    mode !== 'folder' &&
    mode !== 'class' &&
    mode !== 'smart-group' &&
    mode !== 'interleaved' &&
    mode !== 'at-risk'
  ) {
    throw new ValidationError('Invalid study queue mode');
  }
  return { ...query, mode } as StudyQueueQuery;
}

async function validateScope(
  userId: string,
  query: StudyQueueQuery,
  loaders: StudyQueueLoaders,
): Promise<StudyQueueScope> {
  switch (query.mode) {
    case 'deck':
      if (!query.deckId) throw new ValidationError('deckId is required');
      await loaders.ensureDeck(userId, query.deckId);
      return { deckId: query.deckId };
    case 'folder':
      if (!query.folderId) throw new ValidationError('folderId is required');
      await loaders.ensureFolder(userId, query.folderId);
      return { folderId: query.folderId };
    case 'class':
      if (!query.classId) throw new ValidationError('classId is required');
      await loaders.ensureClass(userId, query.classId);
      return { classId: query.classId };
    case 'smart-group':
      if (!query.smartGroupId) {
        throw new ValidationError('smartGroupId is required');
      }
      await loaders.ensureSmartGroup(userId, query.smartGroupId);
      return { smartGroupId: query.smartGroupId };
    case 'at-risk':
      if (query.deckId) {
        await loaders.ensureDeck(userId, query.deckId);
        return { deckId: query.deckId };
      }
      return {};
    case 'due':
    case 'interleaved':
      return {};
  }
}

function toQueueCard(
  row: StudyQueueRow,
  mode: StudyQueueQuery['mode'],
): StudyQueueResponse['cards'][number] {
  const dueAt = toIso(row.dueAt);
  const reason = reasonForRow(row, mode);

  return {
    id: row.id,
    deckId: row.deckId,
    front: row.front ?? '',
    back: row.back ?? '',
    templateName: row.templateName,
    reason,
    dueAt,
    retentionEstimate: row.retentionEstimate,
  };
}

function reasonForRow(
  row: StudyQueueRow,
  mode: StudyQueueQuery['mode'],
): StudyQueueResponse['cards'][number]['reason'] {
  if (mode === 'interleaved') return 'interleaved';
  if (mode === 'at-risk') return 'at-risk';
  if (row.dueAt === null) return 'new';
  if (isDue(row.dueAt)) return 'due';
  if (row.boxLevel === 0 && row.lastReviewedAt !== null) return 'learning';
  if (row.retentionEstimate !== null && row.retentionEstimate < 0.8) {
    return 'at-risk';
  }
  return 'manual';
}

function isDue(value: Date | string): boolean {
  return new Date(value).getTime() <= Date.now();
}

function reasonRank(reason: StudyQueueResponse['cards'][number]['reason']) {
  return {
    due: 0,
    new: 1,
    learning: 2,
    'at-risk': 3,
    interleaved: 4,
    manual: 5,
  }[reason];
}

function summarize(cards: StudyQueueResponse['cards']) {
  return cards.reduce(
    (summary, card) => {
      summary.total++;
      if (card.reason === 'due') summary.due++;
      if (card.reason === 'new') summary.new++;
      if (card.reason === 'learning') summary.learning++;
      if (card.reason === 'at-risk') summary.atRisk++;
      return summary;
    },
    { total: 0, due: 0, new: 0, learning: 0, atRisk: 0 },
  );
}

function titleForMode(mode: StudyQueueQuery['mode']) {
  return {
    due: 'Due cards',
    deck: 'Deck queue',
    folder: 'Folder queue',
    class: 'Class queue',
    'smart-group': 'Smart group queue',
    interleaved: 'Interleaved queue',
    'at-risk': 'At-risk cards',
  }[mode];
}

function toIso(value: Date | string | null) {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export const defaultStudyQueueLoaders: StudyQueueLoaders = {
  ensureDeck: async (userId, deckId) => {
    if (!isUuid(deckId)) throw new NotFoundError('Deck');

    const [row] = await db.execute<{ id: string }>(sql`
      SELECT id FROM decks WHERE id = ${deckId} AND user_id = ${userId} LIMIT 1
    `);
    if (!row) throw new NotFoundError('Deck');
  },
  ensureFolder: async (userId, folderId) => {
    if (!isUuid(folderId)) throw new NotFoundError('Folder');

    const [row] = await db.execute<{ id: string }>(sql`
      SELECT f.id
      FROM folders f
      JOIN classes c ON c.id = f.class_id
      WHERE f.id = ${folderId} AND c.user_id = ${userId}
      LIMIT 1
    `);
    if (!row) throw new NotFoundError('Folder');
  },
  ensureClass: async (userId, classId) => {
    if (!isUuid(classId)) throw new NotFoundError('Class');

    const [row] = await db.execute<{ id: string }>(sql`
      SELECT id FROM classes WHERE id = ${classId} AND user_id = ${userId} LIMIT 1
    `);
    if (!row) throw new NotFoundError('Class');
  },
  ensureSmartGroup: async (userId, smartGroupId) => {
    const [row] = await db.execute<{ concept: string }>(sql`
      SELECT cc.concept
      FROM card_concepts cc
      JOIN cards c ON c.id = cc.card_id
      JOIN decks d ON d.id = c.deck_id
      WHERE d.user_id = ${userId} AND cc.concept = ${smartGroupId}
      LIMIT 1
    `);
    if (!row) throw new NotFoundError('Smart group');
  },
  loadQueueRows,
};

async function loadQueueRows(
  userId: string,
  query: StudyQueueQuery,
  scope: StudyQueueScope,
): Promise<StudyQueueRow[]> {
  const filters: SQL[] = [sql`d.user_id = ${userId}`];

  if (scope.deckId) filters.push(sql`d.id = ${scope.deckId}`);
  if (scope.folderId) filters.push(sql`d.folder_id = ${scope.folderId}`);
  if (scope.classId) filters.push(sql`cl.id = ${scope.classId}`);
  if (scope.smartGroupId) filters.push(sql`cc.concept = ${scope.smartGroupId}`);

  if (
    query.mode === 'due' ||
    query.mode === 'deck' ||
    query.mode === 'folder' ||
    query.mode === 'class'
  ) {
    filters.push(sql`(sp.id IS NULL OR sp.next_review_at <= NOW())`);
  }
  if (query.mode === 'at-risk') {
    filters.push(atRiskRetentionFilterSql());
  }

  const smartGroupJoin =
    query.mode === 'smart-group' ? sql`JOIN card_concepts cc ON cc.card_id = c.id` : sql``;

  return db.execute<StudyQueueRow>(sql`
    SELECT
      c.id,
      c.deck_id AS "deckId",
      MIN(CASE WHEN tf.side = 'front' THEN cfv.value #>> '{}' END) AS front,
      MIN(CASE WHEN tf.side = 'back' THEN cfv.value #>> '{}' END) AS back,
      ct.name AS "templateName",
      sp.next_review_at AS "dueAt",
      ${retentionEstimateSelectSql()} AS "retentionEstimate",
      sp.box_level AS "boxLevel",
      sp.last_reviewed_at AS "lastReviewedAt",
      c.sort_order AS "sortOrder"
    FROM cards c
    JOIN decks d ON d.id = c.deck_id
    JOIN folders f ON f.id = d.folder_id
    JOIN classes cl ON cl.id = f.class_id
    JOIN card_templates ct ON ct.id = d.card_template_id
    ${smartGroupJoin}
    LEFT JOIN study_progress sp ON sp.card_id = c.id AND sp.user_id = ${userId}
    LEFT JOIN card_field_values cfv ON cfv.card_id = c.id
    LEFT JOIN template_fields tf ON tf.id = cfv.template_field_id
    WHERE ${sql.join(filters, sql` AND `)}
    GROUP BY c.id, c.deck_id, ct.name, sp.next_review_at, sp.last_reviewed_at,
      sp.box_level, sp.stability, sp.interval_days, sp.ease_factor, c.sort_order
    ORDER BY COALESCE(sp.next_review_at, NOW()) ASC, c.sort_order ASC, c.id ASC
    LIMIT ${query.limit ?? 50}
  `);
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
