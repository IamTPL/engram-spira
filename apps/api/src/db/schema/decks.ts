import { pgTable, uuid, varchar, timestamp, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users';
import { folders } from './folders';
import { cardTemplates } from './card-templates';
import { cards } from './cards';

export const decks = pgTable(
  'decks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    folderId: uuid('folder_id')
      .notNull()
      .references(() => folders.id, { onDelete: 'cascade' }),
    cardTemplateId: uuid('card_template_id')
      .notNull()
      .references(() => cardTemplates.id),
    name: varchar('name', { length: 255 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('idx_decks_user_id').on(table.userId),
    index('idx_decks_folder_id').on(table.folderId),
    index('idx_decks_card_template_id').on(table.cardTemplateId),
  ],
);

export const decksRelations = relations(decks, ({ one, many }) => ({
  user: one(users, {
    fields: [decks.userId],
    references: [users.id],
  }),
  folder: one(folders, {
    fields: [decks.folderId],
    references: [folders.id],
  }),
  cardTemplate: one(cardTemplates, {
    fields: [decks.cardTemplateId],
    references: [cardTemplates.id],
  }),
  cards: many(cards),
}));
