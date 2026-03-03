-- Migration: 0004_daily_study_logs
-- Adds study_daily_logs table for streak tracking and activity heatmap

CREATE TABLE IF NOT EXISTS "study_daily_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "study_date" date NOT NULL,
  "cards_reviewed" integer NOT NULL DEFAULT 0,
  CONSTRAINT "uq_user_study_date" UNIQUE("user_id", "study_date")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sdl_user_date" ON "study_daily_logs" ("user_id", "study_date");
