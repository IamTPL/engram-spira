import {
  pgTable,
  uuid,
  varchar,
  text,
  jsonb,
  integer,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users';
import { decks } from './decks';

/**
 * Tracks AI card generation jobs — allows preview → confirm workflow
 * and provides audit trail of AI usage.
 * TTL: rows older than 24h with status 'pending' should be cleaned up.
 */
export const aiGenerationJobs = pgTable(
  'ai_generation_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deckId: uuid('deck_id')
      .notNull()
      .references(() => decks.id, { onDelete: 'cascade' }),
    /** 'processing' | 'pending' | 'failed' | 'saved' | 'expired' */
    status: varchar('status', { length: 20 }).notNull().default('processing'),
    /** Error message if status='failed' */
    errorMessage: text('error_message'),
    /** User-provided source text or topic */
    sourceText: text('source_text').notNull(),
    /** Number of cards requested */
    cardCount: integer('card_count').notNull(),
    /** The generated cards (array of {front, back, ...} objects) */
    generatedCards: jsonb('generated_cards'),
    /** Gemini model used */
    model: varchar('model', { length: 50 }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('idx_ai_jobs_user_id').on(table.userId),
    index('idx_ai_jobs_status_created').on(table.status, table.createdAt),
  ],
);

export const aiGenerationJobsRelations = relations(
  aiGenerationJobs,
  ({ one }) => ({
    user: one(users, {
      fields: [aiGenerationJobs.userId],
      references: [users.id],
    }),
    deck: one(decks, {
      fields: [aiGenerationJobs.deckId],
      references: [decks.id],
    }),
  }),
);
