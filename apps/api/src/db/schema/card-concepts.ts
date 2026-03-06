import { pgTable, uuid, varchar, timestamp, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { cards } from './cards';

/**
 * Card Concepts — extracted concepts/tags for each card.
 * The embedding vector (768d) is managed via raw SQL (pgvector).
 */
export const cardConcepts = pgTable(
  'card_concepts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    cardId: uuid('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    concept: varchar('concept', { length: 255 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('idx_card_concepts_card_id').on(table.cardId),
    index('idx_card_concepts_concept').on(table.concept),
  ],
);

export const cardConceptsRelations = relations(cardConcepts, ({ one }) => ({
  card: one(cards, {
    fields: [cardConcepts.cardId],
    references: [cards.id],
  }),
}));
