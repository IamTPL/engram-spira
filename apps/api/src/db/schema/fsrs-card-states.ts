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

export const fsrsCardStates = pgTable(
  'fsrs_card_states',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    cardId: uuid('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    nextReviewAt: timestamp('next_review_at', { withTimezone: true }).notNull(),
    lastReviewedAt: timestamp('last_reviewed_at', { withTimezone: true }),
    stability: doublePrecision('stability').notNull(),
    difficulty: doublePrecision('difficulty').notNull(),
    state: varchar('state', { length: 20 }).notNull(),
    elapsedDays: integer('elapsed_days').notNull(),
    scheduledDays: integer('scheduled_days').notNull(),
    learningSteps: integer('learning_steps').notNull(),
    reps: integer('reps').notNull(),
    lapses: integer('lapses').notNull(),
    parameterRevisionId: uuid('parameter_revision_id')
      .notNull()
      .references(() => fsrsParameterRevisions.id),
    stateVersion: bigint('state_version', { mode: 'number' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('uq_fsrs_card_states_user_card').on(table.userId, table.cardId),
    index('idx_fsrs_card_states_due').on(table.userId, table.nextReviewAt),
    index('idx_fsrs_card_states_card').on(table.cardId),
    index('idx_fsrs_card_states_parameter_revision').on(
      table.parameterRevisionId,
    ),
    check(
      'chk_fsrs_card_states_state',
      sql`${table.state} IN ('learning', 'review', 'relearning')`,
    ),
    check(
      'chk_fsrs_card_states_non_negative_counters',
      sql`${table.elapsedDays} >= 0
        AND ${table.scheduledDays} >= 0
        AND ${table.learningSteps} >= 0
        AND ${table.reps} >= 0
        AND ${table.lapses} >= 0`,
    ),
    check(
      'chk_fsrs_card_states_reps_lapses',
      sql`${table.reps} >= 1 AND ${table.lapses} <= ${table.reps}`,
    ),
    check(
      'chk_fsrs_card_states_state_version',
      sql`${table.stateVersion} >= 1`,
    ),
    check(
      'chk_fsrs_card_states_stability',
      sql`${table.stability} > 0
        AND ${table.stability} < 'Infinity'::double precision`,
    ),
    check(
      'chk_fsrs_card_states_difficulty',
      sql`${table.difficulty} >= 1
        AND ${table.difficulty} <= 10`,
    ),
  ],
);

export const fsrsCardStatesRelations = relations(
  fsrsCardStates,
  ({ one }) => ({
    user: one(users, {
      fields: [fsrsCardStates.userId],
      references: [users.id],
    }),
    card: one(cards, {
      fields: [fsrsCardStates.cardId],
      references: [cards.id],
    }),
    parameterRevision: one(fsrsParameterRevisions, {
      fields: [fsrsCardStates.parameterRevisionId],
      references: [fsrsParameterRevisions.id],
    }),
  }),
);
