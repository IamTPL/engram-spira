-- Performance indexes added for scale
-- 1. Index on decks.card_template_id
--    Allows fast lookup of "which decks use template X" (needed on template delete/update).
CREATE INDEX IF NOT EXISTS "idx_decks_card_template_id" ON "decks" ("card_template_id");

-- 2. Composite index on card_templates for system-template lookups
--    Used by getSystemTemplates() cache-miss and admin queries.
CREATE INDEX IF NOT EXISTS "idx_card_templates_is_system" ON "card_templates" ("is_system") WHERE "is_system" = true;
