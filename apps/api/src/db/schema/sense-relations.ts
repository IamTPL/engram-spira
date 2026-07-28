import {
  check,
  index,
  jsonb,
  pgTable,
  real,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { users } from './users';
import { lexicalSenses } from './lexical-senses';
import { kgRelationSuggestions } from './kg-relation-suggestions';

export const senseRelations = pgTable(
  'sense_relations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sourceSenseId: uuid('source_sense_id')
      .notNull()
      .references(() => lexicalSenses.id, { onDelete: 'cascade' }),
    targetSenseId: uuid('target_sense_id')
      .notNull()
      .references(() => lexicalSenses.id, { onDelete: 'cascade' }),
    relationType: varchar('relation_type', { length: 30 }).notNull(),
    origin: varchar('origin', { length: 10 }).notNull(),
    confidence: real('confidence').notNull().default(1),
    evidence: jsonb('evidence').$type<{
      source: string;
      target: string;
    } | null>(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('uq_sense_relation').on(
      table.userId,
      table.sourceSenseId,
      table.targetSenseId,
      table.relationType,
    ),
    index('idx_sense_relations_source').on(table.sourceSenseId),
    index('idx_sense_relations_target').on(table.targetSenseId),
    index('idx_sense_relations_user').on(table.userId),
    check(
      'chk_sense_relations_no_self',
      sql`${table.sourceSenseId} != ${table.targetSenseId}`,
    ),
    check(
      'chk_sense_relations_confidence',
      sql`${table.confidence} >= 0 AND ${table.confidence} <= 1`,
    ),
    check(
      'chk_sense_relations_type',
      sql`${table.relationType} IN (
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
      'chk_sense_relations_origin',
      sql`${table.origin} IN ('manual', 'ai')`,
    ),
    check(
      'chk_sense_relations_symmetric_order',
      sql`${table.relationType} NOT IN (
        'synonym',
        'antonym',
        'collocation',
        'confused_with',
        'translation_of',
        'coordinate'
      ) OR ${table.sourceSenseId} < ${table.targetSenseId}`,
    ),
  ],
);

export const senseRelationsRelations = relations(
  senseRelations,
  ({ one, many }) => ({
    user: one(users, {
      fields: [senseRelations.userId],
      references: [users.id],
    }),
    sourceSense: one(lexicalSenses, {
      fields: [senseRelations.sourceSenseId],
      references: [lexicalSenses.id],
      relationName: 'senseRelationSource',
    }),
    targetSense: one(lexicalSenses, {
      fields: [senseRelations.targetSenseId],
      references: [lexicalSenses.id],
      relationName: 'senseRelationTarget',
    }),
    acceptedSuggestions: many(kgRelationSuggestions),
  }),
);
