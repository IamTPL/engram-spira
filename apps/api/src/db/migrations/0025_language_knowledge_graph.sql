-- Add the user-scoped lexical graph, durable KG worker state, typed
-- suggestions, and embedding provenance. Legacy undirected card pairs are
-- canonicalized before checks are installed so reverse rows cannot collide
-- with the existing ordered-pair unique constraints.

-- Keep one legacy related row per undirected card pair before rewriting the
-- surviving endpoint order. link_type stays in the partition so a future
-- directed type is never silently merged with a related row.
ALTER TABLE "card_links"
  DROP CONSTRAINT IF EXISTS "uq_card_link";

DELETE FROM "card_links"
WHERE "id" IN (
  SELECT "id"
  FROM (
    SELECT
      "id",
      row_number() OVER (
        PARTITION BY
          "link_type",
          LEAST("source_card_id", "target_card_id"),
          GREATEST("source_card_id", "target_card_id")
        ORDER BY "created_at", "id"
      ) AS "pair_rank"
    FROM "card_links"
    WHERE "link_type" = 'related'
  ) AS "ranked_card_links"
  WHERE "pair_rank" > 1
);

UPDATE "card_links"
SET
  "source_card_id" = LEAST("source_card_id", "target_card_id"),
  "target_card_id" = GREATEST("source_card_id", "target_card_id")
WHERE "link_type" = 'related'
  AND "source_card_id" > "target_card_id";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'uq_card_link'
      AND conrelid = 'card_links'::regclass
  ) THEN
    ALTER TABLE "card_links"
      ADD CONSTRAINT "uq_card_link"
      UNIQUE ("source_card_id", "target_card_id", "link_type");
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_card_links_related_canonical_order'
      AND conrelid = 'card_links'::regclass
  ) THEN
    ALTER TABLE "card_links"
      ADD CONSTRAINT "chk_card_links_related_canonical_order"
      CHECK (
        "link_type" <> 'related'
        OR "source_card_id" < "target_card_id"
      );
  END IF;
END
$$;

-- Dismissals are user-scoped undirected pairs, so user_id participates in the
-- dedupe partition before the surviving endpoints are canonicalized.
DELETE FROM "dismissed_suggestions"
WHERE "source_card_id" = "target_card_id";

DELETE FROM "dismissed_suggestions"
WHERE "id" IN (
  SELECT "id"
  FROM (
    SELECT
      "id",
      row_number() OVER (
        PARTITION BY
          "user_id",
          LEAST("source_card_id", "target_card_id"),
          GREATEST("source_card_id", "target_card_id")
        ORDER BY "dismissed_at", "id"
      ) AS "pair_rank"
    FROM "dismissed_suggestions"
  ) AS "ranked_dismissals"
  WHERE "pair_rank" > 1
);

UPDATE "dismissed_suggestions"
SET
  "source_card_id" = LEAST("source_card_id", "target_card_id"),
  "target_card_id" = GREATEST("source_card_id", "target_card_id")
WHERE "source_card_id" > "target_card_id";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_dismissed_suggestions_canonical_order'
      AND conrelid = 'dismissed_suggestions'::regclass
  ) THEN
    ALTER TABLE "dismissed_suggestions"
      ADD CONSTRAINT "chk_dismissed_suggestions_canonical_order"
      CHECK ("source_card_id" < "target_card_id");
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "lexemes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "language_tag" varchar(35) NOT NULL,
  "lemma" text NOT NULL,
  "normalized_lemma" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "lexemes_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "uq_lexemes_user_language_lemma"
    UNIQUE ("user_id", "language_tag", "normalized_lemma")
);

CREATE INDEX IF NOT EXISTS "idx_lexemes_user"
  ON "lexemes" ("user_id");

CREATE TABLE IF NOT EXISTS "lexical_senses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "lexeme_id" uuid NOT NULL,
  "part_of_speech" varchar(50) NOT NULL,
  "definition_language_tag" varchar(35) NOT NULL,
  "definition" text NOT NULL,
  "normalized_definition" text NOT NULL,
  "ipa" text,
  "examples" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "lexical_senses_lexeme_id_lexemes_id_fk"
    FOREIGN KEY ("lexeme_id") REFERENCES "lexemes"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "uq_lexical_sense_identity"
    UNIQUE (
      "lexeme_id",
      "part_of_speech",
      "definition_language_tag",
      "normalized_definition"
    )
);

CREATE INDEX IF NOT EXISTS "idx_lexical_senses_lexeme"
  ON "lexical_senses" ("lexeme_id");

CREATE TABLE IF NOT EXISTS "card_senses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "card_id" uuid NOT NULL,
  "sense_id" uuid NOT NULL,
  "source" varchar(20) DEFAULT 'deterministic' NOT NULL,
  "is_primary" boolean DEFAULT false NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "card_senses_card_id_cards_id_fk"
    FOREIGN KEY ("card_id") REFERENCES "cards"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "card_senses_sense_id_lexical_senses_id_fk"
    FOREIGN KEY ("sense_id") REFERENCES "lexical_senses"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "uq_card_senses_card_sense" UNIQUE ("card_id", "sense_id"),
  CONSTRAINT "chk_card_senses_source"
    CHECK ("source" IN ('deterministic', 'manual', 'ai'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_card_senses_primary_card"
  ON "card_senses" ("card_id")
  WHERE "is_primary" = true;

CREATE INDEX IF NOT EXISTS "idx_card_senses_sense"
  ON "card_senses" ("sense_id");

CREATE TABLE IF NOT EXISTS "sense_relations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "source_sense_id" uuid NOT NULL,
  "target_sense_id" uuid NOT NULL,
  "relation_type" varchar(30) NOT NULL,
  "origin" varchar(10) NOT NULL,
  "confidence" real DEFAULT 1 NOT NULL,
  "evidence" jsonb,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "sense_relations_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "sense_relations_source_sense_id_lexical_senses_id_fk"
    FOREIGN KEY ("source_sense_id") REFERENCES "lexical_senses"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "sense_relations_target_sense_id_lexical_senses_id_fk"
    FOREIGN KEY ("target_sense_id") REFERENCES "lexical_senses"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "uq_sense_relation"
    UNIQUE (
      "user_id",
      "source_sense_id",
      "target_sense_id",
      "relation_type"
    ),
  CONSTRAINT "chk_sense_relations_no_self"
    CHECK ("source_sense_id" <> "target_sense_id"),
  CONSTRAINT "chk_sense_relations_confidence"
    CHECK ("confidence" >= 0 AND "confidence" <= 1),
  CONSTRAINT "chk_sense_relations_type"
    CHECK (
      "relation_type" IN (
        'synonym',
        'antonym',
        'is_a',
        'part_of',
        'derived_from',
        'collocation',
        'confused_with',
        'translation_of',
        'coordinate'
      )
    ),
  CONSTRAINT "chk_sense_relations_origin"
    CHECK ("origin" IN ('manual', 'ai')),
  CONSTRAINT "chk_sense_relations_symmetric_order"
    CHECK (
      "relation_type" NOT IN (
        'synonym',
        'antonym',
        'collocation',
        'confused_with',
        'translation_of',
        'coordinate'
      )
      OR "source_sense_id" < "target_sense_id"
    )
);

CREATE INDEX IF NOT EXISTS "idx_sense_relations_source"
  ON "sense_relations" ("source_sense_id");

CREATE INDEX IF NOT EXISTS "idx_sense_relations_target"
  ON "sense_relations" ("target_sense_id");

CREATE INDEX IF NOT EXISTS "idx_sense_relations_user"
  ON "sense_relations" ("user_id");

CREATE TABLE IF NOT EXISTS "kg_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "run_type" varchar(30) NOT NULL,
  "deck_id" uuid,
  "focus_sense_id" uuid,
  "status" varchar(20) DEFAULT 'queued' NOT NULL,
  "stage" varchar(20) DEFAULT 'snapshot' NOT NULL,
  "fingerprint" varchar(64) NOT NULL,
  "representation_version" varchar(20) NOT NULL,
  "embedding_model" varchar(100) NOT NULL,
  "prompt_version" varchar(50) NOT NULL,
  "taxonomy_version" varchar(50) NOT NULL,
  "source_language_tag" varchar(35) NOT NULL,
  "definition_language_tag" varchar(35) NOT NULL,
  "snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "progress" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "max_attempts" integer DEFAULT 5 NOT NULL,
  "next_attempt_at" timestamptz DEFAULT now() NOT NULL,
  "locked_by" uuid,
  "locked_until" timestamptz,
  "heartbeat_at" timestamptz,
  "error_code" varchar(100),
  "error_message" text,
  "cancel_requested_at" timestamptz,
  "started_at" timestamptz,
  "completed_at" timestamptz,
  "partial_at" timestamptz,
  "failed_at" timestamptz,
  "cancelled_at" timestamptz,
  "stale_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "kg_runs_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "kg_runs_deck_id_decks_id_fk"
    FOREIGN KEY ("deck_id") REFERENCES "decks"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "kg_runs_focus_sense_id_lexical_senses_id_fk"
    FOREIGN KEY ("focus_sense_id") REFERENCES "lexical_senses"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "chk_kg_runs_type"
    CHECK ("run_type" IN ('deck_index', 'sense_expansion')),
  CONSTRAINT "chk_kg_runs_target"
    CHECK (
      (
        "run_type" = 'deck_index'
        AND "deck_id" IS NOT NULL
        AND "focus_sense_id" IS NULL
      )
      OR (
        "run_type" = 'sense_expansion'
        AND "deck_id" IS NULL
        AND "focus_sense_id" IS NOT NULL
      )
    ),
  CONSTRAINT "chk_kg_runs_status"
    CHECK (
      "status" IN (
        'queued',
        'processing',
        'completed',
        'partial',
        'failed',
        'cancelled',
        'stale'
      )
    ),
  CONSTRAINT "chk_kg_runs_stage"
    CHECK (
      "stage" IN (
        'snapshot',
        'indexing',
        'embeddings',
        'candidates',
        'verification',
        'persistence'
      )
    ),
  CONSTRAINT "chk_kg_runs_attempt_count" CHECK ("attempt_count" >= 0),
  CONSTRAINT "chk_kg_runs_max_attempts" CHECK ("max_attempts" > 0)
);

CREATE INDEX IF NOT EXISTS "idx_kg_runs_user_created"
  ON "kg_runs" ("user_id", "created_at");

CREATE INDEX IF NOT EXISTS "idx_kg_runs_fingerprint"
  ON "kg_runs" ("user_id", "fingerprint");

CREATE INDEX IF NOT EXISTS "idx_kg_runs_deck"
  ON "kg_runs" ("deck_id");

CREATE INDEX IF NOT EXISTS "idx_kg_runs_focus_sense"
  ON "kg_runs" ("focus_sense_id");

CREATE INDEX IF NOT EXISTS "idx_kg_runs_ready"
  ON "kg_runs" ("next_attempt_at", "created_at")
  WHERE "status" = 'queued';

CREATE INDEX IF NOT EXISTS "idx_kg_runs_processing_lease"
  ON "kg_runs" ("locked_until")
  WHERE "status" = 'processing';

CREATE UNIQUE INDEX IF NOT EXISTS "uq_kg_runs_active_deck"
  ON "kg_runs" ("user_id", "deck_id")
  WHERE "deck_id" IS NOT NULL
    AND "status" IN ('queued', 'processing');

CREATE UNIQUE INDEX IF NOT EXISTS "uq_kg_runs_active_focus_sense"
  ON "kg_runs" ("user_id", "focus_sense_id")
  WHERE "focus_sense_id" IS NOT NULL
    AND "status" IN ('queued', 'processing');

CREATE TABLE IF NOT EXISTS "kg_relation_suggestions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "run_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "source_card_id" uuid,
  "target_card_id" uuid,
  "source_sense_id" uuid,
  "target_sense_id" uuid,
  "source_artifact" jsonb NOT NULL,
  "target_artifact" jsonb NOT NULL,
  "source_content_hash" varchar(64) NOT NULL,
  "target_content_hash" varchar(64) NOT NULL,
  "decision" varchar(15) NOT NULL,
  "relation_type" varchar(30),
  "direction" varchar(25),
  "confidence_band" varchar(10) NOT NULL,
  "reason" text NOT NULL,
  "evidence" jsonb,
  "retrieval_similarity" real,
  "mutual_knn" boolean DEFAULT false NOT NULL,
  "fingerprint" varchar(64) NOT NULL,
  "status" varchar(20) DEFAULT 'pending' NOT NULL,
  "accepted_relation_id" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "accepted_at" timestamptz,
  "dismissed_at" timestamptz,
  "superseded_at" timestamptz,
  CONSTRAINT "kg_relation_suggestions_run_id_kg_runs_id_fk"
    FOREIGN KEY ("run_id") REFERENCES "kg_runs"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "kg_relation_suggestions_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "kg_relation_suggestions_source_card_id_cards_id_fk"
    FOREIGN KEY ("source_card_id") REFERENCES "cards"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "kg_relation_suggestions_target_card_id_cards_id_fk"
    FOREIGN KEY ("target_card_id") REFERENCES "cards"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "kg_relation_suggestions_source_sense_id_lexical_senses_id_fk"
    FOREIGN KEY ("source_sense_id") REFERENCES "lexical_senses"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "kg_relation_suggestions_target_sense_id_lexical_senses_id_fk"
    FOREIGN KEY ("target_sense_id") REFERENCES "lexical_senses"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "kg_suggestions_accepted_relation_id_sense_relations_id_fk"
    FOREIGN KEY ("accepted_relation_id") REFERENCES "sense_relations"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT "uq_kg_suggestions_user_fingerprint"
    UNIQUE ("user_id", "fingerprint"),
  CONSTRAINT "chk_kg_suggestions_endpoints"
    CHECK (
      "source_card_id" IS NOT NULL OR "source_sense_id" IS NOT NULL
    ),
  CONSTRAINT "chk_kg_suggestions_decision"
    CHECK ("decision" IN ('relation', 'none', 'abstain')),
  CONSTRAINT "chk_kg_suggestions_relation_type"
    CHECK (
      "relation_type" IS NULL
      OR "relation_type" IN (
        'synonym',
        'antonym',
        'is_a',
        'part_of',
        'derived_from',
        'collocation',
        'confused_with',
        'translation_of',
        'coordinate'
      )
    ),
  CONSTRAINT "chk_kg_suggestions_direction"
    CHECK (
      "direction" IS NULL
      OR "direction" IN (
        'source_to_target',
        'target_to_source',
        'symmetric'
      )
    ),
  CONSTRAINT "chk_kg_suggestions_verdict"
    CHECK (
      (
        "decision" = 'relation'
        AND "relation_type" IS NOT NULL
        AND "direction" IS NOT NULL
      )
      OR (
        "decision" IN ('none', 'abstain')
        AND "relation_type" IS NULL
        AND "direction" IS NULL
      )
    ),
  CONSTRAINT "chk_kg_suggestions_relation_direction"
    CHECK (
      "relation_type" IS NULL
      OR (
        "relation_type" IN (
          'synonym',
          'antonym',
          'collocation',
          'confused_with',
          'translation_of',
          'coordinate'
        )
        AND "direction" = 'symmetric'
      )
      OR (
        "relation_type" IN ('is_a', 'part_of', 'derived_from')
        AND "direction" IN ('source_to_target', 'target_to_source')
      )
    ),
  CONSTRAINT "chk_kg_suggestions_confidence_band"
    CHECK ("confidence_band" IN ('high', 'medium', 'low')),
  CONSTRAINT "chk_kg_suggestions_similarity"
    CHECK (
      "retrieval_similarity" IS NULL
      OR (
        "retrieval_similarity" >= 0
        AND "retrieval_similarity" <= 1
      )
    ),
  CONSTRAINT "chk_kg_suggestions_status"
    CHECK (
      "status" IN (
        'pending',
        'accepted',
        'dismissed',
        'superseded',
        'rejected'
      )
  )
);

-- Early development copies of 0025 used run-local fingerprints and required
-- both endpoint IDs. Normalize those constraints when this idempotent script
-- is reapplied: a user's fingerprint dedupes across retries/runs, while an
-- expansion target can remain an artifact until the suggestion is accepted.
ALTER TABLE "kg_relation_suggestions"
  DROP CONSTRAINT IF EXISTS "uq_kg_suggestions_run_fingerprint";

-- Rows that were legal under the old run-scoped key can collide under the
-- user-scoped key. Keep exactly one row per user/fingerprint, preferring the
-- most authoritative review outcome, then the latest lifecycle/update/create
-- time, and finally the lowest UUID as a stable tie-breaker. Deleting a
-- suggestion never deletes its accepted sense relation because the FK points
-- from the suggestion to the relation.
WITH "ranked_suggestions" AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "user_id", "fingerprint"
      ORDER BY
        CASE "status"
          WHEN 'accepted' THEN 1
          WHEN 'dismissed' THEN 2
          WHEN 'rejected' THEN 3
          WHEN 'pending' THEN 4
          WHEN 'superseded' THEN 5
          ELSE 6
        END,
        COALESCE(
          CASE "status"
            WHEN 'accepted' THEN "accepted_at"
            WHEN 'dismissed' THEN "dismissed_at"
            WHEN 'rejected' THEN "updated_at"
            WHEN 'pending' THEN "updated_at"
            WHEN 'superseded' THEN "superseded_at"
          END,
          "updated_at",
          "created_at"
        ) DESC,
        "updated_at" DESC,
        "created_at" DESC,
        "id" ASC
    ) AS "duplicate_rank"
  FROM "kg_relation_suggestions"
)
DELETE FROM "kg_relation_suggestions"
WHERE "id" IN (
  SELECT "id"
  FROM "ranked_suggestions"
  WHERE "duplicate_rank" > 1
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'uq_kg_suggestions_user_fingerprint'
      AND conrelid = 'kg_relation_suggestions'::regclass
  ) THEN
    ALTER TABLE "kg_relation_suggestions"
      ADD CONSTRAINT "uq_kg_suggestions_user_fingerprint"
      UNIQUE ("user_id", "fingerprint");
  END IF;
END
$$;

ALTER TABLE "kg_relation_suggestions"
  DROP CONSTRAINT IF EXISTS "chk_kg_suggestions_endpoints";

ALTER TABLE "kg_relation_suggestions"
  ADD CONSTRAINT "chk_kg_suggestions_endpoints"
  CHECK (
    "source_card_id" IS NOT NULL OR "source_sense_id" IS NOT NULL
  );

CREATE INDEX IF NOT EXISTS "idx_kg_suggestions_run_status"
  ON "kg_relation_suggestions" ("run_id", "status");

CREATE INDEX IF NOT EXISTS "idx_kg_suggestions_user_status"
  ON "kg_relation_suggestions" ("user_id", "status");

CREATE INDEX IF NOT EXISTS "idx_kg_suggestions_source_card"
  ON "kg_relation_suggestions" ("source_card_id");

CREATE INDEX IF NOT EXISTS "idx_kg_suggestions_target_card"
  ON "kg_relation_suggestions" ("target_card_id");

CREATE INDEX IF NOT EXISTS "idx_kg_suggestions_source_sense"
  ON "kg_relation_suggestions" ("source_sense_id");

CREATE INDEX IF NOT EXISTS "idx_kg_suggestions_target_sense"
  ON "kg_relation_suggestions" ("target_sense_id");

CREATE INDEX IF NOT EXISTS "idx_kg_suggestions_accepted_relation"
  ON "kg_relation_suggestions" ("accepted_relation_id");

CREATE TABLE IF NOT EXISTS "card_embedding_metadata" (
  "card_id" uuid PRIMARY KEY NOT NULL,
  "model" varchar(100) NOT NULL,
  "dimensions" integer NOT NULL,
  "representation_version" varchar(20) NOT NULL,
  "content_hash" varchar(64) NOT NULL,
  "embedded_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "card_embedding_metadata_card_id_cards_id_fk"
    FOREIGN KEY ("card_id") REFERENCES "cards"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "chk_card_embedding_metadata_dimensions"
    CHECK ("dimensions" = 768)
);
