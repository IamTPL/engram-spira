# Engram Spira

A high-performance flashcard web application using Spaced Repetition (SRS). Clean, fast, and minimalist — modeled after Quizlet with a bleeding-edge tech stack.

---

## Tech Stack

| Layer      | Technology                           |
| ---------- | ------------------------------------ |
| Runtime    | Bun                                  |
| Backend    | ElysiaJS + Drizzle ORM               |
| Database   | PostgreSQL 15 (Docker)               |
| Frontend   | SolidJS + TanStack Query             |
| Styling    | TailwindCSS v4                       |
| API Client | Elysia Eden Treaty (E2E type-safe)   |
| Auth       | Custom session-based (argon2 + oslo) |

---

## Prerequisites

- [Bun](https://bun.sh) >= 1.3
- [Docker](https://docker.com) + Docker Compose

---

## Quickstart

```bash
# 1. Clone and install dependencies
git clone <repo-url> && cd engram_spira
bun install

# 2. Copy and fill in environment variables
cp apps/api/.env.example apps/api/.env
# Edit apps/api/.env with your values

# 3. Start PostgreSQL
docker-compose up -d

# 4. Run database migrations
bun run db:migrate

# 5. Seed system templates + test user
bun run db:seed

# 6. Start development servers (API + Web)
bun run dev
```

The app will be available at:

- **Web:** http://localhost:3000
- **API:** http://localhost:3001

**Test credentials:** `test@example.com` / `password123`

---

## Environment Variables

Create `apps/api/.env` based on `apps/api/.env.example`:

| Variable       | Description                  | Example                                                              |
| -------------- | ---------------------------- | -------------------------------------------------------------------- |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://postgres:postgrespassword@localhost:5435/flashcard_db` |
| `PORT`         | API server port              | `3001`                                                               |
| `NODE_ENV`     | Environment                  | `development`                                                        |

---

## Project Structure

```
engram_spira/
├── docker-compose.yml          # PostgreSQL container
├── package.json                # Monorepo root scripts
├── apps/
│   ├── api/                    # Backend (ElysiaJS)
│   │   ├── .env.example
│   │   └── src/
│   │       ├── index.ts        # App entry + route mounting
│   │       ├── db/             # Drizzle config, schema, seed
│   │       └── modules/        # auth, classes, folders, decks, cards, study
│   └── web/                    # Frontend (SolidJS)
│       └── src/
│           ├── pages/          # Route pages
│           ├── components/     # UI components + layout
│           └── stores/         # Auth + Toast state
└── packages/
    └── shared/                 # Shared types (stub)
```

---

## Available Scripts

| Script                | Description                                      |
| --------------------- | ------------------------------------------------ |
| `bun run dev`         | Start API + Web concurrently                     |
| `bun run dev:api`     | API only                                         |
| `bun run dev:web`     | Web only                                         |
| `bun run db:generate` | Generate SQL migrations                          |
| `bun run db:migrate`  | Apply migrations                                 |
| `bun run db:seed`     | Seed system templates + test user                |
| `bun run db:studio`   | Open Drizzle Studio                              |
| `bun run docs:sync`   | Sync doc files into `apps/web/public/docs/`      |
| `bun run docs:export` | Export C4 diagrams to SVG automatically (requires Docker) |
| `bun run docs:c4`     | Start Structurizr Lite UI (for browsing/editing DSL)      |

---

## Updating Documentation

### SRS Document (`docs/srs/srs.md`)

Edit the markdown file, then sync it to the frontend:

```bash
bun run docs:sync
```

The live docs page at `/docs` will reflect the changes on next page load.

### C4 Architecture Diagrams (`docs/c4/workspace.dsl`)

Prerequisites: Docker

```bash
# 1. Edit the DSL source
vim docs/c4/workspace.dsl

# 2. Export all 4 diagrams to SVG automatically (one command)
bun run docs:export

# 3. Commit
git add docs/c4/workspace.dsl apps/web/public/docs/c4/
git commit -m "docs(c4): update architecture diagrams"
```

> The export pipeline runs two Docker containers internally:
> `structurizr/cli` (DSL → PlantUML) + `plantuml/plantuml` (PlantUML → SVG)
> No manual browser interaction needed.

> **View docs:** Log in → click avatar → **Docs** (`/docs`)

---

## Content Hierarchy

```
Class (Subject/Môn học)
└── Folder (Chapter/Chương)
    └── Deck (Flashcard Set/Bộ thẻ)
        └── Cards
```

---

## SRS System

Implements a Leitner-style spaced repetition system:

| Action    | Interval                      |
| --------- | ----------------------------- |
| **Again** | +10 minutes                   |
| **Hard**  | +1 day                        |
| **Good**  | Level-based: 1→3→7→14→30 days |

Keyboard shortcuts in study mode: `Space` (flip), `1` (Again), `2` (Hard), `3` (Good)
