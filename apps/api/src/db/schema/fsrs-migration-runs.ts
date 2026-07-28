import { relations, sql } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const fsrsMigrationRuns = pgTable(
  'fsrs_migration_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    status: varchar('status', { length: 20 }).notNull(),
    engineVersion: varchar('engine_version', { length: 100 }).notNull(),
    algorithmVersion: varchar('algorithm_version', { length: 100 }).notNull(),
    policyVersion: varchar('policy_version', { length: 100 }).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    sourceCounts: jsonb('source_counts')
      .$type<Record<string, number>>()
      .notNull(),
    resultCounts: jsonb('result_counts')
      .$type<Record<string, number>>()
      .notNull(),
    anomalies: jsonb('anomalies').$type<unknown[]>().notNull(),
    sourceChecksum: varchar('source_checksum', { length: 64 }),
    resultChecksum: varchar('result_checksum', { length: 64 }),
    errorMessage: text('error_message'),
  },
  (table) => [
    index('idx_fsrs_migration_runs_status_started').on(
      table.status,
      table.startedAt.desc(),
    ),
    check(
      'chk_fsrs_migration_runs_status',
      sql`${table.status} IN ('running', 'completed', 'failed')`,
    ),
    check(
      'chk_fsrs_migration_runs_source_checksum',
      sql`${table.sourceChecksum} IS NULL
        OR length(${table.sourceChecksum}) = 64`,
    ),
    check(
      'chk_fsrs_migration_runs_result_checksum',
      sql`${table.resultChecksum} IS NULL
        OR length(${table.resultChecksum}) = 64`,
    ),
  ],
);

export const fsrsMigrationRunsRelations = relations(
  fsrsMigrationRuns,
  () => ({}),
);
