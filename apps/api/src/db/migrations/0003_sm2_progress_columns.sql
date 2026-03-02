-- Upgrade SRS from Leitner Box (fixed intervals) to SM-2 (adaptive per-card)
-- Adds two columns that track per-card memory state:
--   ease_factor: multiplier controlling how fast intervals grow per card (default 2.5)
--   interval_days: the actual days until next review (replaces fixed lookup table)

ALTER TABLE "study_progress"
  ADD COLUMN "ease_factor" double precision NOT NULL DEFAULT 2.5,
  ADD COLUMN "interval_days" integer NOT NULL DEFAULT 1;
