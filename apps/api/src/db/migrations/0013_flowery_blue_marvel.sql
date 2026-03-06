DROP TABLE "fsrs_user_params" CASCADE;--> statement-breakpoint
ALTER TABLE "study_progress" DROP COLUMN "stability";--> statement-breakpoint
ALTER TABLE "study_progress" DROP COLUMN "difficulty";--> statement-breakpoint
ALTER TABLE "study_progress" DROP COLUMN "fsrs_state";--> statement-breakpoint
ALTER TABLE "study_progress" DROP COLUMN "last_elapsed_days";