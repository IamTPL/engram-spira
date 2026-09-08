-- Harden the shadow FSRS model introduced by the immutable 0026 migration.
-- This migration is intentionally additive/replacement-only for FSRS tables;
-- all legacy scheduling tables remain untouched during the shadow rollout.

-- Parameter revisions need a composite identity before state/event ownership
-- can be enforced by composite foreign keys.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.fsrs_parameter_revisions'::regclass
      AND conname = 'uq_fsrs_parameter_revisions_id_user'
  ) THEN
    ALTER TABLE "fsrs_parameter_revisions"
      ADD CONSTRAINT "uq_fsrs_parameter_revisions_id_user"
      UNIQUE ("id", "user_id");
  END IF;
END
$$;
--> statement-breakpoint
ALTER TABLE "fsrs_parameter_revisions"
  DROP CONSTRAINT IF EXISTS "uq_fsrs_parameter_revisions_resolved_params";
--> statement-breakpoint
ALTER TABLE "fsrs_parameter_revisions"
  ADD CONSTRAINT "uq_fsrs_parameter_revisions_resolved_params"
  UNIQUE (
    "user_id",
    "engine_version",
    "algorithm_version",
    "policy_version",
    "params_hash"
  );
--> statement-breakpoint
ALTER TABLE "fsrs_parameter_revisions"
  DROP CONSTRAINT IF EXISTS "chk_fsrs_parameter_revisions_params_hash";
--> statement-breakpoint
ALTER TABLE "fsrs_parameter_revisions"
  ADD CONSTRAINT "chk_fsrs_parameter_revisions_params_hash"
  CHECK ("params_hash" ~ '^[0-9a-f]{64}$');
--> statement-breakpoint
ALTER TABLE "fsrs_parameter_revisions"
  DROP CONSTRAINT IF EXISTS "chk_fsrs_parameter_revisions_parameters";
--> statement-breakpoint
ALTER TABLE "fsrs_parameter_revisions"
  ADD CONSTRAINT "chk_fsrs_parameter_revisions_parameters"
  CHECK (jsonb_typeof("parameters") = 'object');
--> statement-breakpoint
ALTER TABLE "fsrs_parameter_revisions"
  DROP CONSTRAINT IF EXISTS "chk_fsrs_parameter_revisions_timestamps";
--> statement-breakpoint
ALTER TABLE "fsrs_parameter_revisions"
  ADD CONSTRAINT "chk_fsrs_parameter_revisions_timestamps"
  CHECK (
    "created_at" <= "activated_at"
    AND ("retired_at" IS NULL OR "activated_at" <= "retired_at")
  );
--> statement-breakpoint

-- Persisted card state is always non-New. Absence of a row is the only New
-- representation, so a persisted state must have a real last review time.
ALTER TABLE "fsrs_card_states"
  ADD COLUMN IF NOT EXISTS "learning_cycle" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "fsrs_card_states"
    WHERE "last_reviewed_at" IS NULL
  ) THEN
    RAISE EXCEPTION
      'Cannot harden fsrs_card_states.last_reviewed_at: NULL rows exist';
  END IF;
END
$$;
--> statement-breakpoint
ALTER TABLE "fsrs_card_states"
  ALTER COLUMN "last_reviewed_at" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "fsrs_card_states"
  DROP CONSTRAINT IF EXISTS "chk_fsrs_card_states_state_projection";
--> statement-breakpoint
ALTER TABLE "fsrs_card_states"
  ADD CONSTRAINT "chk_fsrs_card_states_state_projection"
  CHECK ("reps" = "state_version");
--> statement-breakpoint
ALTER TABLE "fsrs_card_states"
  DROP CONSTRAINT IF EXISTS "chk_fsrs_card_states_learning_cycle";
--> statement-breakpoint
ALTER TABLE "fsrs_card_states"
  ADD CONSTRAINT "chk_fsrs_card_states_learning_cycle"
  CHECK ("learning_cycle" > 0);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.fsrs_card_states'::regclass
      AND conname = 'fk_fsrs_card_states_parameter_revision_user'
  ) THEN
    ALTER TABLE "fsrs_card_states"
      ADD CONSTRAINT "fk_fsrs_card_states_parameter_revision_user"
      FOREIGN KEY ("parameter_revision_id", "user_id")
      REFERENCES "public"."fsrs_parameter_revisions"("id", "user_id")
      ON DELETE NO ACTION;
  END IF;
END
$$;
--> statement-breakpoint
ALTER TABLE "fsrs_card_states"
  DROP CONSTRAINT IF EXISTS "fk_fsrs_card_states_parameter_revision";
--> statement-breakpoint
DROP INDEX IF EXISTS "idx_fsrs_card_states_parameter_revision";
--> statement-breakpoint
CREATE INDEX "idx_fsrs_card_states_parameter_revision"
  ON "fsrs_card_states" ("parameter_revision_id", "user_id");
--> statement-breakpoint

-- Learning cycles preserve immutable prior history while allowing a reset to
-- start a new per-card sequence at one.
ALTER TABLE "fsrs_review_events"
  ADD COLUMN IF NOT EXISTS "learning_cycle" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "fsrs_review_events"
  DROP CONSTRAINT IF EXISTS "chk_fsrs_review_events_learning_cycle";
--> statement-breakpoint
ALTER TABLE "fsrs_review_events"
  ADD CONSTRAINT "chk_fsrs_review_events_learning_cycle"
  CHECK ("learning_cycle" > 0);
--> statement-breakpoint
ALTER TABLE "fsrs_review_events"
  DROP CONSTRAINT IF EXISTS "chk_fsrs_review_events_sequence_projection";
--> statement-breakpoint
ALTER TABLE "fsrs_review_events"
  ADD CONSTRAINT "chk_fsrs_review_events_sequence_projection"
  CHECK (
    "after_state_version" = "sequence"
    AND "after_reps" = "sequence"
  );
--> statement-breakpoint
ALTER TABLE "fsrs_review_events"
  DROP CONSTRAINT IF EXISTS "chk_fsrs_review_events_sequence_snapshot";
--> statement-breakpoint
ALTER TABLE "fsrs_review_events"
  ADD CONSTRAINT "chk_fsrs_review_events_sequence_snapshot"
  CHECK (
    ("sequence" = 1 AND "before_state" IS NULL)
    OR ("sequence" > 1 AND "before_state" IS NOT NULL)
  );
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.fsrs_review_events'::regclass
      AND conname = 'fk_fsrs_review_events_parameter_revision_user'
  ) THEN
    ALTER TABLE "fsrs_review_events"
      ADD CONSTRAINT "fk_fsrs_review_events_parameter_revision_user"
      FOREIGN KEY ("parameter_revision_id", "user_id")
      REFERENCES "public"."fsrs_parameter_revisions"("id", "user_id")
      ON DELETE NO ACTION;
  END IF;
END
$$;
--> statement-breakpoint
ALTER TABLE "fsrs_review_events"
  DROP CONSTRAINT IF EXISTS "fk_fsrs_review_events_parameter_revision";
--> statement-breakpoint
ALTER TABLE "fsrs_review_events"
  DROP CONSTRAINT IF EXISTS "uq_fsrs_review_events_user_card_sequence";
--> statement-breakpoint
ALTER TABLE "fsrs_review_events"
  DROP CONSTRAINT IF EXISTS "uq_fsrs_review_events_user_card_cycle_sequence";
--> statement-breakpoint
ALTER TABLE "fsrs_review_events"
  ADD CONSTRAINT "uq_fsrs_review_events_user_card_cycle_sequence"
  UNIQUE ("user_id", "card_id", "learning_cycle", "sequence");
--> statement-breakpoint
DROP INDEX IF EXISTS "idx_fsrs_review_events_parameter_revision";
--> statement-breakpoint
CREATE INDEX "idx_fsrs_review_events_parameter_revision"
  ON "fsrs_review_events" ("parameter_revision_id", "user_id");
--> statement-breakpoint

-- Prevent writes while validating existing ownership and installing both
-- directions of the invariant. Locks are transaction-held by the migrator.
LOCK TABLE
  "cards",
  "decks",
  "fsrs_card_states",
  "fsrs_review_events"
IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
DO $$
DECLARE
  mismatched_card_id uuid;
  mismatched_user_id uuid;
BEGIN
  SELECT state."card_id", state."user_id"
  INTO mismatched_card_id, mismatched_user_id
  FROM "fsrs_card_states" state
  INNER JOIN "cards" card ON card."id" = state."card_id"
  INNER JOIN "decks" deck ON deck."id" = card."deck_id"
  WHERE state."user_id" IS DISTINCT FROM deck."user_id"
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'Cannot install FSRS ownership guards: card state ownership mismatch for card % and user %',
      mismatched_card_id,
      mismatched_user_id
      USING
        ERRCODE = '23503',
        CONSTRAINT = 'fk_fsrs_card_states_card_owner',
        TABLE = 'fsrs_card_states',
        SCHEMA = 'public';
  END IF;

  SELECT event."card_id", event."user_id"
  INTO mismatched_card_id, mismatched_user_id
  FROM "fsrs_review_events" event
  INNER JOIN "cards" card ON card."id" = event."card_id"
  INNER JOIN "decks" deck ON deck."id" = card."deck_id"
  WHERE event."user_id" IS DISTINCT FROM deck."user_id"
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'Cannot install FSRS ownership guards: review event ownership mismatch for card % and user %',
      mismatched_card_id,
      mismatched_user_id
      USING
        ERRCODE = '23503',
        CONSTRAINT = 'fk_fsrs_review_events_card_owner',
        TABLE = 'fsrs_review_events',
        SCHEMA = 'public';
  END IF;
END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "enforce_fsrs_card_owner"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  actual_deck_id uuid;
  actual_user_id uuid;
BEGIN
  SELECT card."deck_id"
  INTO actual_deck_id
  FROM "cards" card
  WHERE card."id" = NEW."card_id"
  FOR SHARE;

  IF actual_deck_id IS NOT NULL THEN
    SELECT deck."user_id"
    INTO actual_user_id
    FROM "decks" deck
    WHERE deck."id" = actual_deck_id
    FOR SHARE;
  END IF;

  IF actual_user_id IS NULL
    OR actual_user_id IS DISTINCT FROM NEW."user_id"
  THEN
    RAISE EXCEPTION
      'FSRS card ownership mismatch for card % and user %',
      NEW."card_id",
      NEW."user_id"
      USING
        ERRCODE = '23503',
        CONSTRAINT = TG_ARGV[0],
        TABLE = TG_TABLE_NAME,
        SCHEMA = TG_TABLE_SCHEMA;
  END IF;

  RETURN NEW;
END
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_fsrs_card_states_card_owner"
  ON "fsrs_card_states";
--> statement-breakpoint
CREATE TRIGGER "trg_fsrs_card_states_card_owner"
  BEFORE INSERT OR UPDATE OF "user_id", "card_id"
  ON "fsrs_card_states"
  FOR EACH ROW
  EXECUTE FUNCTION "enforce_fsrs_card_owner"(
    'fk_fsrs_card_states_card_owner'
  );
--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_fsrs_review_events_card_owner"
  ON "fsrs_review_events";
--> statement-breakpoint
CREATE TRIGGER "trg_fsrs_review_events_card_owner"
  BEFORE INSERT OR UPDATE OF "user_id", "card_id"
  ON "fsrs_review_events"
  FOR EACH ROW
  EXECUTE FUNCTION "enforce_fsrs_card_owner"(
    'fk_fsrs_review_events_card_owner'
  );
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "enforce_card_fsrs_owner_consistency"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_user_id uuid;
BEGIN
  SELECT deck."user_id"
  INTO target_user_id
  FROM "decks" deck
  WHERE deck."id" = NEW."deck_id"
  FOR SHARE;

  IF EXISTS (
    SELECT 1
    FROM "fsrs_card_states" state
    WHERE state."card_id" = NEW."id"
      AND state."user_id" IS DISTINCT FROM target_user_id
  ) OR EXISTS (
    SELECT 1
    FROM "fsrs_review_events" event
    WHERE event."card_id" = NEW."id"
      AND event."user_id" IS DISTINCT FROM target_user_id
  ) THEN
    RAISE EXCEPTION
      'Card deck reassignment would invalidate FSRS ownership for card %',
      NEW."id"
      USING
        ERRCODE = '23503',
        CONSTRAINT = 'fk_cards_fsrs_owner_consistency',
        TABLE = TG_TABLE_NAME,
        SCHEMA = TG_TABLE_SCHEMA;
  END IF;

  RETURN NEW;
END
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_cards_fsrs_owner_consistency"
  ON "cards";
--> statement-breakpoint
CREATE TRIGGER "trg_cards_fsrs_owner_consistency"
  BEFORE UPDATE OF "deck_id"
  ON "cards"
  FOR EACH ROW
  EXECUTE FUNCTION "enforce_card_fsrs_owner_consistency"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "enforce_deck_fsrs_owner_consistency"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "cards" card
    INNER JOIN "fsrs_card_states" state ON state."card_id" = card."id"
    WHERE card."deck_id" = NEW."id"
      AND state."user_id" IS DISTINCT FROM NEW."user_id"
  ) OR EXISTS (
    SELECT 1
    FROM "cards" card
    INNER JOIN "fsrs_review_events" event ON event."card_id" = card."id"
    WHERE card."deck_id" = NEW."id"
      AND event."user_id" IS DISTINCT FROM NEW."user_id"
  ) THEN
    RAISE EXCEPTION
      'Deck owner reassignment would invalidate FSRS ownership for deck %',
      NEW."id"
      USING
        ERRCODE = '23503',
        CONSTRAINT = 'fk_decks_fsrs_owner_consistency',
        TABLE = TG_TABLE_NAME,
        SCHEMA = TG_TABLE_SCHEMA;
  END IF;

  RETURN NEW;
END
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_decks_fsrs_owner_consistency"
  ON "decks";
--> statement-breakpoint
CREATE TRIGGER "trg_decks_fsrs_owner_consistency"
  BEFORE UPDATE OF "user_id"
  ON "decks"
  FOR EACH ROW
  EXECUTE FUNCTION "enforce_deck_fsrs_owner_consistency"();
--> statement-breakpoint

-- Review events are immutable audit records. Direct mutation is rejected, but
-- parent deletion remains possible through existing FK cascades.
CREATE OR REPLACE FUNCTION "reject_fsrs_review_event_update"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'FSRS review events are append-only and cannot be updated'
    USING
      ERRCODE = '55000',
      CONSTRAINT = 'chk_fsrs_review_events_append_only_update',
      TABLE = TG_TABLE_NAME,
      SCHEMA = TG_TABLE_SCHEMA;
END
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_fsrs_review_events_reject_update"
  ON "fsrs_review_events";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_fsrs_review_events_append_only_update"
  ON "fsrs_review_events";
--> statement-breakpoint
CREATE TRIGGER "trg_fsrs_review_events_append_only_update"
  BEFORE UPDATE
  ON "fsrs_review_events"
  FOR EACH ROW
  EXECUTE FUNCTION "reject_fsrs_review_event_update"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "guard_fsrs_review_event_delete"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "users"
    WHERE "id" = OLD."user_id"
  ) AND EXISTS (
    SELECT 1
    FROM "cards"
    WHERE "id" = OLD."card_id"
  ) THEN
    RAISE EXCEPTION
      'FSRS review events are append-only and cannot be deleted directly'
      USING
        ERRCODE = '55000',
        CONSTRAINT = 'chk_fsrs_review_events_append_only_delete',
        TABLE = TG_TABLE_NAME,
        SCHEMA = TG_TABLE_SCHEMA;
  END IF;

  RETURN OLD;
END
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_fsrs_review_events_guard_delete"
  ON "fsrs_review_events";
--> statement-breakpoint
CREATE TRIGGER "trg_fsrs_review_events_guard_delete"
  BEFORE DELETE
  ON "fsrs_review_events"
  FOR EACH ROW
  EXECUTE FUNCTION "guard_fsrs_review_event_delete"();
--> statement-breakpoint

-- Migration audit rows have a status-dependent lifecycle and canonical
-- lowercase SHA-256 checksums.
ALTER TABLE "fsrs_migration_runs"
  DROP CONSTRAINT IF EXISTS "chk_fsrs_migration_runs_source_checksum";
--> statement-breakpoint
ALTER TABLE "fsrs_migration_runs"
  ADD CONSTRAINT "chk_fsrs_migration_runs_source_checksum"
  CHECK (
    "source_checksum" IS NULL
    OR "source_checksum" ~ '^[0-9a-f]{64}$'
  );
--> statement-breakpoint
ALTER TABLE "fsrs_migration_runs"
  DROP CONSTRAINT IF EXISTS "chk_fsrs_migration_runs_result_checksum";
--> statement-breakpoint
ALTER TABLE "fsrs_migration_runs"
  ADD CONSTRAINT "chk_fsrs_migration_runs_result_checksum"
  CHECK (
    "result_checksum" IS NULL
    OR "result_checksum" ~ '^[0-9a-f]{64}$'
  );
--> statement-breakpoint
ALTER TABLE "fsrs_migration_runs"
  DROP CONSTRAINT IF EXISTS "chk_fsrs_migration_runs_json_shapes";
--> statement-breakpoint
ALTER TABLE "fsrs_migration_runs"
  ADD CONSTRAINT "chk_fsrs_migration_runs_json_shapes"
  CHECK (
    jsonb_typeof("source_counts") = 'object'
    AND jsonb_typeof("result_counts") = 'object'
    AND jsonb_typeof("anomalies") = 'array'
  );
--> statement-breakpoint
ALTER TABLE "fsrs_migration_runs"
  DROP CONSTRAINT IF EXISTS "chk_fsrs_migration_runs_timestamps";
--> statement-breakpoint
ALTER TABLE "fsrs_migration_runs"
  ADD CONSTRAINT "chk_fsrs_migration_runs_timestamps"
  CHECK ("finished_at" IS NULL OR "started_at" <= "finished_at");
--> statement-breakpoint
ALTER TABLE "fsrs_migration_runs"
  DROP CONSTRAINT IF EXISTS "chk_fsrs_migration_runs_lifecycle";
--> statement-breakpoint
ALTER TABLE "fsrs_migration_runs"
  ADD CONSTRAINT "chk_fsrs_migration_runs_lifecycle"
  CHECK (
    "status" NOT IN ('running', 'completed', 'failed')
    OR (
      "status" = 'running'
      AND "finished_at" IS NULL
      AND "source_checksum" IS NOT NULL
      AND "result_checksum" IS NULL
      AND "error_message" IS NULL
    )
    OR (
      "status" = 'completed'
      AND "finished_at" IS NOT NULL
      AND "source_checksum" IS NOT NULL
      AND "result_checksum" IS NOT NULL
      AND "error_message" IS NULL
    )
    OR (
      "status" = 'failed'
      AND "finished_at" IS NOT NULL
      AND "result_checksum" IS NULL
      AND "error_message" IS NOT NULL
      AND btrim("error_message") <> ''
    )
  );
