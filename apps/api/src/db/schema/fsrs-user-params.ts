import { pgTable, uuid, jsonb, timestamp, unique } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users';

export const fsrsUserParams = pgTable(
  'fsrs_user_params',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    params: jsonb('params').notNull().default({}),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [unique('uq_fsrs_user_params_user').on(table.userId)],
);

export const fsrsUserParamsRelations = relations(fsrsUserParams, ({ one }) => ({
  user: one(users, { fields: [fsrsUserParams.userId], references: [users.id] }),
}));
