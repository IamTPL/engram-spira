# Endpoint reference — 91 routes

90 routes across 16 module files + `GET /health` in `index.ts:170`. Re-derive the count with:

```bash
grep -rhE '^\s*\.(get|post|put|patch|delete)\(' apps/api/src/modules/*/*.routes.ts | wc -l
```

**Auth** column: `PUBLIC` means the route is declared *before* `.use(requireAuth)` in its file. Every error body is `{ error: string }`.

## Hardening at a glance

| Module | Prefix | Rate limit | `t` schemas |
|---|---|---|---|
| auth | `/auth` | **5**/min per IP (all endpoints) | yes |
| users | `/users` | — | yes |
| classes | `/classes` | — | body only |
| folders | `/folders` | — | body only |
| decks | `/decks` | — | body only |
| cards | `/cards` | — | body only (**no param/query validation**) |
| card-templates | `/card-templates` | — | body only |
| study | `/study` | **180**/min | yes |
| ai | `/ai` | **20**/min on `POST /generate` + 30/hr per user | yes |
| embedding | `/embedding` | — | — |
| search | `/search` | **60**/min | query |
| knowledge-graph | `/knowledge-graph` | — | yes |
| import-export | **none** | **15**/min | yes (only module validating params) |
| notifications | `/notifications` | — | — |
| feedback | `/feedback` | — | body |
| experience | **none** | — | **none — hand-written parsers** |

The 8 `experience` routes and the 2 `import-export` routes live at the API root. Because security headers are set in `onAfterHandle`, no error response from any route carries them.

## `GET /health`

Public, declared before every auth-bearing plugin. Runs `SELECT 1`.
→ `200 {status:'ok',checks:{db:'ok'},timestamp}` or `503 {status:'degraded',checks:{db:'error'},timestamp}`

## auth (9)

| Method | Path | Auth | Body / query | Response · errors |
|---|---|---|---|---|
| POST | `/auth/register` | PUBLIC | `{email: format email, password: String}` | `{user:{id,email,displayName,avatarUrl,emailVerified}}` + `Set-Cookie` · 422 invalid email / password length, 409 `Email already registered` |
| POST | `/auth/login` | PUBLIC | `{email: format email, password}` | `{user:{…}}` + cookie · 401 `Invalid email or password` |
| POST | `/auth/logout` | PUBLIC | — | `{success:true}`; clears cookie |
| GET | `/auth/me` | PUBLIC | — | `{user:{…}}` or `{user:null}` — **never 401** |
| POST | `/auth/forgot-password` | PUBLIC | `{email: format email}` | always `{success:true}` (email-enumeration safe) |
| POST | `/auth/reset-password` | PUBLIC | `{token: minLength 1, newPassword: 8..128}` | `{success:true}` · 422 invalid/expired token |
| GET | `/auth/verify-email` | PUBLIC | query `{token: minLength 1}` | `{success:true, alreadyVerified}` · 422 |
| POST | `/auth/resend-verification` | AUTH | — | `{success:true, alreadyVerified}` · 404 |
| POST | `/auth/change-password` | AUTH | `{currentPassword: minLength 1, newPassword: 8..128}` | `{success:true}` · 422 wrong password |

`/auth/me` and `/auth/logout` deliberately bypass `requireAuth` and call `validateSession` directly so they can return `{user:null}` instead of 401.

## users (2)

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| GET | `/users/avatars` | **PUBLIC** | — | `{avatars: string[]}` — empty array if `AVATARS_DIR` unreadable |
| PATCH | `/users/profile` | AUTH | `{displayName?: 1..50, avatarUrl?}` | `{user:{…}}`; `avatarUrl: ''` clears to null · 422 |

## classes (6)

`GET /classes` · `POST /classes` `{name: minLength 1, description?}` · `GET /classes/:id` · `PATCH /classes/:id` `{name?, description?}` · `DELETE /classes/:id` → `{success:true}` (cascades folders → decks → cards) · `PATCH /classes/reorder` `{classIds: uuid[] minItems 1}` → `{reordered:n}`

All 404 `Class not found`. `PATCH /classes/reorder` is declared *after* `PATCH /classes/:id` and relies on Elysia's static-over-dynamic precedence — verify any new static sub-path under a `:id`-bearing prefix.

## folders (7)

`GET /folders/all` (across all owned classes) · `GET /folders/by-class/:classId` · `POST /folders/by-class/:classId` `{name}` · `GET /folders/:id` · `PATCH /folders/:id` `{name?}` · `DELETE /folders/:id` · `PATCH /folders/by-class/:classId/reorder` `{folderIds: uuid[]}`

404 `Class not found` / `Folder not found`.

## decks (6)

`GET /decks/by-folder/:folderId` → deck rows + `cardCount` · `POST /decks/by-folder/:folderId` `{name, cardTemplateId: uuid}` · `GET /decks/:id` · `PATCH /decks/:id` `{name?}` · `DELETE /decks/:id` · `PATCH /decks/:id/move` `{folderId: uuid}` (target must be same user)

## cards (8)

| Method | Path | Body / query | Notes |
|---|---|---|---|
| GET | `/cards/by-deck/:deckId` | query `cursor?`, `limit?` — **unvalidated**, `Number()`-coerced; default 50, cap 200 | `{items, total, limit, hasMore, nextCursor}`; cursor-paginated on `sort_order` |
| GET | `/cards/by-deck/:deckId/search` | query `q?`, `limit?` (default 50, cap 100) | `{items, total}`; ILIKE on `cfv.value::text` — **does not escape `%`/`_`** |
| POST | `/cards/by-deck/:deckId` | `{fieldValues: [{templateFieldId: uuid, value: Unknown}]}` | sort_order under `FOR UPDATE`; fires `enqueueEmbedding` |
| POST | `/cards/by-deck/:deckId/batch` | `{cards: [...] minItems 1 maxItems 100}` | `{created:n, cards}`; one transaction + `embedCardBatch` |
| DELETE | `/cards/by-deck/:deckId/batch` | `{cardIds: uuid[] minItems 1 maxItems 200}` | `{deleted:n}` — all-or-nothing count check |
| PATCH | `/cards/by-deck/:deckId/reorder` | `{cardIds: uuid[] minItems 1}` | `{reordered:n}` |
| PATCH | `/cards/:id` | `{fieldValues: [...]}` | upsert on `(cardId, templateFieldId)`; re-embeds |
| DELETE | `/cards/:id` | — | `{success:true}` |

A non-numeric `cursor` becomes `NaN` — `import-export.routes.ts` is the module that validates params properly; prefer that pattern.

## card-templates (5)

| Method | Path | Notes |
|---|---|---|
| GET | `/card-templates` | cached system templates ++ this user's |
| GET | `/card-templates/:id` | **NO OWNERSHIP CHECK** — any authenticated user can read any template |
| POST | `/card-templates` | `{name, description?, fields:[{name, fieldType, side, sortOrder, isRequired?, config?}]}`; `isSystem` forced false |
| PUT | `/card-templates/:id` | `fields` array **replaces all rows** · 422 `Cannot modify system templates` |
| DELETE | `/card-templates/:id` | `{deleted:true}` · 422 `Cannot delete system templates` / `Cannot delete template that is in use by decks. Reassign decks first.` |

System templates are cached in-process on first `listAvailable` and only cleared by `invalidateSystemTemplatesCache()`, which has **no production caller** (only the test suite calls it) — altering them at runtime needs a restart.

## study (18)

| Method | Path | Query / body | Response |
|---|---|---|---|
| GET | `/study/deck/:deckId` | `mode=all` bypasses the due filter | `{cards:[{…, fields, progress}], total, due}` |
| GET | `/study/deck/:deckId/schedule` | — | `{totalCards, learnedCards, upcoming[], dueSoon, nextReviewDate}` — **`dueSoon` omitted when `totalCards === 0`** |
| GET | `/study/streak` | tz-aware | `{currentStreak, longestStreak, totalStudyDays, studiedToday}` |
| GET | `/study/activity` | `days` 1..365 (default 90), tz-aware | `{activity:[{studyDate, cardsReviewed}], days}` |
| GET | `/study/stats` | — | `{totalCardsReviewed, totalStudyDays}` |
| GET | `/study/dashboard-snapshot` | tz-aware | `{streak, activity (91 d hardcoded), stats, dueDecks[]}` — no web consumer since the command center shipped |
| POST | `/study/review` | `{cardId: uuid, action}` | **SM-2 ONLY** — ignores `users.srs_algorithm` |
| POST | `/study/review-batch` | `{items:[{cardId, action}] 1..100}` | `{reviewed:n}` — the only algorithm-aware path |
| POST | `/study/deck/:deckId/reset-progress` | — | `{reset:n}` |
| POST | `/study/card/:cardId/reset-progress` | — | `{reset:true}` |
| POST | `/study/interleaved` | `{deckIds: uuid[1..20], limit?: 1..200 default 50}` | `{cards, total, due}` — `total` is capped at `limit*2`, not the true due count |
| GET | `/study/interleaved/auto` | `topN` 1..20 (5), `limit` 1..200 (50) | `{cards, total, due, deckIds}` |
| GET | `/study/forecast` | `days` 1..90 (default 14) | `{forecast:[{date, atRiskCount, avgRetention}]}` |
| GET | `/study/retention-heatmap` | `deckId` required | `{cards:[…]}` sorted retention ASC; returns `{cards:[]}` (not 404) for a foreign deck |
| GET | `/study/at-risk-cards` | `threshold` 0.1..1.0 (0.8), `limit` 1..100 (20) | `{atRisk[], total}` |
| GET | `/study/recommendations/:cardId` | `limit` 1..20 (5) | `{related:[{…, source:'link'\|'semantic'}]}` |
| GET | `/study/algorithm` | — | `{algorithm:'sm2'\|'fsrs'}` |
| PATCH | `/study/algorithm` | `{algorithm:'sm2'\|'fsrs'}` | `{algorithm}` |

`action` is `'again' | 'hard' | 'good' | 'easy'`. Only `/streak`, `/activity`, `/dashboard-snapshot`, `/review` and `/review-batch` read `x-timezone-offset`.

There is **no `GET /study/smart-groups`**, yet `apps/web/src/components/dashboard/smart-groups-widget.tsx:20` calls it — that component is itself never mounted. `getSmartGroups` is reachable only through the `experience` module.

## ai (6)

| Method | Path | Body / query | Notes |
|---|---|---|---|
| POST | `/ai/generate` | `{deckId: uuid, sourceText: 10..10_000, backLanguage?: 'vi'\|'en'}` | 20/min per IP + 30/hr per user; returns `{jobId, status}` immediately. There is **no** `cardCount` request field — `ai_generation_jobs.cardCount` is a DB column written after generation |
| GET | `/ai/jobs` | `status?` whitelisted against the 5 values | unknown values silently ignored |
| GET | `/ai/jobs/:jobId` | — | poll target (web polls every 2 s) |
| POST | `/ai/jobs/:jobId/save` | per-card fields | 409 `Job has already been saved or expired` unless status is `pending` |
| POST | `/ai/check-duplicates` | `{threshold?: 0.5..1.0 default 0.85}` | pgvector; 422 if the embedding column is absent |
| POST | `/ai/deck-duplicates` | — | exact-word scan, **no embeddings** |

## embedding (2)

`GET /embedding/status` → counts `DISTINCT card_id` **globally, not scoped to the user** · `POST /embedding/backfill` → returns `{started:true, …}` immediately, work is un-awaited and its rejection swallowed

## search (1)

`GET /search` — query `q` (minLength 1), `limit` 1..50 (default 20), `deckId?`. Semantic (cosine, threshold 0.4) with an ILIKE fallback on error **or** zero hits. Limit-only pagination — no offset or cursor. **Not called anywhere in `apps/web`**; the deck-view search box uses `/cards/by-deck/:deckId/search`.

## knowledge-graph (7)

`POST /knowledge-graph/links` `{sourceCardId, targetCardId, linkType?: 'related'}` → idempotent (`onConflictDoNothing` + re-select) · `DELETE /knowledge-graph/links/:id` → **verifies only the source card's owner** · `GET /knowledge-graph/cards/:id/links` · `GET /knowledge-graph/decks/:id/graph` (nodes/edges + retention overlay) · `GET /knowledge-graph/search` (escapes `%`/`_`) · `POST /knowledge-graph/ai/detect` `{deckId: uuid, threshold?: 0.5..1.0 default 0.75}` · `POST /knowledge-graph/ai/dismiss` — **one of only three module routes that query the DB inline in the handler** (the others are `GET`/`PATCH /study/algorithm`; `GET /health` in `index.ts` also does)

## import-export (2) — no prefix

`POST /import/csv/:deckId` — dual body: `{csv: string}` or a file upload; **2 MB cap** (checked as JS string length for the string path, real bytes for the upload path — not equivalent for non-ASCII); 10 000 data-row cap → 422. Columns map to template fields by **lowercased name**, not position; zero matches → 422 listing expected names.

`GET /export/:deckId` — `?format=csv|json`. CSV sets `Content-Type: text/csv; charset=utf-8` and `Content-Disposition: attachment; filename="<sanitized>.csv"`. JSON returns `{deckName, fields, cards}` — the route discards the service's `deckName`/`cardCount` wrapper.

## notifications (2)

`GET /notifications/due-decks` (cap `NOTIFICATIONS.MAX_DUE_DECKS` = 50) · `GET /notifications/due-count`

Derived live from `cards` + `decks` + `study_progress`; a missing progress row counts as due. **No notifications table exists.**

## feedback (1)

`POST /feedback` `{type: 'bug'|'feature'|'general', subject, message: minLength 1, contactEmail?}` → always `{success:true}`, even when SMTP is unconfigured. **`type` is required** — omitting it is a 422. No service file; the route calls `sendFeedbackEmail` fire-and-forget. `subject` is `t.String()` with no length bound and is interpolated into HTML **unescaped**.

## experience (8) — no prefix, no `t` schemas

See [experience-bff.md](experience-bff.md) for envelope semantics and section keys.

| Method | Path | Wrapper | Notes |
|---|---|---|---|
| GET | `/dashboard/command-center` | envelope | 8 sections; `reviewQueue`, `streak`, `dueDecks` **required** (a failure 500s the whole dashboard) |
| GET | `/study/queue` | bare | 7 modes; `limit` clamped 1..200 (50); 422 missing scope id, 404 unknown/foreign scope |
| GET | `/library/explorer` | envelope | `classes` required, `recentDecks` optional (8 ids) |
| GET | `/decks/:id/workspace` | envelope | `deck`+`cards` required; `sort` is parsed then **ignored**; page 1+, pageSize 1..100 (50) |
| GET | `/insights/overview` | envelope | all 5 sections optional |
| GET | `/command/search` | bare | `q` required; 8/group, 20 default, 30 max, shared descending budget |
| POST | `/create/preview` | bare | manual/ai-paste/csv/json; 413 oversize; 15-min in-memory preview |
| POST | `/create/commit` | bare | idempotency-keyed; 409 for every conflict class |

`/study/queue` (experience) coexists with `/study/*` (study module prefix); `/decks/:id/workspace` sits next to `decksRoutes`' `/decks/*`. Adding a prefix would break `apps/web/src/lib/experience-api.ts`.
