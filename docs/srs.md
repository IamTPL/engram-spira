# Software Requirements Specification (SRS)

**Project Name:** Engram Spira — High-Performance SRS Flashcard Application  
**Document Version:** 1.0  
**Date:** March 2, 2026  
**Status:** Approved (reflects current codebase)

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Scope](#2-scope)
3. [Functional Requirements](#3-functional-requirements)
   - 3.1 Authentication & Session Management
   - 3.2 Content Organization (Classes, Folders, Decks)
   - 3.3 Card Templates
   - 3.4 Cards
   - 3.5 Study / Spaced Repetition System
   - 3.6 Frontend / User Interface
4. [Non-Functional Requirements](#4-non-functional-requirements)
5. [Out of Scope](#5-out-of-scope)

---

## 1. Introduction

### 1.1 Purpose

This Software Requirements Specification (SRS) document describes the complete functional and non-functional requirements for **Engram Spira**, a high-performance, full-stack spaced repetition flashcard web application.

The application provides authenticated users with structured study tools based on the **SM-2 (SuperMemo 2) spaced repetition algorithm**, enabling efficient long-term vocabulary and knowledge retention. The system is modeled conceptually after Quizlet but is optimized for performance and personalized review scheduling.

### 1.2 Intended Audience

This document is intended for:

- Software developers and engineers building or maintaining the system
- Technical leads and architects reviewing design decisions
- QA engineers writing test cases
- Project stakeholders validating scope and requirements

### 1.3 Project Background

Engram Spira is a monorepo full-stack project using a bleeding-edge local-first stack:

- **Backend:** Bun + ElysiaJS + Drizzle ORM + PostgreSQL 15
- **Frontend:** SolidJS (Vite) + TanStack Query + TailwindCSS v4
- **Type-safe API communication:** Elysia Eden Treaty (end-to-end type safety, no codegen)
- **Auth:** Custom session-based (Lucia-style pattern using `@oslojs/crypto` and `@node-rs/argon2`)

### 1.4 Definitions and Abbreviations

| Term             | Definition                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------- |
| SRS              | Spaced Repetition System — algorithm for scheduling reviews based on recall performance                 |
| SM-2             | SuperMemo 2 — adaptive spaced repetition algorithm that adjusts intervals per-card based on ease factor |
| Ease Factor (EF) | Per-card multiplier (min 1.3, default 2.5) governing how fast a card's review interval grows            |
| Deck             | A collection of cards sharing a single card template                                                    |
| Card Template    | A reusable schema defining the fields (name, type, side) that cards in a deck use                       |
| EAV              | Entity-Attribute-Value — pattern used for flexible card field storage                                   |
| AOT              | Ahead-of-Time compilation, enabled in ElysiaJS for performance                                          |

---

## 2. Scope

Engram Spira covers the following functional areas:

1. **User authentication** — registration, login, logout, and session management via secure httpOnly cookies.
2. **Content hierarchy management** — organizing study material in a four-level hierarchy: Class → Folder → Deck → Cards.
3. **Card template system** — system-provided and user-defined templates that define field schemas for cards (supporting field types: `text`, `textarea`, `image_url`, `audio_url`, `json_array`).
4. **Card management** — creating, editing, and deleting individual flashcards with dynamic field values matching their deck's template.
5. **Spaced Repetition Study mode** — a full study session experience: displaying due cards as flippable flashcards, accepting user review ratings (Again / Hard / Good), computing next review intervals via the SM-2 algorithm, and persisting per-user-per-card progress.
6. **Study progress tracking** — per-user, per-card scheduling state: box level (repetitions), ease factor, interval days, next review date, and last reviewed date.
7. **Review scheduling display** — a schedule view showing how many cards are coming due in the next N days.
8. **Frontend UX** — a clean, minimalist web interface with a hierarchical sidebar, deck view with card management, and an interactive study mode with 3D card flip animation and keyboard shortcuts.

**Infrastructure scope:** Local development only using Docker (PostgreSQL 15-alpine). No cloud deployment infrastructure is in scope.

---

## 3. Functional Requirements

### 3.1 Authentication & Session Management

**FR-1** — **User Registration**  
The system shall allow new users to register using a valid email address and a password. The password shall be hashed with argon2 before storage. Duplicate email addresses shall return a 409 Conflict error.

**FR-2** — **User Login**  
The system shall authenticate users by verifying their email and argon2-hashed password. Upon success, a cryptographically random session token shall be generated, hashed with SHA-256, and stored in the database along with an expiry timestamp (30 days). The raw token shall be set as an httpOnly session cookie in the response.

**FR-3** — **Session Validation Middleware**  
All non-auth API endpoints shall be protected by a `requireAuth` middleware. The middleware shall read the session cookie, validate the token against the database, reject expired sessions with a 401 response, and attach the authenticated user object to the request context.

**FR-4** — **Session Auto-Renewal**  
If a valid session has less than 15 days remaining, the system shall automatically extend it to 30 days from the current request time.

**FR-5** — **User Logout**  
The system shall delete the session record from the database and clear the session cookie upon logout.

**FR-6** — **Current User Endpoint**  
The system shall expose a `GET /auth/me` endpoint that returns the authenticated user's profile (id, email, created_at) based on the current session cookie.

---

### 3.2 Content Organization (Classes, Folders, Decks)

**FR-7** — **Class CRUD**  
Authenticated users shall be able to:

- List all their own classes (name, description, created_at).
- Create a class (name required, description optional).
- Get a class by ID (ownership enforced).
- Update a class name and/or description.
- Delete a class (cascades to all folders, decks, and cards within).

**FR-8** — **Folder CRUD**  
Authenticated users shall be able to:

- List all folders within a class they own.
- Create a folder within a class (name required).
- Get a folder by ID.
- Update a folder name.
- Delete a folder (cascades to all decks and cards within).

**FR-9** — **Deck CRUD**  
Authenticated users shall be able to:

- List all decks within a folder they own.
- Create a deck within a folder (name required, card template ID required).
- Get a deck by ID.
- Update a deck name.
- Delete a deck (cascades to all cards and study progress within).

**FR-10** — **Deck Ownership Denormalization**  
Decks shall store a denormalized `user_id` column directly (in addition to `folder_id`) to enable O(1) ownership verification without JOIN traversal through the folder → class → user chain.

**FR-11** — **Ownership Enforcement**  
All CRUD operations on classes, folders, and decks shall verify that the resource belongs to the authenticated user. Unauthorized access shall return a 404 Not Found (resource not exposed).

---

### 3.3 Card Templates

**FR-12** — **System Templates**  
The system shall provide the following pre-seeded system templates (is_system = true, user_id = null):

1. **Vocabulary** — 5 fields:
   - `word` (front, text, required)
   - `type` (front, text)
   - `ipa` (front, text)
   - `definition` (back, textarea, required)
   - `examples` (back, json_array, max 5 items)

2. **Basic Q&A** — 2 fields:
   - `question` (front, textarea, required)
   - `answer` (back, textarea, required)

**FR-13** — **Custom User Templates**  
Authenticated users shall be able to create their own custom card templates by specifying a name, description, and a list of fields. Each field requires a name, field type, side (`front`/`back`), and sort order.

**FR-14** — **Template Listing**  
The `GET /card-templates` endpoint shall return both system templates (is_system = true) and the authenticated user's own templates. System templates shall be served from an in-memory cache populated at server startup.

**FR-15** — **Template Field Types**  
The system shall support the following field types: `text`, `textarea`, `image_url`, `audio_url`, `json_array`.

---

### 3.4 Cards

**FR-16** — **Card Creation**  
Authenticated users shall be able to create a card within a deck they own by supplying field values matching the deck's card template. Field values are stored as JSONB in `card_field_values`.

**FR-17** — **Card Listing with Pagination**  
The `GET /cards/by-deck/:deckId` endpoint shall return a paginated list of cards in a deck, including all field values with their template metadata (fieldName, fieldType, side, sortOrder). Default page size is 50; maximum page size is 200.

**FR-18** — **Card Update**  
Authenticated users shall be able to update a card's field values via upsert (insert or update all provided field value entries).

**FR-19** — **Card Deletion**  
Authenticated users shall be able to delete a card. Deletion shall cascade to all associated field values and study progress records.

---

### 3.5 Study / Spaced Repetition System

**FR-20** — **Due Cards Query**  
The `GET /study/deck/:deckId` endpoint shall return cards that are due for review (i.e., `next_review_at <= NOW()` or cards with no study progress record). This filtering shall be performed at the SQL level via a LEFT JOIN on `study_progress`. The response shall include:

- `cards[]`: list of cards with field values and current progress
- `total`: total card count in the deck
- `due`: count of currently due cards

**FR-21** — **Review All Mode**  
The `GET /study/deck/:deckId?mode=all` endpoint shall return all cards in the deck (ignoring due date), enabling users to review any card regardless of schedule.

**FR-22** — **Single Card Review**  
The `POST /study/review` endpoint shall accept a `cardId` (UUID) and an `action` (`again`, `hard`, or `good`), validate deck ownership, compute the SM-2 result, and upsert the study progress row.

**FR-23** — **Batch Card Review**  
The `POST /study/review-batch` endpoint shall accept an array of `{ cardId, action }` objects (1–100 items), verify all card ownerships in a single query, compute SM-2 for each, and upsert all progress rows in a single database batch operation.

**FR-24** — **SM-2 SRS Algorithm**  
The system shall implement the SuperMemo 2 (SM-2) spaced repetition algorithm with the following rules:

| Action  | Vietnamese | Repetitions | Ease Factor (EF) Delta | Next Review                                                          |
| ------- | ---------- | ----------- | ---------------------- | -------------------------------------------------------------------- |
| `again` | Quên       | Reset to 0  | −0.20                  | **Immediately** (now)                                                |
| `hard`  | Khó        | Unchanged   | −0.15                  | 1 day (if reps ≤ 1), else `max(interval + 1, round(interval × 1.2))` |
| `good`  | Thuộc      | +1          | 0 (no change)          | rep 1 → 1d, rep 2 → 6d, rep N → `round(interval × EF)`               |

**Constants:**

- Default EF: 2.5
- Minimum EF: 1.3
- `again` resets `box_level` to 0 and `interval_days` to 1, with `next_review_at` = now

> **Note:** The "Again" action sets `next_review_at` to the current timestamp so the card immediately re-enters the due list on next session load.

**FR-25** — **Study Progress Persistence**  
The `study_progress` table shall store per-user-per-card state: `box_level` (repetition count), `ease_factor`, `interval_days`, `next_review_at`, and `last_reviewed_at`. The composite unique constraint on `(user_id, card_id)` ensures one progress record per user per card.

**FR-26** — **Review Schedule Endpoint**  
The `GET /study/deck/:deckId/schedule` endpoint shall return:

- `totalCards`: total number of cards in the deck
- `learnedCards`: number of cards with at least one study progress entry
- `upcoming`: array of upcoming review days (daysFromNow ≥ 1), each with count and date — cards due in < 24 hours are excluded from this list (they appear in the due list instead)
- `nextReviewDate`: ISO timestamp of the nearest upcoming review

**FR-27** — **Study Mode — Review All Cards**  
The frontend Study Mode shall provide a "Review All Cards" button on the session complete screen, enabling users to review all cards in the deck regardless of their due status.

---

### 3.6 Frontend / User Interface

**FR-28** — **Routing & Auth Guards**  
The frontend shall implement route guards using SolidJS Router:

- `ProtectedRoute`: redirects unauthenticated users to `/login`
- `GuestRoute`: redirects authenticated users away from `/login` and `/register`

**FR-29** — **Login Page (`/login`)**  
A form accepting email and password, calling `POST /auth/login`, storing the user in an auth store, and redirecting to the dashboard on success. Inline error messages shall be shown on failure.

**FR-30** — **Register Page (`/register`)**  
A form accepting email, password, and confirm-password. Client-side validation shall verify passwords match before submission. On success, redirect to the dashboard.

**FR-31** — **Dashboard Layout**  
The main dashboard (`/`) shall consist of:

- **Header**: app logo/name and logout button
- **Sidebar**: hierarchical tree (Class → Folder → Deck) with lazy loading on expand
- **Main Area**: deck-based content or welcome placeholder

**FR-32** — **Sidebar Tree**  
The sidebar shall:

- List classes on initial load
- Lazy-load folders when a user expands a class node
- Lazy-load decks when a user expands a folder node
- Provide an inline text input for creating new classes
- Navigate to Deck View on deck click

**FR-33** — **Deck View (`/deck/:deckId`)**  
The deck view page shall:

- Display the deck name and card template name
- List all cards in the deck with their field values
- Provide an "Add Card" form with dynamically rendered inputs matching the deck's card template fields (text → `<Input>`, textarea → `<Textarea>`)
- Support card deletion with confirmation
- Provide a "Study" button navigating to `/study/:deckId`

**FR-34** — **Study Mode (`/study/:deckId`)**  
The study mode page shall:

- Fetch due cards on load
- Display cards one at a time as a flippable flashcard
  - **Front face:** primary fields (e.g. word, type, IPA)
  - **Back face:** secondary fields (e.g. definition, examples as a bulleted list for `json_array`)
- Show a **3D CSS flip animation** on interaction
- Show `StudyControls` (Again / Hard / Good buttons) only after the card is flipped
- Display a top progress bar showing `currentIndex / due`
- Display a counter `X / Y cards` in the header
- Show a "Session Complete" screen when all due cards are reviewed, including:
  - Session stats (Again / Hard / Good counts)
  - Cards learned count vs total
  - Upcoming review schedule (from `/study/deck/:deckId/schedule`)
  - "Review All Cards (N)" button
  - "Back to Dashboard" button

**FR-35** — **Keyboard Shortcuts (Study Mode)**  
The following keyboard shortcuts shall be available during a study session:

| Key     | Action                            |
| ------- | --------------------------------- |
| `Space` | Flip card                         |
| `1`     | Again (only when card is flipped) |
| `2`     | Hard (only when card is flipped)  |
| `3`     | Good (only when card is flipped)  |

**FR-36** — **Restart Session**  
A restart button (RotateCcw icon) in the study mode header shall reset the current session index, stats, and mode (`due`), then refetch due cards.

---

## 4. Non-Functional Requirements

### 4.1 Performance

**NFR-1** — **SQL-Level Filtering**  
Due-card queries shall filter at the SQL level using a LEFT JOIN on `study_progress`, avoiding client-side or application-level filtering of large card sets.

**NFR-2** — **Parallel Database Queries**  
Endpoints that require multiple independent database reads shall execute them in parallel using `Promise.all()` to minimize response latency.

**NFR-3** — **Batch Upsert**  
The batch review endpoint (`POST /study/review-batch`) shall execute a single SQL upsert statement for all items using `INSERT ... ON CONFLICT DO UPDATE`, avoiding N individual queries.

**NFR-4** — **In-Memory Template Caching**  
System card templates shall be loaded once at server startup and served from in-memory cache, eliminating repeated database reads for frequently accessed static data.

**NFR-5** — **AOT Compilation**  
ElysiaJS shall be initialized with `aot: true` (Ahead-of-Time compilation) for improved routing and handler performance.

**NFR-6** — **Database Indexing**  
The database shall maintain the following indexes to support performant queries:

- `idx_sessions_user_id` on `sessions(user_id)`
- `idx_classes_user_id` on `classes(user_id)`
- `idx_folders_class_id` on `folders(class_id)`
- `idx_decks_user_id` on `decks(user_id)`
- `idx_decks_folder_id` on `decks(folder_id)`
- `idx_decks_card_template_id` on `decks(card_template_id)`
- `idx_cards_deck_id` on `cards(deck_id)`
- `idx_cfv_card_id` on `card_field_values(card_id)`
- `idx_template_fields_template_id` on `template_fields(template_id)`
- `idx_sp_user_next_review` on `study_progress(user_id, next_review_at)` (composite, for due-card scan)

**NFR-7** — **Connection Pooling**  
The backend shall use `postgres.js` with connection pooling for all database operations.

---

### 4.2 Security

**NFR-8** — **Password Hashing**  
User passwords shall be hashed using argon2 (via `@node-rs/argon2`). Plain-text passwords shall never be stored or logged.

**NFR-9** — **Session Token Security**  
Session tokens shall be generated using a cryptographically secure random byte generator, hashed with SHA-256 for database storage, and transmitted only via httpOnly cookies to prevent JavaScript access.

**NFR-10** — **CORS Policy**  
In development, the API shall allow requests only from `http://localhost:<port>` (matching via regex). In production, cross-origin requests shall be blocked entirely (`origin: false`).

**NFR-11** — **Ownership Enforcement**  
No user shall be able to read, modify, or delete resources owned by another user. Ownership violations shall return 404 (not 403) to avoid resource enumeration.

**NFR-12** — **Input Validation**  
All API request bodies shall be validated using ElysiaJS's built-in `t.*` schema validators. UUIDs shall be validated with `format: 'uuid'`. Review actions shall be strictly limited to the union of `'again'`, `'hard'`, `'good'` literals.

---

### 4.3 Usability

**NFR-13** — **Minimalist Design**  
The UI shall adhere to a clean, minimalist design aesthetic using TailwindCSS v4 `@theme` design tokens. Components shall follow shadcn-style conventions without external component library dependencies.

**NFR-14** — **Responsive Feedback**  
UI interactions (card review, form submission) shall provide immediate visual feedback (loading states, disabled buttons during pending operations) to prevent double submission and orient the user.

**NFR-15** — **Keyboard-Driven Study**  
The study mode shall be fully operable without a mouse using the defined keyboard shortcuts (Space, 1, 2, 3).

---

### 4.4 Reliability & Maintainability

**NFR-16** — **Structured Error Handling**  
All API errors shall use a typed `AppError` class hierarchy with appropriate HTTP status codes: 400 (Bad Request), 401 (Unauthorized), 403 (Forbidden), 404 (Not Found), 409 (Conflict), 422 (Unprocessable Entity). Unhandled errors shall return 500 with a generic message and be logged server-side.

**NFR-17** — **Centralized Constants**  
All SRS algorithm constants (EF defaults, minimum EF, per-action deltas), interval values, and field type enumerations shall be maintained in a single `shared/constants.ts` file, eliminating hardcoded magic values.

**NFR-18** — **Monorepo Structure**  
The project shall use Bun Workspaces monorepo structure (`apps/*`, `packages/*`) with a root `package.json` providing unified scripts for development, database operations, and builds.

**NFR-19** — **End-to-End Type Safety**  
The API client shall use Elysia Eden Treaty to infer TypeScript types directly from the backend Elysia app type. No manual type duplication, no codegen step required.

**NFR-20** — **Migration-Based Schema Management**  
All schema changes shall be applied via Drizzle Kit migrations (`drizzle-kit generate` + `drizzle-kit migrate`). Direct schema manipulation is prohibited.

---

### 4.5 Compatibility & Environment

**NFR-21** — **Runtime**  
The backend runtime shall be Bun 1.3+. Node.js compatibility is not required.

**NFR-22** — **Database**  
The system shall use PostgreSQL 15 (Docker image `postgres:15-alpine`). The database shall be persisted via a Docker named volume (`flashcard_db_data`).

**NFR-23** — **Frontend Browser Support**  
The frontend shall target modern evergreen browsers (Chrome, Firefox, Edge, Safari — latest 2 major versions). Internet Explorer is not supported.

**NFR-24** — **Environment Configuration**  
All environment-specific values (`DATABASE_URL`, `PORT`, `NODE_ENV`) shall be sourced from a `.env` file validated at server startup. Missing required variables shall cause the server to fail fast with a descriptive error.

---

## 5. Out of Scope

The following features and capabilities are explicitly **excluded** from the current version of Engram Spira:

| #      | Excluded Feature                                    | Notes                                                                          |
| ------ | --------------------------------------------------- | ------------------------------------------------------------------------------ |
| OOS-1  | Cloud deployment / hosting                          | App is local-development only; no AWS, GCP, Vercel, etc.                       |
| OOS-2  | Mobile applications (iOS / Android)                 | Web only; no React Native, Expo, or native wrappers                            |
| OOS-3  | Offline / local-first sync                          | No service workers, no IndexedDB sync, no conflict resolution                  |
| OOS-4  | Social features (deck sharing, collaborative study) | No public decks, no user-to-user sharing mechanisms                            |
| OOS-5  | Rich text / Markdown in card fields                 | Fields store plain text or JSON arrays; no markdown rendering                  |
| OOS-6  | Image/audio upload                                  | `image_url` and `audio_url` field types store URLs only; no file upload or CDN |
| OOS-7  | Admin panel / backoffice                            | No administrative UI for managing users or system templates                    |
| OOS-8  | Email verification / password reset                 | Auth supports login/register only; no email workflows                          |
| OOS-9  | OAuth / social login (Google, GitHub)               | Custom session auth only; no third-party OAuth providers                       |
| OOS-10 | Deck import/export (Anki, CSV, etc.)                | No import/export functionality in this version                                 |
| OOS-11 | Statistics / analytics dashboard                    | No historical review charts, retention graphs, or heatmaps                     |
| OOS-12 | Notifications / reminders                           | No push notifications or email reminders for due cards                         |
| OOS-13 | Multiple language / i18n                            | English UI only; no internationalisation support                               |
| OOS-14 | Subscription / payment system                       | No monetisation features                                                       |
| OOS-15 | Third-party Lucia Auth library                      | Auth pattern is custom-implemented; the Lucia library is not used              |

---

_End of Software Requirements Specification — Engram Spira v1.0_
