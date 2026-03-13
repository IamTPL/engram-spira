-- Partial index for active AI jobs: only index rows with status 'pending' or 'processing'
-- These are the only statuses queried in hot paths (job polling, cleanup).
-- Full (status, created_at) index remains for historical queries.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_jobs_active
  ON ai_generation_jobs (status, created_at)
  WHERE status IN ('pending', 'processing');

-- Partial index for valid (non-expired) password reset tokens
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_prt_valid_tokens
  ON password_reset_tokens (token_hash)
  WHERE expires_at > now();

-- Remove redundant index on study_daily_logs:
-- The unique constraint uq_user_study_date already creates an index on (user_id, study_date).
-- The additional idx_sdl_user_date is fully redundant and only adds write amplification.
DROP INDEX CONCURRENTLY IF EXISTS idx_sdl_user_date;
