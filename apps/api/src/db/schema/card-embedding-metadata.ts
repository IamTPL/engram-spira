import {
  check,
  integer,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { cards } from './cards';

export const cardEmbeddingMetadata = pgTable(
  'card_embedding_metadata',
  {
    cardId: uuid('card_id')
      .primaryKey()
      .references(() => cards.id, { onDelete: 'cascade' }),
    model: varchar('model', { length: 100 }).notNull(),
    dimensions: integer('dimensions').notNull(),
    representationVersion: varchar('representation_version', {
      length: 20,
    }).notNull(),
    contentHash: varchar('content_hash', { length: 64 }).notNull(),
    embeddedAt: timestamp('embedded_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'chk_card_embedding_metadata_dimensions',
      sql`${table.dimensions} = 768`,
    ),
  ],
);

export const cardEmbeddingMetadataRelations = relations(
  cardEmbeddingMetadata,
  ({ one }) => ({
    card: one(cards, {
      fields: [cardEmbeddingMetadata.cardId],
      references: [cards.id],
    }),
  }),
);
