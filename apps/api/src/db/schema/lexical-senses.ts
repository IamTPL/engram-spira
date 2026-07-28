import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { lexemes } from './lexemes';
import { cardSenses } from './card-senses';
import { senseRelations } from './sense-relations';
import { kgRuns } from './kg-runs';
import { kgRelationSuggestions } from './kg-relation-suggestions';

export const lexicalSenses = pgTable(
  'lexical_senses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    lexemeId: uuid('lexeme_id')
      .notNull()
      .references(() => lexemes.id, { onDelete: 'cascade' }),
    partOfSpeech: varchar('part_of_speech', { length: 50 }).notNull(),
    definitionLanguageTag: varchar('definition_language_tag', {
      length: 35,
    }).notNull(),
    definition: text('definition').notNull(),
    normalizedDefinition: text('normalized_definition').notNull(),
    ipa: text('ipa'),
    examples: jsonb('examples')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('uq_lexical_sense_identity').on(
      table.lexemeId,
      table.partOfSpeech,
      table.definitionLanguageTag,
      table.normalizedDefinition,
    ),
    index('idx_lexical_senses_lexeme').on(table.lexemeId),
  ],
);

export const lexicalSensesRelations = relations(
  lexicalSenses,
  ({ one, many }) => ({
    lexeme: one(lexemes, {
      fields: [lexicalSenses.lexemeId],
      references: [lexemes.id],
    }),
    cardSenses: many(cardSenses),
    outgoingRelations: many(senseRelations, {
      relationName: 'senseRelationSource',
    }),
    incomingRelations: many(senseRelations, {
      relationName: 'senseRelationTarget',
    }),
    focusedRuns: many(kgRuns),
    sourceSuggestions: many(kgRelationSuggestions, {
      relationName: 'suggestionSourceSense',
    }),
    targetSuggestions: many(kgRelationSuggestions, {
      relationName: 'suggestionTargetSense',
    }),
  }),
);
