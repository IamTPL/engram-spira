-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding column to card_field_values
-- Stores 768-dimensional vector from Gemini gemini-embedding-001 (Matryoshka truncation)
ALTER TABLE "card_field_values" ADD COLUMN IF NOT EXISTS "embedding" vector(768);

-- HNSW index for fast approximate nearest neighbor search
-- vector_cosine_ops = cosine similarity (best for text embeddings)
-- m=16, ef_construction=64 = good balance of speed/accuracy for <1M vectors
CREATE INDEX IF NOT EXISTS "idx_cfv_embedding"
  ON "card_field_values"
  USING hnsw ("embedding" vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
