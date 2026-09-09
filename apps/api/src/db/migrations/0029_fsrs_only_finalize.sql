-- 0029_fsrs_only_finalize.sql
-- The canonical FSRS model is the only scheduler. Drop the SM-2/legacy tables
-- (their history was replayed into fsrs_review_events / fsrs_card_states) and
-- the per-user algorithm switch. Idempotent; safe against a fresh database.

DROP TABLE IF EXISTS "study_progress" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "review_logs" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "fsrs_user_params" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "fsrs_migration_runs" CASCADE;
--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "srs_algorithm";
