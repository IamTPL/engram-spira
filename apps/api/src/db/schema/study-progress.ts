import {
  pgTable,
  uuid,
  integer,
  doublePrecision,
  timestamp,
  index,
  unique,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users';
import { cards } from './cards';

export const studyProgress = pgTable(
  'study_progress',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    cardId: uuid('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    // SM-2 fields
    boxLevel: integer('box_level').notNull().default(0), // repetitions count
    easeFactor: doublePrecision('ease_factor').notNull().default(2.5), // interval multiplier
    intervalDays: integer('interval_days').notNull().default(1), // days until next review
    nextReviewAt: timestamp('next_review_at', { withTimezone: true }).notNull(),
    lastReviewedAt: timestamp('last_reviewed_at', { withTimezone: true }),
  },
  (table) => [
    unique('uq_user_card_progress').on(table.userId, table.cardId),
    index('idx_sp_user_next_review').on(table.userId, table.nextReviewAt),
  ],
);

export const studyProgressRelations = relations(studyProgress, ({ one }) => ({
  user: one(users, {
    fields: [studyProgress.userId],
    references: [users.id],
  }),
  card: one(cards, {
    fields: [studyProgress.cardId],
    references: [cards.id],
  }),
}));
