-- Add the canonical FSRS-only persistence model as shadow tables so replay can
-- be deployed without changing or deleting any legacy scheduling data.
CREATE TABLE IF NOT EXISTS "fsrs_parameter_revisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "revision" integer NOT NULL,
  "engine_version" varchar(100) NOT NULL,
  "algorithm_version" varchar(100) NOT NULL,
  "policy_version" varchar(100) NOT NULL,
  "parameters" jsonb NOT NULL,
  "params_hash" varchar(64) NOT NULL,
  "source" varchar(20) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "activated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "retired_at" timestamp with time zone,
  CONSTRAINT "fk_fsrs_parameter_revisions_user"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
    ON DELETE CASCADE,
  CONSTRAINT "uq_fsrs_parameter_revisions_user_revision"
    UNIQUE ("user_id", "revision"),
  CONSTRAINT "uq_fsrs_parameter_revisions_resolved_params"
    UNIQUE ("user_id", "engine_version", "policy_version", "params_hash"),
  CONSTRAINT "chk_fsrs_parameter_revisions_revision"
    CHECK ("revision" > 0),
  CONSTRAINT "chk_fsrs_parameter_revisions_params_hash"
    CHECK (length("params_hash") = 64),
  CONSTRAINT "chk_fsrs_parameter_revisions_source"
    CHECK ("source" IN ('default', 'manual', 'optimized', 'migration'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_fsrs_parameter_revisions_active_user"
  ON "fsrs_parameter_revisions" ("user_id")
  WHERE "retired_at" IS NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fsrs_card_states" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "card_id" uuid NOT NULL,
  "next_review_at" timestamp with time zone NOT NULL,
  "last_reviewed_at" timestamp with time zone,
  "stability" double precision NOT NULL,
  "difficulty" double precision NOT NULL,
  "state" varchar(20) NOT NULL,
  "elapsed_days" integer NOT NULL,
  "scheduled_days" integer NOT NULL,
  "learning_steps" integer NOT NULL,
  "reps" integer NOT NULL,
  "lapses" integer NOT NULL,
  "parameter_revision_id" uuid NOT NULL,
  "state_version" bigint NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "fk_fsrs_card_states_user"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
    ON DELETE CASCADE,
  CONSTRAINT "fk_fsrs_card_states_card"
    FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id")
    ON DELETE CASCADE,
  CONSTRAINT "fk_fsrs_card_states_parameter_revision"
    FOREIGN KEY ("parameter_revision_id")
    REFERENCES "public"."fsrs_parameter_revisions"("id")
    ON DELETE NO ACTION,
  CONSTRAINT "uq_fsrs_card_states_user_card"
    UNIQUE ("user_id", "card_id"),
  CONSTRAINT "chk_fsrs_card_states_state"
    CHECK ("state" IN ('learning', 'review', 'relearning')),
  CONSTRAINT "chk_fsrs_card_states_non_negative_counters"
    CHECK (
      "elapsed_days" >= 0
      AND "scheduled_days" >= 0
      AND "learning_steps" >= 0
      AND "reps" >= 0
      AND "lapses" >= 0
    ),
  CONSTRAINT "chk_fsrs_card_states_reps_lapses"
    CHECK ("reps" >= 1 AND "lapses" <= "reps"),
  CONSTRAINT "chk_fsrs_card_states_state_version"
    CHECK ("state_version" >= 1),
  CONSTRAINT "chk_fsrs_card_states_stability"
    CHECK (
      "stability" > 0
      AND "stability" < 'Infinity'::double precision
    ),
  CONSTRAINT "chk_fsrs_card_states_difficulty"
    CHECK ("difficulty" >= 1 AND "difficulty" <= 10)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_fsrs_card_states_due"
  ON "fsrs_card_states" ("user_id", "next_review_at")
  INCLUDE ("card_id", "state");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_fsrs_card_states_card"
  ON "fsrs_card_states" ("card_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_fsrs_card_states_parameter_revision"
  ON "fsrs_card_states" ("parameter_revision_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fsrs_review_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "request_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "card_id" uuid NOT NULL,
  "sequence" integer NOT NULL,
  "rating" varchar(10) NOT NULL,
  "reviewed_at" timestamp with time zone NOT NULL,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  "duration_ms" integer,
  "parameter_revision_id" uuid NOT NULL,
  "origin" varchar(10) NOT NULL,
  "before_state" varchar(20),
  "before_due_at" timestamp with time zone,
  "before_stability" double precision,
  "before_difficulty" double precision,
  "before_scheduled_days" integer,
  "before_learning_steps" integer,
  "elapsed_days" integer NOT NULL,
  "after_state" varchar(20) NOT NULL,
  "after_due_at" timestamp with time zone NOT NULL,
  "after_stability" double precision NOT NULL,
  "after_difficulty" double precision NOT NULL,
  "after_scheduled_days" integer NOT NULL,
  "after_learning_steps" integer NOT NULL,
  "after_reps" integer NOT NULL,
  "after_lapses" integer NOT NULL,
  "after_state_version" bigint NOT NULL,
  CONSTRAINT "fk_fsrs_review_events_user"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
    ON DELETE CASCADE,
  CONSTRAINT "fk_fsrs_review_events_card"
    FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id")
    ON DELETE CASCADE,
  CONSTRAINT "fk_fsrs_review_events_parameter_revision"
    FOREIGN KEY ("parameter_revision_id")
    REFERENCES "public"."fsrs_parameter_revisions"("id")
    ON DELETE NO ACTION,
  CONSTRAINT "uq_fsrs_review_events_user_request"
    UNIQUE ("user_id", "request_id"),
  CONSTRAINT "uq_fsrs_review_events_user_card_sequence"
    UNIQUE ("user_id", "card_id", "sequence"),
  CONSTRAINT "chk_fsrs_review_events_sequence"
    CHECK ("sequence" > 0),
  CONSTRAINT "chk_fsrs_review_events_rating"
    CHECK ("rating" IN ('again', 'hard', 'good', 'easy')),
  CONSTRAINT "chk_fsrs_review_events_origin"
    CHECK ("origin" IN ('live', 'migration')),
  CONSTRAINT "chk_fsrs_review_events_duration"
    CHECK ("duration_ms" IS NULL OR "duration_ms" >= 0),
  CONSTRAINT "chk_fsrs_review_events_before_snapshot"
    CHECK (
      (
        "before_state" IS NULL
        AND "before_due_at" IS NULL
        AND "before_stability" IS NULL
        AND "before_difficulty" IS NULL
        AND "before_scheduled_days" IS NULL
        AND "before_learning_steps" IS NULL
      )
      OR
      (
        "before_state" IS NOT NULL
        AND "before_due_at" IS NOT NULL
        AND "before_stability" IS NOT NULL
        AND "before_difficulty" IS NOT NULL
        AND "before_scheduled_days" IS NOT NULL
        AND "before_learning_steps" IS NOT NULL
      )
    ),
  CONSTRAINT "chk_fsrs_review_events_before_state"
    CHECK (
      "before_state" IS NULL
      OR "before_state" IN ('learning', 'review', 'relearning')
    ),
  CONSTRAINT "chk_fsrs_review_events_after_state"
    CHECK ("after_state" IN ('learning', 'review', 'relearning')),
  CONSTRAINT "chk_fsrs_review_events_before_stability"
    CHECK (
      "before_stability" IS NULL
      OR (
        "before_stability" > 0
        AND "before_stability" < 'Infinity'::double precision
      )
    ),
  CONSTRAINT "chk_fsrs_review_events_before_difficulty"
    CHECK (
      "before_difficulty" IS NULL
      OR ("before_difficulty" >= 1 AND "before_difficulty" <= 10)
    ),
  CONSTRAINT "chk_fsrs_review_events_after_stability"
    CHECK (
      "after_stability" > 0
      AND "after_stability" < 'Infinity'::double precision
    ),
  CONSTRAINT "chk_fsrs_review_events_after_difficulty"
    CHECK ("after_difficulty" >= 1 AND "after_difficulty" <= 10),
  CONSTRAINT "chk_fsrs_review_events_non_negative_counters"
    CHECK (
      "elapsed_days" >= 0
      AND ("before_scheduled_days" IS NULL OR "before_scheduled_days" >= 0)
      AND ("before_learning_steps" IS NULL OR "before_learning_steps" >= 0)
      AND "after_scheduled_days" >= 0
      AND "after_learning_steps" >= 0
      AND "after_reps" >= 1
      AND "after_lapses" >= 0
      AND "after_lapses" <= "after_reps"
      AND "after_state_version" >= 1
    )
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_fsrs_review_events_user_reviewed"
  ON "fsrs_review_events" ("user_id", "reviewed_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_fsrs_review_events_card"
  ON "fsrs_review_events" ("card_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_fsrs_review_events_parameter_revision"
  ON "fsrs_review_events" ("parameter_revision_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fsrs_migration_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "status" varchar(20) NOT NULL,
  "engine_version" varchar(100) NOT NULL,
  "algorithm_version" varchar(100) NOT NULL,
  "policy_version" varchar(100) NOT NULL,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "finished_at" timestamp with time zone,
  "source_counts" jsonb NOT NULL,
  "result_counts" jsonb NOT NULL,
  "anomalies" jsonb NOT NULL,
  "source_checksum" varchar(64),
  "result_checksum" varchar(64),
  "error_message" text,
  CONSTRAINT "chk_fsrs_migration_runs_status"
    CHECK ("status" IN ('running', 'completed', 'failed')),
  CONSTRAINT "chk_fsrs_migration_runs_source_checksum"
    CHECK (
      "source_checksum" IS NULL
      OR length("source_checksum") = 64
    ),
  CONSTRAINT "chk_fsrs_migration_runs_result_checksum"
    CHECK (
      "result_checksum" IS NULL
      OR length("result_checksum") = 64
    )
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_fsrs_migration_runs_status_started"
  ON "fsrs_migration_runs" ("status", "started_at" DESC);
