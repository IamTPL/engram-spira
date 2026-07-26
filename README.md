# Engram Spira

An AI-powered flashcard web application with dual Spaced Repetition algorithms (SM-2 & FSRS), Knowledge Graph visualization, and semantic search — built on a modern, fully type-safe stack.

> 📋 **[Final Report (Notion)](https://www.notion.so/Engram-Sprira-32ab6b1ad239801e806bf5823945fca2?source=copy_link)**

> 📋 **[Final Project Presentation (Google Drive)](https://drive.google.com/drive/folders/1q60L_ZoM9F-V06xrYQDP4GPO1R8qcHyh?usp=sharing)**


---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Bun 1.3.10 |
| Backend | ElysiaJS 1.4 + Drizzle ORM 0.45 |
| Database | PostgreSQL 15 + pgvector (`pgvector/pgvector:pg15`, Docker) |
| Frontend | SolidJS 1.9 + TanStack Solid Query 5 |
| Styling | TailwindCSS v4 (CSS-first config in `apps/web/src/app.css`) |
| UI primitives | Kobalte + class-variance-authority (shadcn-style) |
| API Client | Elysia Eden Treaty (E2E type-safe) |
| Auth | Session cookie (argon2 + `@oslojs/crypto`) |
| AI | Google Gemini (card generation + 768-dim embeddings) |
| Graph | Cytoscape.js |
| TypeScript | 5.9.3 |

---

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.3 (developed on 1.3.10)
- [Docker](https://docker.com) + Docker Compose

---

## Quickstart

```bash
# 1. Clone and install
git clone <repo-url> && cd engram-spira
bun install

# 2. Configure environment
cp apps/api/.env.example apps/api/.env
# IMPORTANT: the example file sets GEMINI_EMBEDDING_MODEL=gemini-embedding-2-preview,
# but the value the code is written against is gemini-embedding-001. Fix it after copying.

# 3. Start PostgreSQL  (starts only the `db` service)
docker compose up -d

# 4. Run migrations
bun run db:migrate

# 5. Seed system templates + test user
bun run db:seed

# 6. Start dev servers
bun run dev
```

| Service | URL / port |
|---------|-----|
| Web (Vite dev) | http://localhost:3002 |
| API | http://localhost:3001 |
| Health check | http://localhost:3001/health |
| Vite preview | http://localhost:4173 |
| PostgreSQL | `localhost:5435` → 5432 in-container |
| Structurizr Lite (`bun run docs:c4`) | http://localhost:8080 |

**Test credentials:** `test@example.com` / `password123`

> `bun run dev` uses `--filter '*'`, so it starts **three** watchers: the API, the web dev server, and the browser-extension bundler.
>
> `DATABASE_URL` is validated for *presence* only. If Postgres is not running, the API still logs "server running" and then floods `CONNECT_TIMEOUT localhost:5435`.

---

## Environment Variables

Create `apps/api/.env` from `apps/api/.env.example`. **Only `DATABASE_URL` is required** — everything else has an inline default, and a missing Gemini or Gmail key fails lazily at first use rather than at startup.

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string — **required** | none |
| `PORT` | API server port | `3001` |
| `NODE_ENV` | Must be exactly `production` to enable the CORS allowlist and a `Secure` cookie | `development` |
| `FRONTEND_URL` | Used only to build email links | `http://localhost:3002` |
| `ALLOWED_ORIGINS` | CORS allowlist (comma-separated) | `http://localhost:3002` |
| `GMAIL_USER` | Gmail address for sending mail | `''` |
| `GMAIL_APP_PASSWORD` | Gmail App Password (requires 2FA) | `''` |
| `FEEDBACK_RECIPIENT` | Where feedback mail is delivered | a hardcoded address — override it |
| `GEMINI_API_KEY` | Google Gemini API key | `''` (AI features disabled) |
| `GEMINI_MODEL` | Model for card generation | `gemini-3-flash-preview` |
| `GEMINI_EMBEDDING_MODEL` | Model for embeddings — must return 768 dimensions | `gemini-embedding-001` |
| `LOG_LEVEL` | Pino level (read directly, not part of `ENV`) | `debug` dev / `info` prod |
| `AVATARS_DIR` | Directory served as `/ava_colect/*` | `apps/web/public/ava_colect` |

Frontend config is separate — `apps/web/.env.example`:

| Variable | Description | Default |
|----------|-------------|---------|
| `VITE_API_URL` | API base URL, baked in at build time | `http://localhost:3001` |

`ENV.SESSION_MAX_AGE_DAYS` and `ENV.SESSION_REFRESH_THRESHOLD_DAYS` exist in `config/env.ts` but are **never read** — the live session timings come from `SESSION` in `apps/api/src/shared/constants.ts` (30-day cookie, 15-day sliding refresh).

---

## Project Structure

```
engram-spira/
├── docker-compose.yml           # db (pgvector) + structurizr (behind --profile docs)
├── package.json                 # Monorepo root (Bun Workspaces), 16 scripts
├── AGENTS.md                    # Engineering rules — read this before contributing
├── CLAUDE.md                    # Imports AGENTS.md + AI-assistant specifics
├── apps/
│   ├── api/                     # Backend — ElysiaJS  (91 routes)
│   │   ├── src/
│   │   │   ├── index.ts         # Bootstrap: CORS, security headers, the single
│   │   │   │                    #   onError, /health, 16 route mounts, `export type App`
│   │   │   ├── config/          # env.ts (ENV) · ai.ts (Gemini client + per-user quota)
│   │   │   ├── db/              # Drizzle schema (18 tables), 24 migrations, seed
│   │   │   ├── modules/         # 16 feature modules (see below)
│   │   │   ├── plugins/         # Request-logger plugin
│   │   │   ├── shared/          # errors, constants, logger, email, embedding-utils
│   │   │   └── types/           # Type re-export barrel
│   │   └── __tests__/           # 24 test files (274 tests) + preload + helpers
│   └── web/                     # Frontend — SolidJS + Vite
│       └── src/
│           ├── app.tsx          # Router — 13 routes
│           ├── pages/           # 13 page components
│           ├── components/
│           │   ├── app-shell/   # Command-center shell (canonical)
│           │   ├── ui/          # 28 primitives (Kobalte + cva)
│           │   └── layout/      # Legacy — only page-shell.tsx is still used
│           ├── stores/          # 7 signal-based stores (auth, theme, focus...)
│           ├── api/             # Eden Treaty client + getApiError
│           ├── lib/             # query-client, experience-api, command-actions, utils
│           └── app.css          # Tailwind v4 config + all design tokens
├── packages/
│   ├── shared/                  # Constants package — currently imported by nothing
│   └── browser-extension/       # MV3 extension (experimental; needs icons/ to load)
├── scripts/                     # docs-export · docs-sync · erd-export · skills-update
└── docs/
    ├── agents/                  # ← Accurate, maintained developer/agent reference
    ├── srs/                     # Software Requirements Specification (stale)
    ├── c4/                      # C4 diagrams, Structurizr DSL (stale)
    ├── erd/                     # Mermaid ERD + rendered SVG (stale)
    ├── ui/                      # Design-system spec (superseded by app.css)
    └── dev_prompt/              # Historical plans and audits (do not cite)
```

### Backend Modules

```
modules/
├── auth/              # Register, login, logout, email verification, password reset
├── users/             # Profile (displayName, avatarUrl) + built-in avatar list
├── classes/           # CRUD — Class (subject) + reorder
├── folders/           # CRUD — Folder (chapter) + reorder
├── decks/             # CRUD — Deck (flashcard set) + move between folders
├── cards/             # CRUD — Card, batch create/delete, reorder, in-deck search
├── card-templates/    # System (Vocabulary, Basic Q&A) + user-defined field schemas
├── study/             # Dual SRS (SM-2 + FSRS), review, streak, forecast, analytics
├── ai/                # Gemini card generation + job queue, duplicate detection
├── embedding/         # 768-dim embedding pipeline (Gemini → pgvector)
├── search/            # Semantic search (cosine) + text fallback (ILIKE)
├── knowledge-graph/   # Card links, deck graph, AI relationship detect/dismiss
├── import-export/     # CSV import (≤ 2 MB), CSV/JSON export
├── notifications/     # Due-deck list + badge count (derived; no table)
├── feedback/          # Feedback email via Nodemailer/Gmail SMTP
└── experience/        # Command-center aggregates (BFF): dashboard, study queue,
                       #   library explorer, deck workspace, insights, command search
```

---

## Available Scripts

| Script | Description |
|--------|-------------|
| `bun run dev` | Start API + Web + browser-extension watchers |
| `bun run dev:api` | API only |
| `bun run dev:web` | Web only |
| `bun run typecheck` | TypeScript check (API + Web) — **the only thing CI runs** |
| `bun run db:migrate` | Apply pending migrations (**the default**) |
| `bun run db:generate` | Generate a migration from the schema — always review the SQL by hand |
| `bun run db:push` | Force-sync the DB to the schema. **Destructive**: drops the pgvector column, its HNSW index and all partial indexes |
| `bun run db:drop` | Interactively delete a migration *file* + snapshot + journal entry |
| `bun run db:reset` | `db:drop && db:push` — **misnamed and destructive**, avoid |
| `bun run db:seed` | Seed system templates + test user (idempotent) |
| `bun run db:studio` | Open Drizzle Studio |
| `bun run docs:sync` | Copy `docs/srs/srs.md` into `apps/web/public/docs/` |
| `bun run docs:export` | Export C4 diagrams to SVG (**Docker required**) |
| `bun run docs:erd` | Render the ERD via kroki.io (**network required**) |
| `bun run docs:c4` | Start Structurizr Lite UI on :8080 |
| `bun run skills:update` | Hashes every `.agents/skills/<name>/SKILL.md` and merges the result into `skills-lock.json` (adds/updates matched entries; never deletes ones with no matching directory). Run it after adding or editing a skill |

There is no linter, formatter, or git hook in this repo. Match the surrounding style by eye: 2-space indent, single quotes, semicolons, trailing commas.

---

## Testing

Bun's built-in runner (`bun:test`) with all I/O mocked — no test database.

```bash
cd apps/api && bun test        # 274 tests in 24 files
cd apps/api && bun test --coverage
cd apps/web && bun test        # 16 tests in 4 files
```

| Scope | Files | Tests | Status |
|-------|-------|-------|--------|
| `apps/api` | 24 | 274 (576 assertions) | 271 pass / **3 fail** — pre-existing, see below |
| `apps/web` | 4 | 16 | all pass |

> **Run API tests from `apps/api`.** `apps/api/bunfig.toml`'s preload is CWD-relative; from the repo root it never loads and 15 tests silently disappear behind a `DATABASE_URL` error.
>
> `apps/web` has **no `test` script** — the bare `bun test` runner is the only way to run its tests.

---

## Project status

Two things are broken on `master` and are **not** caused by your changes:

- **`bun run typecheck` fails** with 22 errors in `apps/web` (`@engram/api` is clean). All 22 are Eden Treaty inference failures with a single root cause: `apps/api/src/modules/experience/experience.routes.ts` types its handler contexts as `any` and declares no Elysia `t` schemas, which collapses the exported `App` type. Since typecheck is CI's only job, **CI is red**. (`bun run build` still succeeds — Vite does not typecheck.)
- **3 API tests fail.** Two are cross-file `mock.module` leakage from `kg.service.test.ts` (they pass in isolation); one is a fixture with hardcoded 2026-06 dates that have since passed.

Both are catalogued with evidence and fix guidance in **[docs/agents/known-issues.md](docs/agents/known-issues.md)**.

---

## Content Hierarchy

```
Class (Subject)
└── Folder (Chapter)
    └── Deck (Flashcard Set)          — bound to one Card Template
        └── Card
            ├── Field Values (via Card Template) + 768-dim embedding
            ├── Study Progress (SM-2 and/or FSRS state, per user)
            ├── Card Links (knowledge graph — `related`)
            └── Card Concepts (table exists; nothing populates it yet)
```

`decks.user_id` is a denormalized copy of the owning user, so ownership checks are a single index lookup rather than a three-table join.

---

## SRS Algorithms

Dual algorithm support, stored per user in `users.srs_algorithm` and switchable in Settings (`GET`/`PATCH /study/algorithm`).

### SM-2 (SuperMemo 2)

Ease factor starts at 2.5 and is floored at 1.3.

| Action | Ease factor | Interval |
|--------|-------------|----------|
| **Again** | −0.20 | reset to 0; review again in 10 min |
| **Hard** | −0.15 | `max(interval + 1, round(interval × 1.2))` |
| **Good** | unchanged | 1 d → 6 d → `round(interval × easeFactor)` |
| **Easy** | +0.15 (no upper clamp) | 4 d → 8 d → `round(interval × updatedEaseFactor × 1.3)` |

All-Good progression from a new card: 1 d → 6 d → 15 d → 38 d.

### FSRS (Free Spaced Repetition Scheduler)

Uses `ts-fsrs` 5.2.3 (which implements **FSRS-6**), tracking stability + difficulty per card.

States: `New → Learning (1m → 15m) → Review → Relearning`

> Only `POST /study/review-batch` honours the user's algorithm choice. The single-card `POST /study/review` endpoint is SM-2-only. The web client uses review-batch exclusively.

### Study Mode Shortcuts

`Space` (flip) · `1` (Again) · `2` (Hard) · `3` (Good) · `4` (Easy)

---

## Key Features

- **Command Center** — Aggregate dashboard, resizable library explorer, context panel and a `Ctrl`/`Cmd`+`K` command palette, served by dedicated BFF endpoints
- **AI Card Generation** — Paste text → Gemini generates flashcards (Vocabulary or Q&A mode, auto-detected from the deck's template) via a background job queue
- **Semantic Search** — pgvector cosine similarity with an ILIKE text fallback
- **Knowledge Graph** — Interactive visualization of card relationships (Cytoscape.js) with AI-suggested links
- **Duplicate Detection** — Embedding similarity ≥ 85%, plus an exact-word deck scan
- **Study Analytics** — Retention forecast, per-deck heatmap, at-risk detection, concept smart groups
- **Focus Mode** — Timer, ambient sounds, 3D dice rewards (Three.js)
- **Import/Export** — CSV import, CSV + JSON export
- **Interleaved Study** — Review across multiple decks simultaneously

---

## Contributing

Read **[AGENTS.md](AGENTS.md)** first — it holds the non-negotiable rules (error contract, ownership scoping, migration hazards, SolidJS conventions) and the commands that prove every count in this file.

Deep reference lives in **[docs/agents/](docs/agents/)**, one self-contained file per subsystem.

> The documents under `docs/srs/`, `docs/c4/`, `docs/erd/`, `docs/ui/` and `docs/dev_prompt/` were last updated 2026-03-21 or earlier and disagree with the code on counts, model names, endpoint paths and feature availability. They are kept for history — treat them as archaeology, never as specification.

---

## License

Private — All rights reserved.
