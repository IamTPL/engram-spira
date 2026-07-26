# Orientation

## What this is

A spaced-repetition flashcard application. Users organise content as **Class → Folder → Deck → Card**, where each deck is bound to a **card template** that defines the card's fields. Cards are scheduled by one of two SRS algorithms (SM-2 or FSRS, chosen per user), embedded into pgvector for semantic search and duplicate detection, and linked into a knowledge graph. Google Gemini generates cards from pasted text and proposes card relationships.

## Monorepo layout

Bun workspaces: `apps/*`, `packages/*`. No build system beyond Bun and Vite.

```
apps/
  api/                 @engram/api — ElysiaJS server, single process
    src/
      index.ts         THE bootstrap: Elysia chain, CORS, security headers, onError,
                       /health, 16 route mounts, background intervals, `export type App`
      config/          env.ts (ENV object) · ai.ts (Gemini client + per-user quota)
      db/              index.ts (postgres.js pool + Drizzle) · schema/ (18 tables)
                       migrations/ (24 .sql + meta/) · seed.ts
      modules/         16 feature modules — see below
      plugins/         logger.plugin.ts (request logging)
      shared/          errors.ts · constants.ts · logger.ts · email.ts · embedding-utils.ts
      types/           2-line re-export barrel
    __tests__/         24 test files + preload.ts + helpers/
  web/                 @engram/web — SolidJS SPA (Vite)
    src/
      index.tsx        entry: removes the HTML loading shell, then render()
      app.tsx          Router: 13 routes, ProtectedRoute/GuestRoute, AppShell
      api/client.ts    Eden Treaty client + getApiError()
      components/
        app-shell/     CANONICAL shell (12 files) — command bar, task rail,
                       library explorer, context panel, mobile nav
        layout/        LEGACY — only page-shell.tsx is live; the rest is dead code
        ui/            28 primitives (Kobalte + cva + tailwind-merge)
        …             dashboard/ deck-view/ flashcard/ focus/ search/ study/ templates/
      lib/             query-client · experience-api · command-actions · utils (cn) · virtual-list
      pages/           13 page components
      stores/          7 module-scope signal stores
      app.css          Tailwind v4 CSS-first config — the ONLY design-token source
packages/
  shared/              @engram/shared — 11 exports, ZERO importers (inert; see below)
  browser-extension/   MV3 Chrome extension; cannot load as-is (missing icons)
scripts/               docs-export · docs-sync · erd-export · skills-update (broken)
docs/                  20 files, almost all stale — see README.md in this folder
```

### The 16 API modules

| Module | Owns |
|---|---|
| `auth` | register, login, logout, email verification, password reset, change password |
| `users` | profile (displayName, avatarUrl) + built-in avatar list |
| `classes` | Class CRUD + reorder |
| `folders` | Folder CRUD + reorder |
| `decks` | Deck CRUD + move between folders |
| `cards` | Card CRUD, batch create/delete, reorder, in-deck search |
| `card-templates` | System (`Vocabulary`, `Basic Q&A`) + user-defined field schemas |
| `study` | Dual SRS engines, review, streak, activity, forecast, heatmap, at-risk, interleaved |
| `ai` | Gemini card generation + job queue, duplicate detection |
| `embedding` | 768-dim Gemini embeddings → pgvector; status + backfill |
| `search` | Semantic search (cosine) with ILIKE text fallback |
| `knowledge-graph` | Card links, deck graph, AI relationship detect/dismiss |
| `import-export` | CSV import (≤2 MB), CSV/JSON export |
| `notifications` | Due-deck list + badge count (derived — **no notifications table**) |
| `feedback` | Feedback email via Nodemailer/Gmail (no service file) |
| `experience` | Command-center aggregates (BFF) — the newest layer, see [experience-bff.md](experience-bff.md) |

Most modules are just `<name>.routes.ts` + `<name>.service.ts`, but the larger ones split further — `experience/` has 12 files, `study/` 7, `ai/` 5, `auth/` and `knowledge-graph/` 4 — with extra `*.service.ts` files plus engines (`srs.engine.ts`, `fsrs.engine.ts`), prompts (`qa.prompt.ts`), middleware (`auth.middleware.ts`), helpers and types. There is no controller, repository, or DI layer.

## Request lifecycle

```
browser
  └─ apps/web/src/api/client.ts        Eden Treaty; credentials:'include';
                                       injects x-timezone-offset on EVERY request
  └─ cross-origin fetch → :3001        (absolute URL from VITE_API_URL — the Vite
                                        /api proxy is dead config, see frontend.md)
       ▼
apps/api/src/index.ts
  1. requestLoggerPlugin               derive({as:'global'}): _requestId, _startTime;
                                       logs "Started" — 2 log lines per request
  2. cors()                            prod: ENV.ALLOWED_ORIGINS
                                       else: /^http:\/\/localhost:\d+$/ + that list
                                       allowedHeaders: Content-Type, Authorization,
                                                       x-timezone-offset  (exactly 3)
  3. onAfterHandle                     4 security headers — on RETURNED responses only,
                                       never on thrown errors (so /health's 503 gets
                                       them; a 401/422/500 from onError does not)
  4. onError                           THE status mapping (see api-conventions.md)
  5. GET /health                       public; SELECT 1; 200 ok / 503 degraded
  6. 16 route plugins                  auth, classes, folders, decks, card-templates,
                                       cards, study, notifications, feedback, users,
                                       import-export, ai, embedding, search, kg, experience
       ▼
  <module>.routes.ts
     .use(requireAuth)                 scoped derive → currentUser, currentSession
                                       ONLY routes chained after this are protected
     t.Object(...) validation           → VALIDATION error → 422
       ▼
  <module>.service.ts                  takes userId explicitly; scopes every query;
                                       throws AppError subclasses
       ▼
  Drizzle (db) / raw postgres.js (pgClient, pgvector only)
```

`export type App = typeof app` on the last line of `index.ts` is the whole type-safety contract. `apps/web` imports it by **relative source path** (`../../../api/src/index`), not as a package.

## Verified inventory

Counts proven by shell command; re-verify rather than trusting this table (`AGENTS.md` §1 has the commands).

| | Count |
|---|---|
| API modules | 16 |
| HTTP routes | 90 in modules + `GET /health` = **91** |
| Postgres tables | 18 |
| SQL migrations | 24 (`0000`–`0023`); only **12** drizzle snapshots |
| API source files | 82 `.ts` |
| API tests | 274 in 24 files (271 pass / 3 fail, 576 assertions) |
| Web source files | 111 `.ts`/`.tsx` |
| Web routes / page components | 13 / 13 |
| Web components | 60 `.tsx`, of which 28 are `components/ui/` |
| Web stores | 7 |
| Web tests | 16 in 4 files |
| Error classes | 8 (`AppError` + 7 subclasses) |

### Content hierarchy

```
Class (subject)                 classes.user_id
└── Folder (chapter)            folders.class_id
    └── Deck (flashcard set)    decks.folder_id + decks.user_id (denormalized!)
        │                       decks.card_template_id → the field schema
        └── Card                cards.deck_id
            ├── Field values    card_field_values (jsonb) + embedding vector(768) [DB-only]
            ├── SRS state       study_progress (one row per user × card)
            ├── Links           card_links (source/target, knowledge graph)
            └── Concepts        card_concepts (read-only — nothing inserts rows)
```

`decks.user_id` is a **denormalized** copy of `classes.user_id`, added so ownership is one index lookup instead of a three-table join. Nothing in the database enforces it — any code that reparents a deck must preserve `decks.user_id == folders → classes.user_id`.

## Things that are not what they look like

- **`packages/shared` is inert.** It exports 11 symbols but has **zero importers**; no app declares it as a dependency and `node_modules/@engram/` is empty, so `import from '@engram/shared'` would not even resolve. Its constants are duplicated in `apps/api/src/shared/constants.ts` and `apps/web/src/constants/index.ts`. Do not "fix" an import that never existed.
- **Two shells coexist in `apps/web`.** `components/app-shell/` is canonical; `components/layout/{header,sidebar,mobile-nav}.tsx` and `layout/sidebar/*` are dead.
- **`notifications` has no table** — due counts are derived live from `cards` + `decks` + `study_progress`.
- **`card_concepts` is read-only** — smart groups and the study queue read it, but no code path ever inserts, so those features return empty on a fresh database.
- **`fsrs_user_params` is read-only** — no endpoint or job writes it. There is no parameter-optimizer feature.
- **`import-export` and `experience` register no route prefix**, so their paths sit at the API root and coexist with prefixed modules (`/study/queue` from `experience` next to `/study/*` from `study`).

## Deployment

There is none yet, and nothing documents it: **no Dockerfile anywhere**, `docker-compose.yml` provides only Postgres plus a docs-profile Structurizr, CI never applies migrations, nothing sets `TZ` (the streak math is only correct under `TZ=UTC`), and no reverse-proxy config exists to serve the built SPA or the `/ava_colect` avatar files that `users.service.ts` reads off the filesystem.
