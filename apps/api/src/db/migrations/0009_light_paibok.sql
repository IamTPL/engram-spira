CREATE TABLE "fsrs_user_params" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"weights" jsonb,
	"desired_retention" double precision DEFAULT 0.9 NOT NULL,
	"maximum_interval" integer DEFAULT 36500 NOT NULL,
	"trained_at" timestamp with time zone,
	"review_count_used" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_fsrs_user" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "study_progress" ADD COLUMN "stability" double precision;--> statement-breakpoint
ALTER TABLE "study_progress" ADD COLUMN "difficulty" double precision;--> statement-breakpoint
ALTER TABLE "study_progress" ADD COLUMN "fsrs_state" varchar(15);--> statement-breakpoint
ALTER TABLE "study_progress" ADD COLUMN "last_elapsed_days" double precision;--> statement-breakpoint
ALTER TABLE "fsrs_user_params" ADD CONSTRAINT "fsrs_user_params_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;