import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { users } from './users';
import { decks } from './decks';
import { lexicalSenses } from './lexical-senses';
import { kgRelationSuggestions } from './kg-relation-suggestions';

export const kgRuns = pgTable(
  'kg_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    runType: varchar('run_type', { length: 30 }).notNull(),
    deckId: uuid('deck_id').references(() => decks.id, {
      onDelete: 'cascade',
    }),
    focusSenseId: uuid('focus_sense_id').references(() => lexicalSenses.id, {
      onDelete: 'cascade',
    }),
    status: varchar('status', { length: 20 }).notNull().default('queued'),
    stage: varchar('stage', { length: 20 }).notNull().default('snapshot'),
    fingerprint: varchar('fingerprint', { length: 64 }).notNull(),
    representationVersion: varchar('representation_version', {
      length: 20,
    }).notNull(),
    embeddingModel: varchar('embedding_model', { length: 100 }).notNull(),
    promptVersion: varchar('prompt_version', { length: 50 }).notNull(),
    taxonomyVersion: varchar('taxonomy_version', { length: 50 }).notNull(),
    sourceLanguageTag: varchar('source_language_tag', { length: 35 }).notNull(),
    definitionLanguageTag: varchar('definition_language_tag', {
      length: 35,
    }).notNull(),
    snapshot: jsonb('snapshot')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    progress: jsonb('progress')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    stats: jsonb('stats')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    attemptCount: integer('attempt_count').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lockedBy: uuid('locked_by'),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }),
    errorCode: varchar('error_code', { length: 100 }),
    errorMessage: text('error_message'),
    cancelRequestedAt: timestamp('cancel_requested_at', {
      withTimezone: true,
    }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    partialAt: timestamp('partial_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    staleAt: timestamp('stale_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('idx_kg_runs_user_created').on(table.userId, table.createdAt),
    index('idx_kg_runs_fingerprint').on(table.userId, table.fingerprint),
    index('idx_kg_runs_deck').on(table.deckId),
    index('idx_kg_runs_focus_sense').on(table.focusSenseId),
    index('idx_kg_runs_ready')
      .on(table.nextAttemptAt, table.createdAt)
      .where(sql`${table.status} = 'queued'`),
    index('idx_kg_runs_processing_lease')
      .on(table.lockedUntil)
      .where(sql`${table.status} = 'processing'`),
    uniqueIndex('uq_kg_runs_active_deck')
      .on(table.userId, table.deckId)
      .where(
        sql`${table.deckId} IS NOT NULL
          AND ${table.status} IN ('queued', 'processing')`,
      ),
    uniqueIndex('uq_kg_runs_active_focus_sense')
      .on(table.userId, table.focusSenseId)
      .where(
        sql`${table.focusSenseId} IS NOT NULL
          AND ${table.status} IN ('queued', 'processing')`,
      ),
    check(
      'chk_kg_runs_type',
      sql`${table.runType} IN ('deck_index', 'sense_expansion')`,
    ),
    check(
      'chk_kg_runs_target',
      sql`(
        ${table.runType} = 'deck_index'
        AND ${table.deckId} IS NOT NULL
        AND ${table.focusSenseId} IS NULL
      ) OR (
        ${table.runType} = 'sense_expansion'
        AND ${table.deckId} IS NULL
        AND ${table.focusSenseId} IS NOT NULL
      )`,
    ),
    check(
      'chk_kg_runs_status',
      sql`${table.status} IN (
        'queued',
        'processing',
        'completed',
        'partial',
        'failed',
        'cancelled',
        'stale'
      )`,
    ),
    check(
      'chk_kg_runs_stage',
      sql`${table.stage} IN (
        'snapshot',
        'indexing',
        'embeddings',
        'candidates',
        'verification',
        'persistence'
      )`,
    ),
    check(
      'chk_kg_runs_attempt_count',
      sql`${table.attemptCount} >= 0`,
    ),
    check('chk_kg_runs_max_attempts', sql`${table.maxAttempts} > 0`),
  ],
);

export const kgRunsRelations = relations(kgRuns, ({ one, many }) => ({
  user: one(users, {
    fields: [kgRuns.userId],
    references: [users.id],
  }),
  deck: one(decks, {
    fields: [kgRuns.deckId],
    references: [decks.id],
  }),
  focusSense: one(lexicalSenses, {
    fields: [kgRuns.focusSenseId],
    references: [lexicalSenses.id],
  }),
  suggestions: many(kgRelationSuggestions),
}));
