# Engram Spira

An AI-powered flashcard web application with dual Spaced Repetition algorithms (SM-2 & FSRS), Knowledge Graph visualization, and semantic search — built on a modern, fully type-safe stack.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Bun (≥ 1.3) |
| Backend | ElysiaJS + Drizzle ORM |
| Database | PostgreSQL 15 + pgvector (Docker) |
| Frontend | SolidJS + TanStack Solid Query |
| Styling | TailwindCSS v4 |
| API Client | Elysia Eden Treaty (E2E type-safe) |
| Auth | Session-based (argon2 + oslo/crypto) |
| AI | Google Gemini (card generation + embeddings) |
| Graph | Cytoscape.js |

---

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.3
- [Docker](https://docker.com) + Docker Compose

---

## Quickstart

```bash
# 1. Clone and install
git clone <repo-url> && cd engram-spira
bun install

# 2. Configure environment
cp apps/api/.env.example apps/api/.env
# Edit apps/api/.env — see Environment Variables below

# 3. Start PostgreSQL
docker compose up -d

# 4. Run migrations
bun run db:migrate

# 5. Seed system templates + test user
bun run db:seed

# 6. Start dev servers
bun run dev
```

| Service | URL |
|---------|-----|
| Web | http://localhost:3002 |
| API | http://localhost:3001 |
| Health Check | http://localhost:3001/health |

**Test credentials:** `test@example.com` / `password123`

---

## Environment Variables

Create `apps/api/.env` from `apps/api/.env.example`:

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://postgres:postgrespassword@localhost:5435/flashcard_db` |
| `PORT` | API server port | `3001` |
| `NODE_ENV` | Environment | `development` |
| `FRONTEND_URL` | Frontend URL (used in emails) | `http://localhost:3002` |
| `ALLOWED_ORIGINS` | CORS allowlist (comma-separated) | `http://localhost:3002` |
| `GMAIL_USER` | Gmail address for email sending | `you@gmail.com` |
| `GMAIL_APP_PASSWORD` | Gmail App Password (requires 2FA) | `xxxx xxxx xxxx xxxx` |
| `FEEDBACK_RECIPIENT` | Email for receiving feedback | `admin@example.com` |
| `GEMINI_API_KEY` | Google Gemini API key | `AIza...` |
| `GEMINI_MODEL` | Gemini model for card generation | `gemini-3-flash-preview` |
| `GEMINI_EMBEDDING_MODEL` | Gemini model for embeddings | `gemini-embedding-2-preview` |

---

## Project Structure

```
engram-spira/
├── docker-compose.yml
├── package.json                 # Monorepo root (Bun Workspaces)
├── apps/
│   ├── api/                     # Backend — ElysiaJS
│   │   └── src/
│   │       ├── index.ts         # Entry point, route mounting, error handling
│   │       ├── config/          # Environment, AI client config
│   │       ├── db/              # Drizzle schema (16 tables), migrations, seed
│   │       ├── modules/         # 15 feature modules (see below)
│   │       ├── plugins/         # Logger plugin
│   │       ├── shared/          # Constants, errors, logger
│   │       └── types/           # Type definitions
│   └── web/                     # Frontend — SolidJS + Vite
│       └── src/
│           ├── pages/           # Route pages (12)
│           ├── components/      # UI components (dashboard, study, focus, search...)
│           ├── stores/          # Signal-based state (auth, theme, focus, sidebar...)
│           ├── api/             # Eden Treaty client setup
│           └── lib/             # Utilities
├── packages/
│   ├── shared/                  # Shared TypeScript types
│   └── browser-extension/       # Browser extension (experimental)
└── docs/
    ├── srs/                     # Software Requirements Specification
    └── c4/                      # C4 architecture diagrams (Structurizr DSL)
```

### Backend Modules

```
modules/
├── auth/              # Register, login, logout, email verification, password reset
├── users/             # Profile management
├── classes/           # CRUD — Class (subject)
├── folders/           # CRUD — Folder (chapter)
├── decks/             # CRUD — Deck (flashcard set)
├── cards/             # CRUD — Card, drag-and-drop reorder
├── card-templates/    # Custom card templates (Vocabulary, Q&A, custom)
├── study/             # SRS engines (SM-2 + FSRS), review, forecast, analytics
├── ai/                # Gemini card generation, duplicate detection
├── embedding/         # Vector embedding pipeline (Gemini → pgvector)
├── search/            # Semantic search (embedding) + text fallback (ILIKE)
├── knowledge-graph/   # Card links, graph data, AI relationship detection
├── import-export/     # CSV import, CSV/JSON export
├── notifications/     # In-app notifications
└── feedback/          # User feedback
```

---

## Available Scripts

| Script | Description |
|--------|-------------|
| `bun run dev` | Start API + Web concurrently |
| `bun run dev:api` | API only |
| `bun run dev:web` | Web only |
| `bun run typecheck` | TypeScript check (API + Web) |
| `bun run db:generate` | Generate SQL migrations |
| `bun run db:migrate` | Apply migrations |
| `bun run db:push` | Push schema directly (no migration file) |
| `bun run db:seed` | Seed system templates + test user |
| `bun run db:studio` | Open Drizzle Studio |
| `bun run docs:sync` | Sync docs to `apps/web/public/docs/` |
| `bun run docs:export` | Export C4 diagrams to SVG (Docker required) |
| `bun run docs:c4` | Start Structurizr Lite UI |

---

## Content Hierarchy

```
Class (Subject)
└── Folder (Chapter)
    └── Deck (Flashcard Set)
        └── Card
            ├── Field Values (via Card Template)
            ├── Study Progress (SRS state)
            ├── Card Links (prerequisite / related)
            └── Card Concepts (AI-extracted)
```

---

## SRS Algorithms

Dual algorithm support — user selects in Settings.

### SM-2 (SuperMemo 2)

Adaptive intervals: `interval(n+1) = interval(n) × easeFactor`

| Action | Effect |
|--------|--------|
| **Again** | Reset to start, review again in 10 min |
| **Hard** | Interval grows slowly |
| **Good** | Interval grows normally |
| **Easy** | Interval grows fast with bonus |

### FSRS (Free Spaced Repetition Scheduler)

Uses `ts-fsrs` — tracks stability + difficulty per card.

States: `New → Learning (1m → 15m) → Review → Relearning`

### Study Mode Shortcuts

`Space` (flip) · `1` (Again) · `2` (Hard) · `3` (Good) · `4` (Easy)

---

## Key Features

- **AI Card Generation** — Paste text → Gemini generates flashcards (Vocabulary or Q&A mode)
- **Semantic Search** — Embedding-based search via pgvector cosine similarity
- **Knowledge Graph** — Interactive graph visualization of card relationships (Cytoscape.js)
- **Duplicate Detection** — Embedding similarity identifies duplicate cards (≥ 85%)
- **Study Analytics** — Retention forecast, heatmap, at-risk detection, smart groups
- **Focus Mode** — Timer, ambient sounds, 3D dice rewards (Three.js)
- **Import/Export** — CSV import, CSV + JSON export
- **Interleaved Study** — Review across multiple decks simultaneously

---

## License

Private — All rights reserved.
