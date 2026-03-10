-- Drop embedding infrastructure (pgvector duplicate-detection feature removed)
-- The embedding column and HNSW index in card_field_values are no longer used.

DROP INDEX IF EXISTS "idx_cfv_embedding";
ALTER TABLE "card_field_values" DROP COLUMN IF EXISTS "embedding";
