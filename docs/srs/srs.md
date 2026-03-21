# Software Requirements Specification (SRS)

**Project:** Engram Spira — High-Performance SRS Flashcard Application
**Version:** 2.0 &nbsp;|&nbsp; **Date:** March 21, 2026 &nbsp;|&nbsp; **Status:** Approved

---

## 1. Introduction

### 1.1 Purpose

Engram Spira is a full-stack spaced repetition flashcard web application. It provides authenticated users with structured study tools based on the **SM-2 algorithm**, enabling long-term knowledge retention through personalized review scheduling.

### 1.2 Tech Stack

| Layer | Technology |
|-------|-----------|
| **Runtime** | Bun 1.3+ |
| **Backend** | ElysiaJS (AOT) + Drizzle ORM + PostgreSQL 15 + pgvector |
| **Frontend** | SolidJS (Vite) + TanStack Solid Query + TailwindCSS v4 |
| **Type Safety** | Elysia Eden Treaty (end-to-end, no codegen) |
| **Auth** | Custom session-based (`@oslojs/crypto` + `@node-rs/argon2`) |
| **AI** | Google Gemini `gemini-2.5-flash` + `text-embedding-004` |
| **Monorepo** | Bun Workspaces (`apps/*`, `packages/*`) |

### 1.3 Key Terms

| Term | Definition |
|------|-----------|
| **SRS / SM-2** | Spaced Repetition System using the SuperMemo 2 algorithm |
| **Ease Factor** | Per-card multiplier (min 1.3, default 2.5) governing interval growth |
| **Deck** | Collection of cards sharing a single card template |
| **Card Template** | Reusable schema defining fields (name, type, side) for cards |
| **Knowledge Graph** | Network of semantic relationships between cards |
| **Embedding** | 768-dim vector representation of card content for similarity search |

---

## 2. Scope

### Functional Areas

1. **Authentication** — register, login, logout, email verification, password reset, session management
2. **Content Hierarchy** — Class → Folder → Deck → Cards (4-level organization)
3. **Card Templates** — system-provided + user-defined field schemas
4. **Card Management** — CRUD with dynamic fields, bulk operations, drag-drop reorder, search
5. **Spaced Repetition** — SM-2 study sessions with 4 review actions, batch review
6. **Progress Tracking** — streak, activity heatmap, study stats, forecast, at-risk cards
7. **Deck Analytics** — retention heatmap, knowledge graph visualization, duplicate scanner, AI suggestions
8. **AI Card Generator** — text-to-flashcard via Gemini, vocabulary & Q&A modes, job queue
9. **Semantic Search** — pgvector embeddings + cosine similarity for full-text card search
10. **Knowledge Graph** — card relationships with AI-powered relationship detection
11. **Import/Export** — CSV and JSON per deck
12. **User Profile** — display name, avatar, password, theme
13. **Notifications** — per-deck due counts, badge totals
14. **Feedback** — in-app bug/feature submission via email
15. **Focus Timer** — Pomodoro-style session timer with daily stats

**Infrastructure:** Local development only (Docker + PostgreSQL 15-alpine).

---

## 3. Functional Requirements

### 3.1 Authentication & Session Management

| ID | Requirement |
|----|------------|
| FR-1 | Registration with email + argon2-hashed password. Duplicate emails → 409. |
| FR-2 | Login generates a SHA-256 hashed session token stored in DB (30-day TTL). Raw token set as httpOnly cookie. |
| FR-3 | `requireAuth` middleware validates session cookie on all protected endpoints. Expired → 401. |
| FR-4 | Sessions with < 15 days remaining auto-renew to 30 days. |
| FR-5 | Logout deletes session record and clears cookie. |
| FR-6 | `GET /auth/me` returns authenticated user profile. |
| FR-7 | **Email verification**: token sent on registration, verified via `GET /auth/verify-email`. Resend via `POST /auth/resend-verification`. Dashboard banner shown for unverified users. |
| FR-8 | **Password reset**: token-based flow via `/reset-password` (public route). |

---

### 3.2 Content Organization

| ID | Requirement |
|----|------------|
| FR-9 | **Class CRUD** — list, create, get, update, delete (cascades to children). |
| FR-10 | **Folder CRUD** — scoped to parent class. Delete cascades. |
| FR-11 | **Deck CRUD** — scoped to parent folder. Requires card template ID. Stores denormalized `user_id` for O(1) ownership check. |
| FR-12 | All operations enforce ownership. Unauthorized access → 404. |

---

### 3.3 Card Templates

| ID | Requirement |
|----|------------|
| FR-13 | **System templates** (cached in memory at startup): **Vocabulary** (word, type, ipa, definition, examples) and **Basic Q&A** (question, answer). |
| FR-14 | Users can create custom templates with configurable field schemas. |
| FR-15 | Field types: `text`, `textarea`, `image_url`, `audio_url`, `json_array`. |

---

### 3.4 Cards

| ID | Requirement |
|----|------------|
| FR-16 | Create card with field values matching deck's template. Values stored as JSONB. |
| FR-17 | Paginated listing with template metadata. Default 50, max 200 per page. |
| FR-18 | Update via field value upsert. |
| FR-19 | Delete with cascade to field values and study progress. |
| FR-20 | **Bulk delete** — batch delete multiple cards in one request. |
| FR-21 | **Drag-drop reorder** — persist card sort order via `PATCH /cards/by-deck/:deckId/reorder`. |
| FR-22 | **Server-side search** — search cards within a deck by field content via `GET /cards/by-deck/:deckId/search`. |

---

### 3.5 Spaced Repetition System

**SM-2 Algorithm** with four review actions:

| Action | Reps | EF Delta | Next Review |
|--------|------|----------|-------------|
| `again` | Reset to 0 | −0.20 | +10 minutes |
| `hard` | Unchanged | −0.15 | 1d (reps ≤ 1), else `max(interval+1, interval×1.2)` |
| `good` | +1 | 0 | rep 1→1d, rep 2→6d, then `interval × EF` |
| `easy` | +1 | +0.15 | Same as good × 1.3 bonus |

**Constants:** Default EF: 2.5 · Min EF: 1.3 · Again delay: 10min · Easy bonus: 1.3×

| ID | Requirement |
|----|------------|
| FR-23 | `GET /study/deck/:deckId` — due cards (SQL-level LEFT JOIN filtering). Returns cards, total, due count. |
| FR-24 | `?mode=all` — review all cards regardless of schedule. |
| FR-25 | `POST /study/review` — single card review (cardId + action). |
| FR-26 | `POST /study/review-batch` — batch review (1–100 items, single DB upsert). |
| FR-27 | `GET /study/schedule` — upcoming review days, learned count, next review date. |
| FR-28 | `GET /study/streak` — current and longest streak. `GET /study/activity?days=N` — daily heatmap (max 365). |
| FR-29 | `GET /study/stats` — global study stats. `GET /study/dashboard-snapshot` — combined dashboard overview. |
| FR-30 | **Interleaved study** — `POST /study/interleaved` (manual deck selection) and `GET /study/interleaved/auto` (auto top-N). |
| FR-31 | **Progress reset** — per deck or per card. |
| FR-32 | **Forecast** — `GET /study/forecast` predicts upcoming review load. |
| FR-33 | **Retention heatmap** — `GET /study/retention-heatmap?deckId=` shows per-card retention status. |
| FR-34 | **At-risk cards** — `GET /study/at-risk` identifies cards with declining retention. |

---

### 3.6 AI Card Generator

| ID | Requirement |
|----|------------|
| FR-35 | `POST /ai/generate` — auto-detects mode from template (Vocabulary if `word` field exists, else Q&A). Supports `backLanguage` (`vi`/`en`). |
| FR-36 | **Job system** — generated cards stored as `pending` jobs in `ai_generation_jobs`. Background processing with status polling. |
| FR-37 | `POST /ai/jobs/:jobId/save` — save (optionally edited) AI cards to deck. |
| FR-38 | Rate limit: 30 req/hr per user (in-memory), 20 req/min global. |
| FR-39 | Frontend preview modal with edit/delete before commit. IPA and word-type badges in vocabulary mode. |

---

### 3.7 Semantic Search & Embeddings

| ID | Requirement |
|----|------------|
| FR-40 | Cards auto-embedded on creation using Gemini `text-embedding-004` (768-dim vectors). |
| FR-41 | `GET /search?q=` — semantic search via pgvector cosine similarity. Rate-limited (60 req/min). |
| FR-42 | `GET /embedding/status` — shows total, embedded, and pending card counts. |
| FR-43 | `POST /embedding/backfill` — batch backfill embeddings for existing cards. |

---

### 3.8 Knowledge Graph

| ID | Requirement |
|----|------------|
| FR-44 | **Card linking** — `POST /knowledge-graph/links` creates `related` links between cards. |
| FR-45 | `GET /knowledge-graph/decks/:id/graph` — full deck graph (nodes + edges). |
| FR-46 | `POST /knowledge-graph/ai/detect` — AI-powered relationship detection using embedding similarity with configurable threshold (0.5–1.0). |
| FR-47 | `POST /knowledge-graph/ai/dismiss` — dismiss AI suggestions (persisted in `dismissed_suggestions`). |

---

### 3.9 Import / Export

| ID | Requirement |
|----|------------|
| FR-48 | CSV import via raw string or multipart upload (max 2 MB). |
| FR-49 | Export as CSV or JSON. Rate limit: 15 req/min per IP. |

---

### 3.10 User Profile & Settings

| ID | Requirement |
|----|------------|
| FR-50 | Update display name and avatar. Built-in avatar collection via `GET /users/avatars`. |
| FR-51 | Password change form. |
| FR-52 | Theme toggle (light/dark/system) persisted in `localStorage`. |

---

### 3.11 Notifications & Feedback

| ID | Requirement |
|----|------------|
| FR-53 | `GET /notifications/due-decks` — decks with due cards. `GET /notifications/due-count` — total badge count. |
| FR-54 | `POST /feedback` — submit bug/feature/general feedback via Resend email. |

---

### 3.12 Frontend Pages

| Route | Description |
|-------|------------|
| `/login`, `/register` | Auth forms with validation and error display |
| `/verify-email` | Email verification handler (public) |
| `/reset-password` | Password reset flow (public) |
| `/` | Dashboard — streak hero, stats, heatmap, forecast, smart groups, due decks |
| `/deck/:deckId` | Deck view — card list, add/edit/delete, search, bulk ops, AI generation, analytics panel |
| `/study/:deckId` | Study mode — 3D flip card, SM-2 controls, keyboard shortcuts, session stats |
| `/study/interleaved` | Cross-deck interleaved study |
| `/settings` | Profile, avatar, password, theme |
| `/feedback` | Feedback form |
| `/docs` | Project documentation (SRS, C4 diagrams, ERD) |

**Key Frontend Features:**
- **Keyboard shortcuts** in study mode: `Space` (flip), `1-4` (review actions)
- **Focus Drawer** — Pomodoro timer with daily stats and streak tracking (`localStorage`)
- **Deck Analytics Panel** — retention heatmap, knowledge graph view, duplicate scanner, AI relationship suggestions
- **Virtual list** for large card collections with infinite scroll
- **Route guards** — `ProtectedRoute` and `GuestRoute` with auth redirects

---

## 4. Non-Functional Requirements

### 4.1 Performance

| ID | Requirement |
|----|------------|
| NFR-1 | SQL-level filtering for due cards (LEFT JOIN, no client-side filtering). |
| NFR-2 | Parallel DB reads via `Promise.all()`. |
| NFR-3 | Batch upsert via `INSERT ... ON CONFLICT DO UPDATE`. |
| NFR-4 | In-memory template caching at startup. |
| NFR-5 | ElysiaJS AOT compilation enabled. |
| NFR-6 | pgvector indexing for cosine similarity search. |
| NFR-7 | Connection pooling via `postgres.js`. |

### 4.2 Security

| ID | Requirement |
|----|------------|
| NFR-8 | Argon2 password hashing. No plaintext storage. |
| NFR-9 | Crypto-random session tokens, SHA-256 hashed, httpOnly cookies. |
| NFR-10 | CORS restricted to `localhost` in dev, blocked in production. |
| NFR-11 | Ownership enforcement — violations return 404 (not 403). |
| NFR-12 | Input validation via ElysiaJS `t.*` schema validators. |

### 4.3 Usability

| ID | Requirement |
|----|------------|
| NFR-13 | Clean, minimalist design with TailwindCSS v4 `@theme` tokens and shadcn-style components. |
| NFR-14 | Immediate visual feedback on all interactions (loading states, disabled buttons). |
| NFR-15 | Keyboard-driven study mode (Space, 1-4). |

### 4.4 Reliability

| ID | Requirement |
|----|------------|
| NFR-16 | Typed `AppError` hierarchy with proper HTTP status codes (400-422, 500). |
| NFR-17 | Centralized constants in `shared/constants.ts`. |
| NFR-18 | Bun Workspaces monorepo structure. |
| NFR-19 | End-to-end type safety via Eden Treaty. |
| NFR-20 | Migration-based schema management via Drizzle Kit. |

---

## 5. Out of Scope

| # | Excluded | Notes |
|---|----------|-------|
| 1 | Cloud deployment | Local dev only |
| 2 | Mobile apps | Web only |
| 3 | Offline sync | No service workers / IndexedDB |
| 4 | Social features | No deck sharing or collaboration |
| 5 | Rich text / Markdown fields | Plain text and JSON arrays only |
| 6 | Image/audio upload | URL references only, no file upload |
| 7 | Admin panel | No backoffice UI |
| 8 | OAuth / social login | Custom session auth only |
| 9 | Anki `.apkg` import | CSV/JSON only |
| 10 | Push/email reminders | Badge counts only |
| 11 | Multi-language / i18n | English UI only |
| 12 | Subscription / payments | No monetization |

---

*End of SRS — Engram Spira v2.0*
