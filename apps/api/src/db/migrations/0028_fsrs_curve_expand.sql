-- 0028_fsrs_curve_expand.sql
-- Additive: forgetting-curve constants per revision, an IMMUTABLE retrievability
-- function, and covering indexes for user- and card-scoped state reads.
-- Legacy tables are untouched here; 0029 drops them.

ALTER TABLE "fsrs_parameter_revisions"
  ADD COLUMN IF NOT EXISTS "decay" double precision,
  ADD COLUMN IF NOT EXISTS "factor" double precision;
--> statement-breakpoint
UPDATE "fsrs_parameter_revisions"
SET
  "decay" = -(("parameters"->'w'->>20)::double precision),
  "factor" = round(
    (exp(ln(0.9) / (-(("parameters"->'w'->>20)::double precision))) - 1)::numeric,
    8
  )::double precision
WHERE "decay" IS NULL OR "factor" IS NULL;
--> statement-breakpoint
ALTER TABLE "fsrs_parameter_revisions"
  ALTER COLUMN "decay" SET NOT NULL,
  ALTER COLUMN "factor" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "fsrs_parameter_revisions"
  DROP CONSTRAINT IF EXISTS "chk_fsrs_parameter_revisions_curve";
--> statement-breakpoint
ALTER TABLE "fsrs_parameter_revisions"
  ADD CONSTRAINT "chk_fsrs_parameter_revisions_curve"
  CHECK ("decay" < 0 AND "factor" > 0);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION fsrs_retrievability(
  stability double precision,
  elapsed_seconds double precision,
  decay double precision,
  factor double precision
) RETURNS double precision
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$
  SELECT round(
    power(1 + factor * (GREATEST(elapsed_seconds, 0) / 86400.0) / stability, decay)::numeric,
    8
  )::double precision
$$;
--> statement-breakpoint
DROP INDEX IF EXISTS "idx_fsrs_card_states_due";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_fsrs_card_states_user_due"
  ON "fsrs_card_states" ("user_id", "next_review_at")
  INCLUDE ("card_id", "state", "stability", "last_reviewed_at", "parameter_revision_id");
--> statement-breakpoint
DROP INDEX IF EXISTS "idx_fsrs_card_states_card";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_fsrs_card_states_card_user"
  ON "fsrs_card_states" ("card_id", "user_id");
