# Database

PostgreSQL 15 + pgvector, local via `docker compose up -d` (`pgvector/pgvector:pg15`, host port **5435** → container 5432, database `flashcard_db`, user/password `postgres`/`postgrespassword`, named volume `flashcard_db_data`). Drizzle ORM `^0.45.1` on the **postgres.js** driver; `drizzle-kit 0.31.9`.

A plain `postgres:15-alpine` image will **not** work — migration `0022` needs the `vector` extension.

## Client (`apps/api/src/db/index.ts`)

```ts
const client = postgres(ENV.DATABASE_URL, {
  max: ENV.NODE_ENV === 'production' ? 20 : 10,
  idle_timeout: 20,
  connect_timeout: 10,
  prepare: true,
});
export const pgClient = client;              // raw postgres.js
export const db = drizzle(client, { schema });
```

(Those trailing comments are not in the source; `db/index.ts:13-14` is bare.) Use `db` for everything. Reach for `pgClient` for pgvector work — plus one pre-existing non-vector exception, an `= ANY(…::uuid[])` `card_links` query at `kg-ai.service.ts:103-111`.

No Drizzle `logger` is configured, so **there is no SQL logging** in dev. `prepare: true` means named prepared statements — incompatible with transaction-mode poolers (PgBouncer, Supabase pooler). `db/seed.ts` is the only other file that legitimately opens its own client.

## Schema conventions

One file per subject area in `apps/api/src/db/schema/`, all re-exported from `schema/index.ts` — **the only file `drizzle.config.ts` reads.** A table not exported there is invisible to drizzle-kit and will be dropped by `push`.

Totals: **18 tables** across 16 files (`cards.ts` and `card-templates.ts` each declare two), 18 `relations()`, 26 FKs, 22 btree indexes, 7 table-level uniques, 2 column-level uniques, 1 CHECK, **0 `pgEnum`**.

- PKs are `uuid('id').primaryKey().defaultRandom()`. The **only** text PK is `sessions.id` (it holds the hashed session token). Never introduce `serial`/`bigserial`.
- Column names are snake_case inside `pgTable`, camelCase as the TS property: `sourceCardId: uuid('source_card_id')`. No casing option is configured.
- Indexes/uniques/checks go in the **array-returning** third argument: `(table) => [ index('idx_x').on(...), unique('uq_x').on(...) ]`. Never the deprecated object form.
- Name them explicitly: `idx_<table-abbrev>_<cols>`, `uq_<meaning>`. Never let Drizzle auto-generate a table-level constraint name.
- Timestamps are `timestamp('...', { withTimezone: true })`, `.defaultNow()` for created/updated stamps. `date(...)` is used only for `study_daily_logs.study_date`.
- `onDelete: 'cascade'` on every FK to users/classes/folders/decks/cards. **25 of 26 FKs cascade**; the deliberate exception is `decks.card_template_id → card_templates.id` (NO ACTION, so a template in use cannot be deleted) — preserve that.
- Enum-like columns are `varchar(n)` validated in application code against `shared/constants.ts`. **Do not add a `pgEnum`** — there are zero, and adding one changes migration semantics.
- Declare `relations()` for every new table and add the inverse side. When a table has two FKs to the same table, set `relationName` on both sides — see `card_links` (`outgoingLinks` / `incomingLinks`).

## Tables

⌫ = `ON DELETE CASCADE`. `d` = default.

| Table | PK | Notable columns | Constraints / indexes |
|---|---|---|---|
| `users` | uuid | `email` uq, `password_hash`, `display_name` varchar(50), `avatar_url`, `srs_algorithm` varchar(10) d`'sm2'`, `email_verified` d`false`, `email_verification_token` varchar(64), `email_token_expires_at` | `users_email_unique`; DB-only partial `idx_users_verification_token` |
| `sessions` | **text** | `user_id`⌫, `expires_at` | `idx_sessions_user_id` |
| `classes` | uuid | `user_id`⌫, `name`, `description`, `sort_order` d`0` | `idx_classes_user_id` |
| `folders` | uuid | `class_id`⌫, `name`, `sort_order` d`0` | `idx_folders_class_id` |
| `decks` | uuid | `user_id`⌫ **(denormalized)**, `folder_id`⌫, `card_template_id` **NO ACTION**, `name` | `idx_decks_user_id`, `idx_decks_folder_id`, `idx_decks_card_template_id` |
| `card_templates` | uuid | `user_id`⌫ **nullable** (NULL = system), `name`, `description`, `is_system` d`false` | `idx_card_templates_user_id`; DB-only partial `idx_card_templates_is_system` |
| `template_fields` | uuid | `template_id`⌫, `name` varchar(100), `field_type` varchar(50), `side` varchar(10), `sort_order`, `is_required` d`false`, `config` jsonb | uq `uq_template_field_name(template_id,name)`; `idx_template_fields_template_id` |
| `cards` | uuid | `deck_id`⌫, `sort_order` d`0` | `idx_cards_deck_id`, `idx_cards_deck_sort_order(deck_id,sort_order)` |
| `card_field_values` | uuid | `card_id`⌫, `template_field_id`⌫, `value` jsonb NOT NULL, **`embedding vector(768)` — DB-only** | uq `uq_card_field_value(card_id,template_field_id)`; `idx_cfv_card_id`; DB-only HNSW `idx_cfv_embedding` |
| `study_progress` | uuid | SM-2: `box_level` d`0`, `ease_factor` float8 d`2.5`, `interval_days` d`1`; shared: `next_review_at` **NOT NULL, no default**, `last_reviewed_at`; FSRS: `stability` real, `difficulty` real, `fsrs_state` varchar(15) d`'new'`, `last_elapsed_days` real d`0`, `fsrs_learning_steps` d`0` | uq `uq_user_card_progress(user_id,card_id)`; `idx_sp_user_next_review(user_id,next_review_at)` |
| `study_daily_logs` | uuid | `user_id`⌫, `study_date` **date**, `cards_reviewed` d`0` | uq `uq_user_study_date` — no other index (the redundant one was dropped in `0018`) |
| `password_reset_tokens` | uuid | `user_id`⌫, `token_hash` uq, `expires_at` | `idx_prt_user_id`; DB-only `idx_prt_token_hash` |
| `review_logs` | uuid | append-only: `rating` varchar(10), `state` varchar(15) d`'new'`, `elapsed_days` d`0`, `scheduled_days` d`0`, `review_duration_ms` (**never written**), `reviewed_at` | `idx_rl_user_card`, `idx_rl_user_reviewed_at` |
| `ai_generation_jobs` | uuid | `status` varchar(20) d`'processing'`, `error_message`, `source_text`, `card_count`, `generated_cards` jsonb, `model` varchar(50) | `idx_ai_jobs_user_id`, `idx_ai_jobs_status_created`; DB-only partial `idx_ai_jobs_active` |
| `card_links` | uuid | `source_card_id`⌫, `target_card_id`⌫, `link_type` varchar(20) d`'related'` | uq `uq_card_link`; **CHECK `chk_no_self_link`**; `idx_card_links_source`, `idx_card_links_target` |
| `card_concepts` | uuid | `card_id`⌫, `concept` varchar(255) | `idx_card_concepts_card_id`, `idx_card_concepts_concept` |
| `fsrs_user_params` | uuid | `user_id`⌫, `params` jsonb d`'{}'`, `updated_at` | uq `uq_fsrs_user_params_user` |
| `dismissed_suggestions` | uuid | `user_id`⌫, `source_card_id`⌫, `target_card_id`⌫, `dismissed_at` | uq `uq_dismissed_user_pair`; `idx_dismissed_suggestions_user` |

`rating`, `state`, `fsrs_state`, `status`, `link_type`, `field_type`, `side`, `srs_algorithm` are all `varchar` with **no DB constraint** — validation is application-only.

### Objects that exist in Postgres but not in Drizzle

`card_field_values.embedding vector(768)` · `idx_cfv_embedding` (HNSW) · `idx_card_templates_is_system`, `idx_ai_jobs_active`, `idx_users_verification_token` (partial) · `idx_prt_token_hash` · extension `vector` · schema `drizzle` + table `__drizzle_migrations`

This is why `db:push` is dangerous — see below.

### Invariants nothing enforces

- **`decks.user_id` is denormalized** from `classes.user_id`. `decks.move` only updates `folderId` and validates the target folder belongs to the same user, so the invariant holds by convention. Any new code that reparents a deck must preserve `decks.user_id == folders → classes.user_id`.
- **`card_templates.user_id` is nullable** and system templates use NULL. A query filtering by `user_id` silently excludes them — use `isNull(cardTemplates.userId)` or `isSystem` explicitly.
- `study_progress.next_review_at` is NOT NULL **with no default** — an insert that omits it fails.
- `card_field_values.template_field_id` has no standalone index (only `idx_cfv_card_id` and the composite unique starting with `card_id`), so deleting a `template_fields` row scans `card_field_values`. Same for the `dismissed_suggestions` card columns.

## pgvector

| Aspect | Value |
|---|---|
| Extension | `CREATE EXTENSION IF NOT EXISTS vector` (migration `0022`) |
| Column | `card_field_values.embedding vector(768)`, nullable, **not modelled in Drizzle** |
| Dimension | **768** — `EMBEDDING_DIMENSIONS` in `embedding.service.ts:12`, sent as `outputDimensionality` |
| Source model | Gemini `GEMINI_EMBEDDING_MODEL` (default `gemini-embedding-001`), Matryoshka-truncated from 3072 |
| Index | `idx_cfv_embedding USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)` |
| Operator | `<=>` (cosine). Similarity = `1 - (embedding <=> $vec::vector)`; keep `ORDER BY embedding <=> $vec::vector` so the index is used |
| Access | raw `pgClient` tagged templates for the vector **writes** *and* for the ANN similarity search (`searchByEmbedding`, `embedding.service.ts:314-332`); ``db.execute(sql`…`)`` with `embedding::text` when reading a stored vector back into JS (duplicate-detection, recommendations, kg-ai) |
| Storage rule | **one embedding per card**, written to the *first* `card_field_values` row (an unordered `.limit(1)`) — readers compensate with `DISTINCT ON (cfv.card_id)` / `NOT EXISTS` |
| Availability probe | `isEmbeddingAvailable()` checks `information_schema.columns`; missing → `AppError(422)` |

Rules: never switch to `<->` or `<#>` — the opclass is cosine-only. Build literals only from `number[]` as `` `[${vec.join(',')}]` ``, pass them as a bound parameter, and cast `::vector`. Never interpolate user-supplied strings. Any dimension other than 768 fails the column cast.

No IVFFlat index exists anywhere in the repo.

## Migrations

24 files, `0000` → `0023`, all listed in `meta/_journal.json`. **Only 12 snapshots exist** (`0000, 0005, 0006, 0007, 0008, 0009, 0010, 0012, 0013, 0014, 0016, 0017`) — the 12 hand-written migrations (`0001`–`0004`, `0011`, `0015`, `0018`–`0023`) have none, so **drizzle-kit's baseline is `0017_snapshot.json`: 16 tables, pre-FSRS, pre-email-verification, no `embedding`.**

### Commands

| Command | When |
|---|---|
| `bun run db:migrate` | **Default.** Applies pending files inside a single transaction; records them in `drizzle.__drizzle_migrations` |
| `bun run db:generate` | After editing `schema/*.ts`. **Always read the emitted SQL.** Against the stale 0017 baseline it re-emits `CREATE TABLE dismissed_suggestions` / `fsrs_user_params`, the five `study_progress` FSRS `ADD COLUMN`s, `users.srs_algorithm` + the four `email_*` columns, and a redundant `DROP INDEX "idx_sdl_user_date"` (already dropped by `0018`, and emitted **without `IF EXISTS`**, so it errors on a migrated DB). It does **not** touch `embedding` — no snapshot ever contained that column, so generate is blind to it. Prune by hand |
| `bun run db:push` | Throwaway DBs only. Force-syncs DB→schema: drops `embedding`, `idx_cfv_embedding`, all 3 partial indexes and `idx_prt_token_hash`, and never creates the `vector` extension |
| `bun run db:drop` | Interactive "select migration to drop" — deletes a migration `.sql`, its snapshot and its journal entry. **Touches no data** |
| `bun run db:reset` | Misnamed: `db:drop && db:push`. Deletes the newest migration *file*, then force-pushes. Avoid |
| `bun run db:seed` | Idempotent — safe to re-run |
| `bun run db:studio` | Drizzle Studio |

This is not hypothetical: **`0013_flowery_blue_marvel.sql` was auto-generated and dropped `fsrs_user_params` plus four `study_progress` columns** purely because they were not in `schema/*.ts` at the time. Treat every generated migration as a draft. Re-apply `0022_add_embedding_infrastructure.sql` after any `push`.

### Writing a hand-written migration

1. Name it `NNNN_snake_case_purpose.sql`, lead with a comment explaining **why** and which query pattern an index serves.
2. Make it idempotent: `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `DROP … IF EXISTS`.
3. Add a `_journal.json` entry whose `when` is **strictly greater** than the previous entry's. Drizzle applies a migration only when `lastDbMigration.created_at < migration.folderMillis`. **`0015` violates this** (`when` 1741564800000 < `0014`'s 1772769352081) and is therefore permanently skipped on any established database — harmless only because `0022` re-adds the column with `IF NOT EXISTS`.
4. Backfill pattern for a new NOT NULL column: add nullable → `UPDATE` → `SET NOT NULL` → create index (see `0002`).
5. The whole batch runs in **one transaction** — no `CREATE INDEX CONCURRENTLY`, and one failing statement rolls everything back.

Editing an already-applied migration changes its hash, but Drizzle compares only `created_at`, so the edit is simply never re-run.

### History

| # | Purpose |
|---|---|
| `0000` | generated initial schema — 10 tables + FKs + 9 indexes |
| `0001` | *hand* `idx_decks_card_template_id` + partial `idx_card_templates_is_system` |
| `0002` | *hand* add `decks.user_id`, backfill from folders→classes, SET NOT NULL, index (the denormalization) |
| `0003` | *hand* `study_progress.ease_factor` + `interval_days` (Leitner → SM-2) |
| `0004` | *hand* create `study_daily_logs` |
| `0005` | **empty file** — exists only to resync the Drizzle snapshot after 0001–0004 |
| `0006` | `users.display_name`, `users.avatar_url` |
| `0007` | `password_reset_tokens` |
| `0008` | `review_logs` |
| `0009` | first `fsrs_user_params` (weights/desired_retention/…) + FSRS columns as **float8** |
| `0010` | `ai_generation_jobs` |
| `0011` | *hand* pgvector in `DO $$` blocks (skips gracefully if the extension is absent) |
| `0012` | `card_concepts`, `card_links` (+ `uq_card_link`, `chk_no_self_link`) |
| `0013` | **generated regression** — `DROP TABLE fsrs_user_params CASCADE` + drops 4 `study_progress` columns |
| `0014` | `sort_order` on classes and folders |
| `0015` | *hand* drop the embedding column — **permanently skipped, bad `when`** |
| `0016` | `ai_generation_jobs.status` default → `'processing'`; add `error_message` |
| `0017` | `idx_cards_deck_sort_order`. **Last migration with a snapshot** |
| `0018` | *hand* partial `idx_ai_jobs_active`, `idx_prt_token_hash`, drop redundant `idx_sdl_user_date` |
| `0019` | *hand* re-add FSRS columns as **real**, `users.srs_algorithm`, recreate `fsrs_user_params` as `params jsonb` |
| `0020` | *hand* `study_progress.fsrs_learning_steps` (without it Good never graduates a Learning card) |
| `0021` | *hand* email verification columns + partial index |
| `0022` | *hand* **the live pgvector setup** — extension, `embedding vector(768)`, HNSW `m=16, ef_construction=64`. Unlike `0011` it is **not** guarded, so `db:migrate` fails hard on a Postgres without pgvector |
| `0023` | *hand* `dismissed_suggestions` |

Two different `fsrs_user_params` shapes have existed (`0009` → dropped by `0013` → recreated by `0019`). Only the `0019` shape matches `schema/fsrs-user-params.ts`. Long-lived databases that survived `0009→0013→0019` have `real` FSRS columns — do not assume float8.

## Seeding

`db/seed.ts` opens its own client, is idempotent, and `process.exit()`s.

1. De-duplicates system templates: groups `is_system = true` by name, keeps the oldest by `createdAt`, re-points `decks.card_template_id` at the kept id, deletes the rest.
2. Inserts the test user `test@example.com` / `password123` (argon2 via `@node-rs/argon2`, `onConflictDoNothing`).
3. Ensures exactly **two** system templates — there is no "Default (Front/Back)":
   - **Vocabulary** — 5 fields: `word` (text, front, required), `type` (text, front), `ipa` (text, front), `definition` (textarea, back, required), `examples` (json_array, back, `config {maxItems: 5}`)
   - **Basic Q&A** — 2 fields: `question` (textarea, front, required), `answer` (textarea, back, required)

Add to seed only through the existing idempotent helpers (`onConflictDoNothing`, `ensureSystemTemplate`). `db:seed` must stay safe to re-run.

## Tests never touch Postgres

`apps/api/bunfig.toml` preloads `__tests__/preload.ts` (env + logger mocks) and `__tests__/helpers/db-mock.ts` mocks `src/db/index.ts`. Do not add code that opens its own connection outside `db/index.ts`. See [testing.md](testing.md).
