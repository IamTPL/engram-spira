-- Add FSRS support: new columns on study_progress + users, new fsrs_user_params table
-- All new columns are nullable / have defaults so existing SM-2 rows are unaffected.

-- 1. FSRS per-card state columns on study_progress
ALTER TABLE "study_progress"
  ADD COLUMN IF NOT EXISTS "stability" real,
  ADD COLUMN IF NOT EXISTS "difficulty" real,
  ADD COLUMN IF NOT EXISTS "fsrs_state" varchar(15) DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS "last_elapsed_days" real DEFAULT 0;

-- 2. User-level algorithm preference on users
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "srs_algorithm" varchar(10) NOT NULL DEFAULT 'sm2';

-- 3. Per-user FSRS parameter overrides table
CREATE TABLE IF NOT EXISTS "fsrs_user_params" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "params" jsonb NOT NULL DEFAULT '{}',
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "uq_fsrs_user_params_user" UNIQUE ("user_id")
);
