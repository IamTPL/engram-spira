import {
  pgTable,
  uuid,
  integer,
  timestamp,
  index,
  jsonb,
  unique,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { decks } from './decks';
import { templateFields } from './card-templates';
import { studyProgress } from './study-progress';
import { cardSenses } from './card-senses';
import { kgRelationSuggestions } from './kg-relation-suggestions';
import { cardEmbeddingMetadata } from './card-embedding-metadata';

export const cards = pgTable(
  'cards',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    deckId: uuid('deck_id')
      .notNull()
      .references(() => decks.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('idx_cards_deck_id').on(table.deckId),
    index('idx_cards_deck_sort_order').on(table.deckId, table.sortOrder),
  ],
);

export const cardsRelations = relations(cards, ({ one, many }) => ({
  deck: one(decks, {
    fields: [cards.deckId],
    references: [decks.id],
  }),
  fieldValues: many(cardFieldValues),
  studyProgress: many(studyProgress),
  senses: many(cardSenses),
  sourceSuggestions: many(kgRelationSuggestions, {
    relationName: 'suggestionSourceCard',
  }),
  targetSuggestions: many(kgRelationSuggestions, {
    relationName: 'suggestionTargetCard',
  }),
  embeddingMetadata: one(cardEmbeddingMetadata),
}));

export const cardFieldValues = pgTable(
  'card_field_values',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    cardId: uuid('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    templateFieldId: uuid('template_field_id')
      .notNull()
      .references(() => templateFields.id, { onDelete: 'cascade' }),
    value: jsonb('value').notNull(),
  },
  (table) => [
    index('idx_cfv_card_id').on(table.cardId),
    unique('uq_card_field_value').on(table.cardId, table.templateFieldId),
  ],
);

export const cardFieldValuesRelations = relations(
  cardFieldValues,
  ({ one }) => ({
    card: one(cards, {
      fields: [cardFieldValues.cardId],
      references: [cards.id],
    }),
    templateField: one(templateFields, {
      fields: [cardFieldValues.templateFieldId],
      references: [templateFields.id],
    }),
  }),
);
