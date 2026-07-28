import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  timestamp,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { sessions } from './sessions';
import { classes } from './classes';
import { cardTemplates } from './card-templates';
import { studyProgress } from './study-progress';
import { emailVerificationOutbox } from './email-verification-outbox';
import { lexemes } from './lexemes';
import { senseRelations } from './sense-relations';
import { kgRuns } from './kg-runs';
import { kgRelationSuggestions } from './kg-relation-suggestions';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  displayName: varchar('display_name', { length: 50 }),
  avatarUrl: text('avatar_url'),
  srsAlgorithm: varchar('srs_algorithm', { length: 10 })
    .notNull()
    .default('sm2'),
  emailVerified: boolean('email_verified').notNull().default(false),
  emailVerificationToken: varchar('email_verification_token', { length: 64 }),
  emailTokenExpiresAt: timestamp('email_token_expires_at', {
    withTimezone: true,
  }),
  emailVerificationVersion: integer('email_verification_version')
    .notNull()
    .default(0),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const usersRelations = relations(users, ({ one, many }) => ({
  sessions: many(sessions),
  classes: many(classes),
  cardTemplates: many(cardTemplates),
  studyProgress: many(studyProgress),
  emailVerificationOutbox: one(emailVerificationOutbox),
  lexemes: many(lexemes),
  senseRelations: many(senseRelations),
  kgRuns: many(kgRuns),
  kgRelationSuggestions: many(kgRelationSuggestions),
}));
