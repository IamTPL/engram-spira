import {
  pgTable,
  uuid,
  varchar,
  integer,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users';
import { cards } from './cards';

/**
 * Immutable review log — one row per card review event.
 * Foundation for FSRS parameter optimization and analytics.
 *
 * Unlike `study_progress` (current state only, upserted),
 * this table accumulates all historical reviews, enabling:
 *   - FSRS `optimizeParameters()` training
 *   - Forgetting curve visualization
 *   - Retention heatmarks & forecast
 */
export const reviewLogs = pgTable(
  'review_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    cardId: uuid('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),

    /** Review action: again | hard | good | easy */
    rating: varchar('rating', { length: 10 }).notNull(),

    /** Card state at time of review: new | learning | review | relearning */
    state: varchar('state', { length: 15 }).notNull().default('new'),

    /** Days since this card was last reviewed (0 for first review) */
    elapsedDays: integer('elapsed_days').notNull().default(0),

    /** The interval (in days) that was scheduled for this review */
    scheduledDays: integer('scheduled_days').notNull().default(0),

    /** Time taken to answer (ms). Null if not tracked by client. */
    reviewDurationMs: integer('review_duration_ms'),

    reviewedAt: timestamp('reviewed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('idx_rl_user_card').on(table.userId, table.cardId),
    index('idx_rl_user_reviewed_at').on(table.userId, table.reviewedAt),
  ],
);

export const reviewLogsRelations = relations(reviewLogs, ({ one }) => ({
  user: one(users, {
    fields: [reviewLogs.userId],
    references: [users.id],
  }),
  card: one(cards, {
    fields: [reviewLogs.cardId],
    references: [cards.id],
  }),
}));
