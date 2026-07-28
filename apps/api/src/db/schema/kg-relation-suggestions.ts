import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { users } from './users';
import { cards } from './cards';
import { lexicalSenses } from './lexical-senses';
import { senseRelations } from './sense-relations';
import { kgRuns } from './kg-runs';

export const kgRelationSuggestions = pgTable(
  'kg_relation_suggestions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => kgRuns.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sourceCardId: uuid('source_card_id').references(() => cards.id, {
      onDelete: 'cascade',
    }),
    targetCardId: uuid('target_card_id').references(() => cards.id, {
      onDelete: 'cascade',
    }),
    sourceSenseId: uuid('source_sense_id').references(() => lexicalSenses.id, {
      onDelete: 'cascade',
    }),
    targetSenseId: uuid('target_sense_id').references(() => lexicalSenses.id, {
      onDelete: 'cascade',
    }),
    sourceArtifact: jsonb('source_artifact')
      .$type<Record<string, unknown>>()
      .notNull(),
    targetArtifact: jsonb('target_artifact')
      .$type<Record<string, unknown>>()
      .notNull(),
    sourceContentHash: varchar('source_content_hash', { length: 64 }).notNull(),
    targetContentHash: varchar('target_content_hash', { length: 64 }).notNull(),
    decision: varchar('decision', { length: 15 }).notNull(),
    relationType: varchar('relation_type', { length: 30 }),
    direction: varchar('direction', { length: 25 }),
    confidenceBand: varchar('confidence_band', { length: 10 }).notNull(),
    reason: text('reason').notNull(),
    evidence: jsonb('evidence').$type<{
      source: string;
      target: string;
    } | null>(),
    retrievalSimilarity: real('retrieval_similarity'),
    mutualKnn: boolean('mutual_knn').notNull().default(false),
    fingerprint: varchar('fingerprint', { length: 64 }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    acceptedRelationId: uuid('accepted_relation_id').references(
      () => senseRelations.id,
      { onDelete: 'set null' },
    ),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
  },
  (table) => [
    unique('uq_kg_suggestions_user_fingerprint').on(
      table.userId,
      table.fingerprint,
    ),
    index('idx_kg_suggestions_run_status').on(table.runId, table.status),
    index('idx_kg_suggestions_user_status').on(table.userId, table.status),
    index('idx_kg_suggestions_source_card').on(table.sourceCardId),
    index('idx_kg_suggestions_target_card').on(table.targetCardId),
    index('idx_kg_suggestions_source_sense').on(table.sourceSenseId),
    index('idx_kg_suggestions_target_sense').on(table.targetSenseId),
    index('idx_kg_suggestions_accepted_relation').on(table.acceptedRelationId),
    check(
      'chk_kg_suggestions_endpoints',
      sql`
        ${table.sourceCardId} IS NOT NULL
        OR ${table.sourceSenseId} IS NOT NULL
      `,
    ),
    check(
      'chk_kg_suggestions_decision',
      sql`${table.decision} IN ('relation', 'none', 'abstain')`,
    ),
    check(
      'chk_kg_suggestions_relation_type',
      sql`${table.relationType} IS NULL OR ${table.relationType} IN (
        'synonym',
        'antonym',
        'is_a',
        'part_of',
        'derived_from',
        'collocation',
        'confused_with',
        'translation_of',
        'coordinate'
      )`,
    ),
    check(
      'chk_kg_suggestions_direction',
      sql`${table.direction} IS NULL OR ${table.direction} IN (
        'source_to_target',
        'target_to_source',
        'symmetric'
      )`,
    ),
    check(
      'chk_kg_suggestions_verdict',
      sql`(
        ${table.decision} = 'relation'
        AND ${table.relationType} IS NOT NULL
        AND ${table.direction} IS NOT NULL
      ) OR (
        ${table.decision} IN ('none', 'abstain')
        AND ${table.relationType} IS NULL
        AND ${table.direction} IS NULL
      )`,
    ),
    check(
      'chk_kg_suggestions_relation_direction',
      sql`${table.relationType} IS NULL OR (
        ${table.relationType} IN (
          'synonym',
          'antonym',
          'collocation',
          'confused_with',
          'translation_of',
          'coordinate'
        )
        AND ${table.direction} = 'symmetric'
      ) OR (
        ${table.relationType} IN ('is_a', 'part_of', 'derived_from')
        AND ${table.direction} IN ('source_to_target', 'target_to_source')
      )`,
    ),
    check(
      'chk_kg_suggestions_confidence_band',
      sql`${table.confidenceBand} IN ('high', 'medium', 'low')`,
    ),
    check(
      'chk_kg_suggestions_similarity',
      sql`${table.retrievalSimilarity} IS NULL
        OR (
          ${table.retrievalSimilarity} >= 0
          AND ${table.retrievalSimilarity} <= 1
        )`,
    ),
    check(
      'chk_kg_suggestions_status',
      sql`${table.status} IN (
        'pending',
        'accepted',
        'dismissed',
        'superseded',
        'rejected'
      )`,
    ),
  ],
);

export const kgRelationSuggestionsRelations = relations(
  kgRelationSuggestions,
  ({ one }) => ({
    run: one(kgRuns, {
      fields: [kgRelationSuggestions.runId],
      references: [kgRuns.id],
    }),
    user: one(users, {
      fields: [kgRelationSuggestions.userId],
      references: [users.id],
    }),
    sourceCard: one(cards, {
      fields: [kgRelationSuggestions.sourceCardId],
      references: [cards.id],
      relationName: 'suggestionSourceCard',
    }),
    targetCard: one(cards, {
      fields: [kgRelationSuggestions.targetCardId],
      references: [cards.id],
      relationName: 'suggestionTargetCard',
    }),
    sourceSense: one(lexicalSenses, {
      fields: [kgRelationSuggestions.sourceSenseId],
      references: [lexicalSenses.id],
      relationName: 'suggestionSourceSense',
    }),
    targetSense: one(lexicalSenses, {
      fields: [kgRelationSuggestions.targetSenseId],
      references: [lexicalSenses.id],
      relationName: 'suggestionTargetSense',
    }),
    acceptedRelation: one(senseRelations, {
      fields: [kgRelationSuggestions.acceptedRelationId],
      references: [senseRelations.id],
    }),
  }),
);
