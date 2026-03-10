ALTER TABLE "classes" ADD COLUMN IF NOT EXISTS "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "folders" ADD COLUMN IF NOT EXISTS "sort_order" integer DEFAULT 0 NOT NULL;