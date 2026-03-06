ALTER TABLE "classes" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "folders" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;