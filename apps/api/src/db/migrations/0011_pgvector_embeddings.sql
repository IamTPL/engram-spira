-- Enable pgvector extension (skip gracefully if not available)
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS vector;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pgvector extension not available, skipping embedding support';
END $$;

-- Add embedding column only if pgvector extension is installed
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    ALTER TABLE "card_field_values" ADD COLUMN IF NOT EXISTS "embedding" vector(768);
    CREATE INDEX IF NOT EXISTS "idx_cfv_embedding" ON "card_field_values" USING hnsw ("embedding" vector_cosine_ops);
  END IF;
END $$;
