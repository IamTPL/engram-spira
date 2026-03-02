import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  jsonb,
  timestamp,
  index,
  unique,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users';
import { decks } from './decks';

export const cardTemplates = pgTable(
  'card_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    isSystem: boolean('is_system').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('idx_card_templates_user_id').on(table.userId),
    index('idx_card_templates_is_system').on(table.isSystem),
  ],
);

export const cardTemplatesRelations = relations(
  cardTemplates,
  ({ one, many }) => ({
    user: one(users, {
      fields: [cardTemplates.userId],
      references: [users.id],
    }),
    fields: many(templateFields),
    decks: many(decks),
  }),
);

export const templateFields = pgTable(
  'template_fields',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    templateId: uuid('template_id')
      .notNull()
      .references(() => cardTemplates.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 100 }).notNull(),
    fieldType: varchar('field_type', { length: 50 }).notNull(),
    side: varchar('side', { length: 10 }).notNull(),
    sortOrder: integer('sort_order').notNull(),
    isRequired: boolean('is_required').notNull().default(false),
    config: jsonb('config'),
  },
  (table) => [
    index('idx_template_fields_template_id').on(table.templateId),
    unique('uq_template_field_name').on(table.templateId, table.name),
  ],
);

export const templateFieldsRelations = relations(templateFields, ({ one }) => ({
  template: one(cardTemplates, {
    fields: [templateFields.templateId],
    references: [cardTemplates.id],
  }),
}));
