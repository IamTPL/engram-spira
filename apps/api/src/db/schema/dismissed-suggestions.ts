import {
  pgTable,
  uuid,
  timestamp,
  unique,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users';
import { cards } from './cards';

/**
 * Dismissed Suggestions — track user dismissals so AI suggestions don't reappear.
 */
export const dismissedSuggestions = pgTable(
  'dismissed_suggestions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sourceCardId: uuid('source_card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    targetCardId: uuid('target_card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('uq_dismissed_user_pair').on(
      table.userId,
      table.sourceCardId,
      table.targetCardId,
    ),
    index('idx_dismissed_suggestions_user').on(table.userId),
  ],
);

export const dismissedSuggestionsRelations = relations(
  dismissedSuggestions,
  ({ one }) => ({
    user: one(users, {
      fields: [dismissedSuggestions.userId],
      references: [users.id],
    }),
    sourceCard: one(cards, {
      fields: [dismissedSuggestions.sourceCardId],
      references: [cards.id],
    }),
    targetCard: one(cards, {
      fields: [dismissedSuggestions.targetCardId],
      references: [cards.id],
    }),
  }),
);
