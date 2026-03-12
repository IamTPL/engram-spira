ALTER TABLE "ai_generation_jobs" ALTER COLUMN "status" SET DEFAULT 'processing';--> statement-breakpoint
ALTER TABLE "ai_generation_jobs" ADD COLUMN IF NOT EXISTS "error_message" text;