-- Email verification support
ALTER TABLE "users" ADD COLUMN "email_verified" boolean NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "email_verification_token" varchar(64);
ALTER TABLE "users" ADD COLUMN "email_token_expires_at" timestamptz;

-- Partial index: only index rows that have a pending verification token
CREATE INDEX "idx_users_verification_token"
  ON "users" ("email_verification_token")
  WHERE "email_verification_token" IS NOT NULL;
