import {
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users';
import { lexicalSenses } from './lexical-senses';

export const lexemes = pgTable(
  'lexemes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    languageTag: varchar('language_tag', { length: 35 }).notNull(),
    lemma: text('lemma').notNull(),
    normalizedLemma: text('normalized_lemma').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('uq_lexemes_user_language_lemma').on(
      table.userId,
      table.languageTag,
      table.normalizedLemma,
    ),
    index('idx_lexemes_user').on(table.userId),
  ],
);

export const lexemesRelations = relations(lexemes, ({ one, many }) => ({
  user: one(users, {
    fields: [lexemes.userId],
    references: [users.id],
  }),
  senses: many(lexicalSenses),
}));
