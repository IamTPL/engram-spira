-- Queue verification emails durably so delivery can retry after SMTP or process
-- failures without an older worker overwriting a newer resend request.
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "email_verification_version" integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "email_verification_outbox" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "token_version" integer NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'pending',
  "attempt_count" integer NOT NULL DEFAULT 0,
  "max_attempts" integer NOT NULL DEFAULT 5,
  "next_attempt_at" timestamptz NOT NULL DEFAULT now(),
  "locked_by" uuid,
  "locked_until" timestamptz,
  "last_attempt_at" timestamptz,
  "last_error_code" varchar(100),
  "last_error" text,
  "message_id" text,
  "sent_at" timestamptz,
  "failed_at" timestamptz,
  "cancelled_at" timestamptz,
  "requested_at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "email_verification_outbox_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "uq_evo_user" UNIQUE ("user_id"),
  CONSTRAINT "chk_evo_status"
    CHECK ("status" IN ('pending', 'processing', 'sent', 'failed', 'cancelled')),
  CONSTRAINT "chk_evo_attempt_count" CHECK ("attempt_count" >= 0),
  CONSTRAINT "chk_evo_max_attempts" CHECK ("max_attempts" > 0)
);

-- Worker hot path: claim ready pending rows ordered by schedule/request time.
CREATE INDEX IF NOT EXISTS "idx_evo_ready"
  ON "email_verification_outbox" ("next_attempt_at", "requested_at")
  WHERE "status" = 'pending';

-- Crash recovery hot path: reclaim processing rows whose lease has expired.
CREATE INDEX IF NOT EXISTS "idx_evo_processing_lease"
  ON "email_verification_outbox" ("locked_until")
  WHERE "status" = 'processing';
