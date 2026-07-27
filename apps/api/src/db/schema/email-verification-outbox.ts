import {
  pgTable,
  uuid,
  varchar,
  integer,
  text,
  timestamp,
  index,
  unique,
  check,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { users } from './users';

/**
 * Durable delivery state for the latest verification email requested by a user.
 * tokenVersion is used for compare-and-set updates so an older worker cannot
 * overwrite a newer resend request.
 */
export const emailVerificationOutbox = pgTable(
  'email_verification_outbox',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenVersion: integer('token_version').notNull(),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    attemptCount: integer('attempt_count').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lockedBy: uuid('locked_by'),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
    lastErrorCode: varchar('last_error_code', { length: 100 }),
    lastError: text('last_error'),
    messageId: text('message_id'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    requestedAt: timestamp('requested_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('uq_evo_user').on(table.userId),
    index('idx_evo_ready')
      .on(table.nextAttemptAt, table.requestedAt)
      .where(sql`${table.status} = 'pending'`),
    index('idx_evo_processing_lease')
      .on(table.lockedUntil)
      .where(sql`${table.status} = 'processing'`),
    check(
      'chk_evo_status',
      sql`${table.status} IN ('pending', 'processing', 'sent', 'failed', 'cancelled')`,
    ),
    check('chk_evo_attempt_count', sql`${table.attemptCount} >= 0`),
    check('chk_evo_max_attempts', sql`${table.maxAttempts} > 0`),
  ],
);

export const emailVerificationOutboxRelations = relations(
  emailVerificationOutbox,
  ({ one }) => ({
    user: one(users, {
      fields: [emailVerificationOutbox.userId],
      references: [users.id],
    }),
  }),
);
