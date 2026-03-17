-- Migration: add fsrs_learning_steps to study_progress
-- Tracks which learning step a card is currently on (ts-fsrs learning_steps field).
-- Without this, Good reviews never advance past step1 and cards cannot graduate
-- from Learning state. Default 0 = step 1 (compatible with existing rows).

ALTER TABLE "study_progress"
  ADD COLUMN IF NOT EXISTS "fsrs_learning_steps" integer DEFAULT 0;
