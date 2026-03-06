import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  index,
  unique,
  check,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { cards } from './cards';

/**
 * Card Links — prerequisite / related relationships between cards.
 * link_type: 'prerequisite' (source must be mastered before target)
 *            'related' (bidirectional, informational)
 */
export const cardLinks = pgTable(
  'card_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceCardId: uuid('source_card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    targetCardId: uuid('target_card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    linkType: varchar('link_type', { length: 20 }).notNull().default('related'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('uq_card_link').on(table.sourceCardId, table.targetCardId),
    index('idx_card_links_source').on(table.sourceCardId),
    index('idx_card_links_target').on(table.targetCardId),
    check(
      'chk_no_self_link',
      sql`${table.sourceCardId} != ${table.targetCardId}`,
    ),
  ],
);

export const cardLinksRelations = relations(cardLinks, ({ one }) => ({
  sourceCard: one(cards, {
    fields: [cardLinks.sourceCardId],
    references: [cards.id],
    relationName: 'outgoingLinks',
  }),
  targetCard: one(cards, {
    fields: [cardLinks.targetCardId],
    references: [cards.id],
    relationName: 'incomingLinks',
  }),
}));
