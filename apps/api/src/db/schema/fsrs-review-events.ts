import { relations, sql } from 'drizzle-orm';
import {
  bigint,
  check,
  doublePrecision,
  index,
  integer,
  pgTable,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { cards } from './cards';
import { fsrsParameterRevisions } from './fsrs-parameter-revisions';
import { users } from './users';

export const fsrsReviewEvents = pgTable(
  'fsrs_review_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requestId: uuid('request_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    cardId: uuid('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    sequence: integer('sequence').notNull(),
    rating: varchar('rating', { length: 10 }).notNull(),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    durationMs: integer('duration_ms'),
    parameterRevisionId: uuid('parameter_revision_id')
      .notNull()
      .references(() => fsrsParameterRevisions.id),
    origin: varchar('origin', { length: 10 }).notNull(),
    beforeState: varchar('before_state', { length: 20 }),
    beforeDueAt: timestamp('before_due_at', { withTimezone: true }),
    beforeStability: doublePrecision('before_stability'),
    beforeDifficulty: doublePrecision('before_difficulty'),
    beforeScheduledDays: integer('before_scheduled_days'),
    beforeLearningSteps: integer('before_learning_steps'),
    elapsedDays: integer('elapsed_days').notNull(),
    afterState: varchar('after_state', { length: 20 }).notNull(),
    afterDueAt: timestamp('after_due_at', { withTimezone: true }).notNull(),
    afterStability: doublePrecision('after_stability').notNull(),
    afterDifficulty: doublePrecision('after_difficulty').notNull(),
    afterScheduledDays: integer('after_scheduled_days').notNull(),
    afterLearningSteps: integer('after_learning_steps').notNull(),
    afterReps: integer('after_reps').notNull(),
    afterLapses: integer('after_lapses').notNull(),
    afterStateVersion: bigint('after_state_version', {
      mode: 'number',
    }).notNull(),
  },
  (table) => [
    unique('uq_fsrs_review_events_user_request').on(
      table.userId,
      table.requestId,
    ),
    unique('uq_fsrs_review_events_user_card_sequence').on(
      table.userId,
      table.cardId,
      table.sequence,
    ),
    index('idx_fsrs_review_events_user_reviewed').on(
      table.userId,
      table.reviewedAt.desc(),
    ),
    index('idx_fsrs_review_events_card').on(table.cardId),
    index('idx_fsrs_review_events_parameter_revision').on(
      table.parameterRevisionId,
    ),
    check('chk_fsrs_review_events_sequence', sql`${table.sequence} > 0`),
    check(
      'chk_fsrs_review_events_rating',
      sql`${table.rating} IN ('again', 'hard', 'good', 'easy')`,
    ),
    check(
      'chk_fsrs_review_events_origin',
      sql`${table.origin} IN ('live', 'migration')`,
    ),
    check(
      'chk_fsrs_review_events_duration',
      sql`${table.durationMs} IS NULL OR ${table.durationMs} >= 0`,
    ),
    check(
      'chk_fsrs_review_events_before_snapshot',
      sql`(
        ${table.beforeState} IS NULL
        AND ${table.beforeDueAt} IS NULL
        AND ${table.beforeStability} IS NULL
        AND ${table.beforeDifficulty} IS NULL
        AND ${table.beforeScheduledDays} IS NULL
        AND ${table.beforeLearningSteps} IS NULL
      ) OR (
        ${table.beforeState} IS NOT NULL
        AND ${table.beforeDueAt} IS NOT NULL
        AND ${table.beforeStability} IS NOT NULL
        AND ${table.beforeDifficulty} IS NOT NULL
        AND ${table.beforeScheduledDays} IS NOT NULL
        AND ${table.beforeLearningSteps} IS NOT NULL
      )`,
    ),
    check(
      'chk_fsrs_review_events_before_state',
      sql`${table.beforeState} IS NULL
        OR ${table.beforeState} IN ('learning', 'review', 'relearning')`,
    ),
    check(
      'chk_fsrs_review_events_after_state',
      sql`${table.afterState} IN ('learning', 'review', 'relearning')`,
    ),
    check(
      'chk_fsrs_review_events_before_stability',
      sql`${table.beforeStability} IS NULL
        OR (
          ${table.beforeStability} > 0
          AND ${table.beforeStability} < 'Infinity'::double precision
        )`,
    ),
    check(
      'chk_fsrs_review_events_before_difficulty',
      sql`${table.beforeDifficulty} IS NULL
        OR (
          ${table.beforeDifficulty} >= 1
          AND ${table.beforeDifficulty} <= 10
        )`,
    ),
    check(
      'chk_fsrs_review_events_after_stability',
      sql`${table.afterStability} > 0
        AND ${table.afterStability} < 'Infinity'::double precision`,
    ),
    check(
      'chk_fsrs_review_events_after_difficulty',
      sql`${table.afterDifficulty} >= 1
        AND ${table.afterDifficulty} <= 10`,
    ),
    check(
      'chk_fsrs_review_events_non_negative_counters',
      sql`${table.elapsedDays} >= 0
        AND (${table.beforeScheduledDays} IS NULL
          OR ${table.beforeScheduledDays} >= 0)
        AND (${table.beforeLearningSteps} IS NULL
          OR ${table.beforeLearningSteps} >= 0)
        AND ${table.afterScheduledDays} >= 0
        AND ${table.afterLearningSteps} >= 0
        AND ${table.afterReps} >= 1
        AND ${table.afterLapses} >= 0
        AND ${table.afterLapses} <= ${table.afterReps}
        AND ${table.afterStateVersion} >= 1`,
    ),
  ],
);

export const fsrsReviewEventsRelations = relations(
  fsrsReviewEvents,
  ({ one }) => ({
    user: one(users, {
      fields: [fsrsReviewEvents.userId],
      references: [users.id],
    }),
    card: one(cards, {
      fields: [fsrsReviewEvents.cardId],
      references: [cards.id],
    }),
    parameterRevision: one(fsrsParameterRevisions, {
      fields: [fsrsReviewEvents.parameterRevisionId],
      references: [fsrsParameterRevisions.id],
    }),
  }),
);
