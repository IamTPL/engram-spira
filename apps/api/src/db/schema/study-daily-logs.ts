import {
  pgTable,
  uuid,
  date,
  integer,
  index,
  unique,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users';

/**
 * One row per user per calendar day.
 * Upserted on every review action so we can compute streaks and heatmaps
 * without scanning the entire study_progress table.
 */
export const studyDailyLogs = pgTable(
  'study_daily_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Date-only column (no time) so grouping by day is trivial
    studyDate: date('study_date').notNull(),
    cardsReviewed: integer('cards_reviewed').notNull().default(0),
  },
  (table) => [unique('uq_user_study_date').on(table.userId, table.studyDate)],
);

export const studyDailyLogsRelations = relations(studyDailyLogs, ({ one }) => ({
  user: one(users, {
    fields: [studyDailyLogs.userId],
    references: [users.id],
  }),
}));
