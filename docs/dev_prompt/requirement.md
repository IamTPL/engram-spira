# Project Requirements Document: High-Performance SRS Flashcard App (Local-First Stack)

**Project Name:** Engram Spira
**Objective:** Full-stack, extreme-performance flashcard web application. "Clean, Fast, and Minimalist," modeled after Quizlet but optimized for speed using a bleeding-edge tech stack.

---

## 1. Tech Stack & Architecture

| Layer                         | Technology                                           | Version                                                   |
| ----------------------------- | ---------------------------------------------------- | --------------------------------------------------------- |
| **Runtime & Package Manager** | Bun                                                  | Latest (1.3+)                                             |
| **Architecture**              | Monorepo (Bun Workspaces)                            | `apps/*`, `packages/*`                                    |
| **Backend**                   | ElysiaJS                                             | ^1.4.x                                                    |
| **Communication**             | Elysia Eden Treaty                                   | ^1.4.x (E2E type safety, no codegen)                      |
| **Database**                  | PostgreSQL 15 (Docker)                               | `postgres:15-alpine`                                      |
| **ORM**                       | Drizzle ORM + Drizzle Kit                            | ^0.45.x / ^0.31.x                                         |
| **Auth**                      | Custom session-based (Lucia-style pattern)           | `@oslojs/crypto` + `@oslojs/encoding` + `@node-rs/argon2` |
| **Frontend**                  | SolidJS (Vite) + Solid Router                        | ^1.9.x / ^0.15.x                                          |
| **State Management**          | TanStack Query (Solid)                               | ^5.90.x                                                   |
| **Styling**                   | TailwindCSS v4 + custom UI components (shadcn-style) | ^4.2.x                                                    |
| **Icons**                     | Lucide-Solid                                         | ^0.575.x                                                  |
| **Build Tool**                | Vite                                                 | ^7.x                                                      |

### Architecture Notes

- **Auth pattern:** Custom implementation following Lucia Auth v3 design (SHA-256 hashed session tokens stored in DB, argon2 password hashing). Lucia Auth library itself is NOT used — the pattern is implemented directly for zero-dependency overhead.
- **UI Components:** Hand-rolled shadcn-style components using `class-variance-authority` + `clsx` + `tailwind-merge` for variant management. No `shadcn-solid` or `kobalte` dependency.
- **Shared Package:** `@engram/shared` (`packages/shared/`) — reserved for shared types/constants between API and Web (currently stub).

---

## 2. Infrastructure (Local Docker)

- **Requirement:** Local-only, no cloud providers. Single `docker-compose.yml` for database.
- **Configuration:**
  - Image: `postgres:15-alpine`
  - Container Name: `flashcard_db_container`
  - Port Mapping: `5435:5432` (host port **5435**, container port 5432)
  - User: `postgres`
  - Password: `postgrespassword`
  - DB Name: `flashcard_db`
  - Volume: `flashcard_db_data` (persistent data)
- **`DATABASE_URL`:** `postgresql://postgres:postgrespassword@localhost:5435/flashcard_db`
- **API Server:** Port `3001` (configurable via `PORT` env var)
- **Web Dev Server:** Port `3000` (Vite), proxies `/api` → `http://localhost:3001`

---

## 3. Database Schema (Drizzle)

Schema files located at `apps/api/src/db/schema/`. Uses a **template-based card system** (EAV pattern) for flexible card types instead of flat card columns.

**Entity Hierarchy:** `User → Class → Folder → Deck → Cards`

### Tables

1. **`users`** — [schema/users.ts](apps/api/src/db/schema/users.ts)
   - `id` (uuid, PK, auto-generated)
   - `email` (varchar 255, unique, NOT NULL)
   - `password_hash` (text, NOT NULL)
   - `created_at` (timestamptz, default NOW)
   - Relations: has many sessions, classes, cardTemplates, studyProgress

2. **`sessions`** — [schema/sessions.ts](apps/api/src/db/schema/sessions.ts)
   - `id` (text, PK — SHA-256 hash of session token)
   - `user_id` (uuid, FK → users.id, CASCADE)
   - `expires_at` (timestamptz, NOT NULL)
   - Index: `idx_sessions_user_id`

3. **`classes`** — [schema/classes.ts](apps/api/src/db/schema/classes.ts)
   - `id` (uuid, PK), `user_id` (uuid, FK → users.id, CASCADE)
   - `name` (varchar 255), `description` (text, nullable)
   - `created_at` (timestamptz)
   - Index: `idx_classes_user_id`

4. **`folders`** — [schema/folders.ts](apps/api/src/db/schema/folders.ts)
   - `id` (uuid, PK), `class_id` (uuid, FK → classes.id, CASCADE)
   - `name` (varchar 255), `created_at` (timestamptz)
   - Index: `idx_folders_class_id`

5. **`decks`** — [schema/decks.ts](apps/api/src/db/schema/decks.ts)
   - `id` (uuid, PK)
   - `user_id` (uuid, FK → users.id, CASCADE) — **denormalized** for O(1) ownership checks
   - `folder_id` (uuid, FK → folders.id, CASCADE)
   - `card_template_id` (uuid, FK → card_templates.id, NO CASCADE)
   - `name` (varchar 255), `created_at` (timestamptz)
   - Indexes: `idx_decks_user_id`, `idx_decks_folder_id`, `idx_decks_card_template_id`

6. **`card_templates`** — [schema/card-templates.ts](apps/api/src/db/schema/card-templates.ts)
   - `id` (uuid, PK)
   - `user_id` (uuid, FK → users.id, CASCADE — nullable for system templates)
   - `name` (varchar 255), `description` (text, nullable)
   - `is_system` (boolean, default false)
   - `created_at` (timestamptz)
   - Index: `idx_card_templates_user_id`

7. **`template_fields`** — [schema/card-templates.ts](apps/api/src/db/schema/card-templates.ts)
   - `id` (uuid, PK), `template_id` (uuid, FK → card_templates.id, CASCADE)
   - `name` (varchar 100), `field_type` (varchar 50), `side` (varchar 10: `front`/`back`)
   - `sort_order` (integer), `is_required` (boolean, default false)
   - `config` (jsonb, nullable — stores placeholder text, maxItems, etc.)
   - Unique: `(template_id, name)`. Index: `idx_template_fields_template_id`
   - Supported `field_type` values: `text`, `textarea`, `image_url`, `audio_url`, `json_array`

8. **`cards`** — [schema/cards.ts](apps/api/src/db/schema/cards.ts)
   - `id` (uuid, PK), `deck_id` (uuid, FK → decks.id, CASCADE)
   - `sort_order` (integer, default 0), `created_at` (timestamptz)
   - Index: `idx_cards_deck_id`

9. **`card_field_values`** — [schema/cards.ts](apps/api/src/db/schema/cards.ts)
   - `id` (uuid, PK)
   - `card_id` (uuid, FK → cards.id, CASCADE)
   - `template_field_id` (uuid, FK → template_fields.id, CASCADE)
   - `value` (jsonb, NOT NULL)
   - Unique: `(card_id, template_field_id)`. Index: `idx_cfv_card_id`

10. **`study_progress`** — [schema/study-progress.ts](apps/api/src/db/schema/study-progress.ts)
    - `id` (uuid, PK), `user_id` (uuid, FK → users.id, CASCADE)
    - `card_id` (uuid, FK → cards.id, CASCADE)
    - `box_level` (integer, default 0) — SM-2 repetition count
    - `ease_factor` (double precision, default 2.5) — SM-2 interval growth multiplier
    - `interval_days` (integer, default 1) — current scheduled interval in days
    - `next_review_at` (timestamptz, NOT NULL)
    - `last_reviewed_at` (timestamptz, nullable)
    - Unique: `(user_id, card_id)`. Composite index: `idx_sp_user_next_review(user_id, next_review_at)`

### System Seed Templates

Seeded via `bun run db:seed` ([db/seed.ts](apps/api/src/db/seed.ts)):

1. **Vocabulary** — 5 fields: `word` (front/text), `type` (front/text), `ipa` (front/text), `definition` (back/textarea), `examples` (back/json_array, max 5)
2. **Basic Q&A** — 2 fields: `question` (front/textarea), `answer` (back/textarea)

---

## 4. Business Logic: Spaced Repetition System (SRS)

Implemented as the **SM-2 (SuperMemo 2) adaptive algorithm** in `modules/study/srs.engine.ts`. Unlike a fixed Leitner system, SM-2 adjusts per-card intervals based on each user's personal ease factor, making review schedules personalized.

| Action    | Vietnamese | box_level  | ease_factor delta | Next Review Interval                                      |
| --------- | ---------- | ---------- | ----------------- | --------------------------------------------------------- |
| **Again** | Quên       | Reset to 0 | −0.20             | **NOW** (immediately due)                                 |
| **Hard**  | Khó        | Unchanged  | −0.15             | rep ≤ 1 → 1d; else `max(interval+1, round(interval×1.2))` |
| **Good**  | Thuộc      | +1         | 0 (unchanged)     | rep 1 → 1d, rep 2 → 6d, rep N → `round(interval × EF)`    |

**SM-2 constants (centralized in `shared/constants.ts`):**

- `DEFAULT_EASE_FACTOR`: 2.5
- `MIN_EASE_FACTOR`: 1.3
- `FIRST_INTERVAL_DAYS`: 1
- `SECOND_INTERVAL_DAYS`: 6

> **Again** sets `next_review_at = NOW` so cards are immediately re-queued for the next session.

---

## 5. API Endpoints

All endpoints (except auth) are protected via `requireAuth` middleware.

### Auth (`/auth`)

| Method | Path             | Description                        |
| ------ | ---------------- | ---------------------------------- |
| POST   | `/auth/register` | Register (email + password)        |
| POST   | `/auth/login`    | Login (email + password)           |
| POST   | `/auth/logout`   | Logout (invalidate session)        |
| GET    | `/auth/me`       | Current user (from session cookie) |

### Classes (`/classes`)

| Method | Path           | Description             |
| ------ | -------------- | ----------------------- |
| GET    | `/classes`     | List user's classes     |
| POST   | `/classes`     | Create class            |
| GET    | `/classes/:id` | Get class by ID         |
| PATCH  | `/classes/:id` | Update class            |
| DELETE | `/classes/:id` | Delete class (cascades) |

### Folders (`/folders`)

| Method | Path                         | Description              |
| ------ | ---------------------------- | ------------------------ |
| GET    | `/folders/by-class/:classId` | List folders in class    |
| POST   | `/folders/by-class/:classId` | Create folder in class   |
| GET    | `/folders/:id`               | Get folder by ID         |
| PATCH  | `/folders/:id`               | Update folder            |
| DELETE | `/folders/:id`               | Delete folder (cascades) |

### Decks (`/decks`)

| Method | Path                         | Description                         |
| ------ | ---------------------------- | ----------------------------------- |
| GET    | `/decks/by-folder/:folderId` | List decks in folder                |
| POST   | `/decks/by-folder/:folderId` | Create deck (name + cardTemplateId) |
| GET    | `/decks/:id`                 | Get deck by ID                      |
| PATCH  | `/decks/:id`                 | Update deck                         |
| DELETE | `/decks/:id`                 | Delete deck (cascades)              |

### Card Templates (`/card-templates`)

| Method | Path                  | Description                                                                 |
| ------ | --------------------- | --------------------------------------------------------------------------- |
| GET    | `/card-templates`     | List system + user templates (system templates served from in-memory cache) |
| GET    | `/card-templates/:id` | Get template with fields                                                    |
| POST   | `/card-templates`     | Create custom template                                                      |

### Cards (`/cards`)

| Method | Path                     | Description                                                        |
| ------ | ------------------------ | ------------------------------------------------------------------ |
| GET    | `/cards/by-deck/:deckId` | List cards with field values (paginated: `page`, `limit`, max 200) |
| POST   | `/cards/by-deck/:deckId` | Create card with field values                                      |
| PATCH  | `/cards/:id`             | Update card field values (upsert)                                  |
| DELETE | `/cards/:id`             | Delete card                                                        |

### Study (`/study`)

| Method | Path                           | Description                                  |
| ------ | ------------------------------ | -------------------------------------------- |
| GET    | `/study/deck/:deckId`          | Get due cards for deck (`?mode=all` for all) |
| GET    | `/study/deck/:deckId/schedule` | Get upcoming review schedule for deck        |
| POST   | `/study/review`                | Review single card (cardId + action)         |
| POST   | `/study/review-batch`          | Review multiple cards in one batch (1–100)   |

---

## 6. UI/UX Implementation

- **Design:** Minimalist, plenty of whitespace, TailwindCSS v4 with `@theme` design tokens.
- **Pages:**
  - `/login` — Login form (guest only)
  - `/register` — Register form with confirm password (guest only)
  - `/` — Dashboard: Header + Sidebar tree + deck selection
  - `/deck/:deckId` — Deck view: card list, add card form (dynamic per template)
  - `/study/:deckId` — Study mode
- **Study Mode:**
  - Central Flashcard component with 3D CSS flip animation (`transform: rotateY(180deg)`)
  - Keyboard shortcuts: `Space` (Flip), `1` (Again), `2` (Hard), `3` (Good)
  - Progress bar showing reviewed/due ratio
  - Session complete screen when all due cards reviewed
- **Sidebar:** Hierarchical tree (Class → Folder → Deck) with lazy loading on expand. Inline class creation.
- **Session Management:** httpOnly cookies, 30-day expiry, auto-refresh within 15-day threshold.

---

## 7. Project Structure

```
engram-spira/
├── docker-compose.yml
├── package.json                    # Root monorepo config
├── .env                            # DATABASE_URL
├── apps/
│   ├── api/                        # Backend (ElysiaJS)
│   │   ├── package.json
│   │   ├── drizzle.config.ts
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts            # Entry: Elysia app + route mounting + error handler
│   │       ├── config/env.ts       # Environment validation
│   │       ├── db/
│   │       │   ├── index.ts        # DB connection (drizzle + postgres.js)
│   │       │   ├── seed.ts         # System template seeder
│   │       │   ├── schema/         # Drizzle schema definitions
│   │       │   └── migrations/     # Generated SQL migrations
│   │       ├── modules/
│   │       │   ├── auth/           # Auth: middleware, routes, service, session utils
│   │       │   ├── classes/        # CRUD: routes + service
│   │       │   ├── folders/        # CRUD: routes + service
│   │       │   ├── decks/          # CRUD: routes + service
│   │       │   ├── card-templates/ # CRUD: routes + service
│   │       │   ├── cards/          # CRUD: routes + service
│   │       │   └── study/          # SRS engine + routes + service
│   │       ├── shared/
│   │       │   ├── constants.ts    # All magic values centralized
│   │       │   └── errors.ts       # AppError hierarchy (401/403/404/409/422)
│   │       └── types/index.ts
│   └── web/                        # Frontend (SolidJS)
│       ├── package.json
│       ├── vite.config.ts
│       ├── tsconfig.json
│       ├── index.html
│       └── src/
│           ├── index.tsx           # Render entry
│           ├── app.tsx             # Router + auth guards
│           ├── app.css             # Tailwind v4 + design tokens
│           ├── api/client.ts       # Eden Treaty client
│           ├── stores/auth.store.ts
│           ├── lib/                # utils (cn), query-client
│           ├── constants/index.ts  # Frontend constants
│           ├── pages/              # Route pages
│           └── components/
│               ├── flashcard/      # Flashcard + StudyControls
│               ├── layout/         # Header, Sidebar
│               └── ui/             # Button, Card, Input, Textarea
└── packages/
    └── shared/                     # @engram/shared (stub)
```

---

## 8. Monorepo Scripts

| Script        | Command                            | Description                  |
| ------------- | ---------------------------------- | ---------------------------- |
| `dev`         | `bun run --filter '*' dev`         | Start API + Web concurrently |
| `dev:api`     | `bun run --filter @engram/api dev` | Start API only (watch mode)  |
| `dev:web`     | `bun run --filter @engram/web dev` | Start Web only               |
| `db:generate` | `drizzle-kit generate`             | Generate SQL migrations      |
| `db:migrate`  | `drizzle-kit migrate`              | Apply migrations             |
| `db:seed`     | `bun run src/db/seed.ts`           | Seed system templates        |
| `db:studio`   | `drizzle-kit studio`               | Open Drizzle Studio GUI      |
