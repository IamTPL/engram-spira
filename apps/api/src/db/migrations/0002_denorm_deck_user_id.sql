-- Denormalize user_id onto decks for O(1) ownership checks
-- Previously: decks → folders → classes → WHERE classes.user_id = ?  (3-table JOIN)
-- After:      WHERE decks.user_id = ?  (1 index lookup)

-- 1. Add nullable column first (required for tables that already have rows)
ALTER TABLE "decks" ADD COLUMN "user_id" uuid REFERENCES "users"("id") ON DELETE CASCADE;

-- 2. Backfill from the class hierarchy
UPDATE "decks"
SET "user_id" = "classes"."user_id"
FROM "folders"
JOIN "classes" ON "classes"."id" = "folders"."class_id"
WHERE "decks"."folder_id" = "folders"."id";

-- 3. Enforce NOT NULL now that backfill is done
ALTER TABLE "decks" ALTER COLUMN "user_id" SET NOT NULL;

-- 4. Index for the ownership lookup pattern
CREATE INDEX "idx_decks_user_id" ON "decks" ("user_id");
