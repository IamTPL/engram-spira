import { relations, sql } from 'drizzle-orm';
import {
  check,
  integer,
  jsonb,
  pgTable,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { users } from './users';

export const fsrsParameterRevisions = pgTable(
  'fsrs_parameter_revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull(),
    engineVersion: varchar('engine_version', { length: 100 }).notNull(),
    algorithmVersion: varchar('algorithm_version', { length: 100 }).notNull(),
    policyVersion: varchar('policy_version', { length: 100 }).notNull(),
    parameters: jsonb('parameters')
      .$type<Record<string, unknown>>()
      .notNull(),
    paramsHash: varchar('params_hash', { length: 64 }).notNull(),
    source: varchar('source', { length: 20 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    activatedAt: timestamp('activated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    retiredAt: timestamp('retired_at', { withTimezone: true }),
  },
  (table) => [
    unique('uq_fsrs_parameter_revisions_user_revision').on(
      table.userId,
      table.revision,
    ),
    unique('uq_fsrs_parameter_revisions_resolved_params').on(
      table.userId,
      table.engineVersion,
      table.policyVersion,
      table.paramsHash,
    ),
    uniqueIndex('uq_fsrs_parameter_revisions_active_user')
      .on(table.userId)
      .where(sql`${table.retiredAt} IS NULL`),
    check(
      'chk_fsrs_parameter_revisions_revision',
      sql`${table.revision} > 0`,
    ),
    check(
      'chk_fsrs_parameter_revisions_params_hash',
      sql`length(${table.paramsHash}) = 64`,
    ),
    check(
      'chk_fsrs_parameter_revisions_source',
      sql`${table.source} IN ('default', 'manual', 'optimized', 'migration')`,
    ),
  ],
);

export const fsrsParameterRevisionsRelations = relations(
  fsrsParameterRevisions,
  ({ one }) => ({
    user: one(users, {
      fields: [fsrsParameterRevisions.userId],
      references: [users.id],
    }),
  }),
);
