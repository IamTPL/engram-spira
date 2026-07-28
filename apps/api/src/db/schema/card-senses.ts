import {
  boolean,
  check,
  index,
  pgTable,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { cards } from './cards';
import { lexicalSenses } from './lexical-senses';

export const cardSenses = pgTable(
  'card_senses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    cardId: uuid('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    senseId: uuid('sense_id')
      .notNull()
      .references(() => lexicalSenses.id, { onDelete: 'cascade' }),
    source: varchar('source', { length: 20 })
      .notNull()
      .default('deterministic'),
    isPrimary: boolean('is_primary').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('uq_card_senses_card_sense').on(table.cardId, table.senseId),
    uniqueIndex('uq_card_senses_primary_card')
      .on(table.cardId)
      .where(sql`${table.isPrimary} = true`),
    index('idx_card_senses_sense').on(table.senseId),
    check(
      'chk_card_senses_source',
      sql`${table.source} IN ('deterministic', 'manual', 'ai')`,
    ),
  ],
);

export const cardSensesRelations = relations(cardSenses, ({ one }) => ({
  card: one(cards, {
    fields: [cardSenses.cardId],
    references: [cards.id],
  }),
  sense: one(lexicalSenses, {
    fields: [cardSenses.senseId],
    references: [lexicalSenses.id],
  }),
}));
