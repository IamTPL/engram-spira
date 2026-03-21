# NHẬP MÔN CÔNG NGHỆ PHẦN MỀM

**(Introduction to Software Engineering – PTIT)**

---

## Thông tin sinh viên

| Họ tên | MSSV | Lớp | Vai trò |
|--------|------|------|---------|
| Trần Phi Long | K23DTCN289 | D23TXCN06-K | Owner / Fullstack Developer |

**GitHub Repository:** [engram-spira](https://github.com/IamTPL/engram-spira)

**Đề tài:** Hệ thống Flashcard thông minh tích hợp Lặp lại Ngắt quãng (SRS) và AI

---

## 1. Ý tưởng triển khai

### 1.1. Bối cảnh & Động lực

Trong quá trình học tập, sinh viên phải tiếp thu lượng kiến thức lớn nhưng thường quên nhanh sau vài ngày nếu không có phương pháp ôn tập khoa học. Nghiên cứu của Hermann Ebbinghaus (1885) chỉ ra rằng con người quên tới 70% thông tin chỉ sau 24 giờ nếu không được củng cố.

Các ứng dụng flashcard phổ biến trên thị trường hiện tại:

| Ứng dụng | Ưu điểm | Hạn chế |
|----------|---------|---------|
| **Quizlet** | Giao diện đẹp, dễ dùng | Thuật toán SRS đơn giản, không hỗ trợ AI tạo thẻ chuyên sâu, không có đồ thị tri thức |
| **Anki** | Thuật toán SM-2 mạnh, mã nguồn mở | Giao diện cũ, UX kém, không tích hợp AI |
| **Memrise** | Gamification tốt | Chỉ phù hợp ngôn ngữ, không mở rộng được |

### 1.2. Đề xuất giải pháp

**Engram-Spira** là ứng dụng web flashcard thế hệ mới, kết hợp ba trụ cột:

1. **Thuật toán ghi nhớ khoa học** — Hỗ trợ song song SM-2 và FSRS, người dùng tự chọn.
2. **Trí tuệ nhân tạo (AI)** — Google Gemini tự động tạo flashcard, phát hiện trùng lặp, trích xuất concept, gợi ý liên kết tri thức.
3. **Đồ thị tri thức (Knowledge Graph)** — Trực quan hóa mối liên hệ giữa các kiến thức, vượt ra ngoài mô hình flashcard độc lập truyền thống.

### 1.3. Ý nghĩa tên gọi

- **Engram:** Thuật ngữ khoa học thần kinh chỉ dấu vết trí nhớ — đơn vị thay đổi sinh lý trong não tương ứng với một ký ức.
- **Spira:** Từ Latin nghĩa "xoắn ốc" — mô phỏng quá trình ôn tập lặp lại với khoảng cách mở rộng dần (spaced repetition).

---

## 2. Mục tiêu

1. Xây dựng ứng dụng web fullstack với kiến trúc monorepo, giao diện trực quan và responsive.
2. Triển khai thuật toán Lặp lại Ngắt quãng (SM-2 & FSRS) giúp người dùng ôn tập tối ưu.
3. Tích hợp AI (Google Gemini) cho việc tạo flashcard tự động và phân tích ngữ nghĩa.
4. Xây dựng hệ thống Knowledge Graph kết nối kiến thức, hỗ trợ học tập phi tuyến tính.
5. Áp dụng quy trình phát triển Agile–Scrum với CI/CD pipeline qua GitHub Actions.
6. Đảm bảo end-to-end type safety giữa frontend và backend.

---

## 3. Yêu cầu chức năng

### 3.1. Module nghiệp vụ chính (Core Features)

#### 3.1.1. Authentication & Authorization

| Chức năng | Mô tả kỹ thuật |
|-----------|-----------------|
| Đăng ký tài khoản | Email + password, hash bằng argon2 (OWASP recommended) |
| Đăng nhập | Session-based authentication, token bằng oslo/crypto CSPRNG |
| Email Verification | Gửi email xác minh qua Nodemailer, token có thời hạn |
| Reset Password | Quên mật khẩu → email token → đặt lại mật khẩu |
| Rate Limiting | Giới hạn request bằng `elysia-rate-limit` chống brute-force |

#### 3.1.2. Content Management (CRUD)

| Entity | Thao tác | Chi tiết |
|--------|----------|----------|
| **Class** (Lớp/Môn học) | Create, Read, Update, Delete | Phân loại theo môn học |
| **Folder** (Thư mục/Chương) | Create, Read, Update, Delete | Thuộc Class, tổ chức theo chương |
| **Deck** (Bộ thẻ) | Create, Read, Update, Delete | Thuộc Folder, chứa Cards |
| **Card** (Thẻ flashcard) | Create, Read, Update, Delete, Reorder (drag-drop) | Thuộc Deck, nội dung theo Template |
| **Card Template** | Create, Read, Update, Delete | Cấu trúc tùy chỉnh (Vocabulary, Q&A, Custom) |

Phân cấp dữ liệu: `Class → Folder → Deck → Card`

#### 3.1.3. Spaced Repetition System (SRS Engine)

Hệ thống SRS hỗ trợ **2 thuật toán song song**, người dùng chọn trong Settings:

**Thuật toán SM-2 (SuperMemo 2):**
- Công thức cốt lõi: `interval(n+1) = interval(n) × easeFactor`
- Mỗi thẻ có `easeFactor` riêng (mặc định 2.5, tối thiểu 1.3)
- 4 mức phản hồi: Again (reset, +10 phút), Hard (EF−0.15), Good (EF giữ nguyên), Easy (EF+0.15)

**Thuật toán FSRS (Free Spaced Repetition Scheduler):**
- Sử dụng thư viện `ts-fsrs` v5
- Trạng thái: New → Learning (steps: 1m → 15m) → Review → Relearning
- Tham số: `stability` (độ ổn định trí nhớ), `difficulty` (độ khó thẻ)

#### 3.1.4. AI-Powered Features (Google Gemini)

| Tính năng | Mô tả | Kỹ thuật |
|-----------|-------|----------|
| **AI Card Generation** | Nhập text/topic → AI tạo flashcard tự động | Gemini streaming, background job, 2 mode: Vocabulary (word, IPA, type, examples) và Q&A |
| **Semantic Search** | Tìm kiếm theo ý nghĩa, không cần khớp từ khóa | Gemini Embedding API → vector 768d → pgvector cosine distance |
| **Duplicate Detection** | Phát hiện thẻ trùng nội dung (ngưỡng 85% similarity) | Embedding cosine similarity, quét per-card hoặc full deck |
| **Concept Extraction** | Trích xuất 2-5 khái niệm chính từ mỗi thẻ | Gemini LLM → JSON array → bảng `card_concepts` |
| **Relationship Suggestion** | Gợi ý liên kết giữa thẻ tương tự | Embedding pairwise cosine (O(n²/2), giới hạn 500 thẻ) |

#### 3.1.5. Knowledge Graph

| Chức năng | Chi tiết |
|-----------|----------|
| **Graph Visualization** | Cytoscape.js — interactive node-edge graph, zoom, pan, drag |
| **Manual Linking** | Tạo/xóa liên kết (prerequisite hoặc related) giữa 2 thẻ |
| **AI-Suggested Links** | Gợi ý liên kết từ embedding similarity > 0.7 |
| **Prerequisite Chain** | BFS traversal ngược chuỗi prerequisite (max depth 10) |
| **Retention Overlay** | Node color-coded theo mức độ nhớ R(t) = e^(-t/S) |

#### 3.1.6. Study Analytics & Forecasting

| Tính năng | Mô tả | Kỹ thuật |
|-----------|-------|----------|
| **Retention Forecast** | Dự báo số thẻ at-risk trong 7-90 ngày tới | R(t) = e^(-t/S), in-memory computation |
| **Retention Heatmap** | Màu từng thẻ theo mức nhớ (xanh → đỏ) | Per-deck, sort by lowest retention |
| **At-Risk Detection** | Phát hiện thẻ chưa đến hạn nhưng đã suy giảm | R < 80% threshold |
| **Smart Groups** | Nhóm thẻ theo concept do AI trích xuất | GROUP BY concept, avg retention |
| **Related Cards** | Gợi ý thẻ liên quan khi quên (explicit links + semantic) | Link-first, supplement with pgvector |

### 3.2. Tính năng phụ trợ (Supporting Features)

| Tính năng | Mô tả |
|-----------|-------|
| **Import/Export** | Import từ CSV, Export CSV/JSON, parser hỗ trợ quoted fields |
| **Focus Mode** | Chế độ tập trung với timer, ambient sounds (Web Audio API), 3D dodecahedron dice, reward popup |
| **Interleaved Study** | Ôn tập xen kẽ nhiều deck đồng thời |
| **Card Drag & Drop** | Reorder thẻ bằng kéo thả, optimistic UI update |
| **Global Search** | Tìm kiếm toàn cục (semantic + text fallback) |
| **Dark/Light Theme** | Chuyển đổi giao diện sáng/tối, lưu localStorage |
| **Keyboard Shortcuts** | Space (flip), 1-4 (review actions) trong study mode |
| **Notifications** | Hệ thống thông báo trong app |
| **Feedback** | Form gửi góp ý/báo lỗi |
| **Docs Page** | Trang docs tích hợp (SRS document, C4 diagrams) |

---

## 4. Công nghệ & Công cụ phát triển

### 4.1. Technology Stack

| Layer | Technology | Version | Vai trò |
|-------|-----------|---------|---------|
| **Runtime** | Bun | ≥ 1.3 | JavaScript/TypeScript runtime — nhanh hơn Node.js, tích hợp package manager, bundler, test runner |
| **Backend Framework** | ElysiaJS | 1.4.x | Bun-native web framework, end-to-end type inference, schema validation |
| **ORM** | Drizzle ORM | 0.45.x | Type-safe SQL query builder, migration management, schema-as-code |
| **Database** | PostgreSQL | 15 | Relational database chính (pgvector/pgvector image) |
| **Vector Extension** | pgvector | — | Vector similarity search (cosine distance, HNSW index) |
| **Frontend Framework** | SolidJS | 1.9.x | Fine-grained reactive UI framework, no virtual DOM diffing |
| **Build Tool** | Vite | 7.3.x | Frontend dev server + production bundler |
| **Data Fetching** | TanStack Solid Query | 5.90.x | Server state management, caching, background refetching |
| **API Client** | Elysia Eden Treaty | 1.4.x | End-to-end type-safe API client (zero-config, inferred from backend) |
| **Styling** | TailwindCSS | 4.2.x | Utility-first CSS framework |
| **Graph Visualization** | Cytoscape.js | 3.33.x | Interactive graph rendering (Knowledge Graph) |
| **3D Effects** | Three.js | 0.183.x | 3D dodecahedron dice animation (Focus Mode) |
| **AI/LLM** | Google Gemini API | 0.24.x | Card generation (streaming), concept extraction, embedding |
| **Markdown Rendering** | Marked | 17.x | Render markdown content trong cards |
| **Icons** | Lucide Solid | 0.575.x | Icon set cho SolidJS |
| **Password Hashing** | @node-rs/argon2 | 2.0.x | Argon2id — OWASP recommended password hash |
| **Crypto** | oslo/crypto + oslo/encoding | 1.x | CSPRNG token generation, encoding utilities |
| **Email** | Nodemailer | 8.x | Email verification, password reset |
| **Rate Limiting** | elysia-rate-limit | 4.5.x | API rate limiting / brute-force protection |
| **Logging** | Pino | 10.3.x | Structured JSON logger (production-grade) |

### 4.2. DevOps & Infrastructure

| Hạng mục | Công cụ |
|----------|---------|
| **Containerization** | Docker Compose (PostgreSQL + Structurizr) |
| **CI/CD** | GitHub Actions — automated typecheck on push/PR |
| **Version Control** | Git + GitHub (monorepo) |
| **Architecture Docs** | Structurizr DSL → C4 Model diagrams (auto-export SVG) |
| **Database Migrations** | Drizzle Kit (generate, migrate, push, drop, reset) |
| **Database GUI** | Drizzle Studio |

---

## 5. Thiết kế hệ thống

### 5.1. Kiến trúc tổng quan (C4 - Context Level)

```
┌──────────────────────────────────────────────────────────────────┐
│                        User (Browser)                            │
└───────────────────────────┬──────────────────────────────────────┘
                            │ HTTPS
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│  Frontend — SolidJS SPA (Vite)                                   │
│  ┌────────────┐ ┌──────────────┐ ┌──────────────────────────┐   │
│  │ Pages      │ │ Components   │ │ Stores (signals)         │   │
│  │ (routing)  │ │ (UI/layout)  │ │ (auth, theme, focus...)  │   │
│  └────────────┘ └──────────────┘ └──────────────────────────┘   │
│            │                                                     │
│            │ Eden Treaty (type-safe HTTP client)                  │
└────────────┼─────────────────────────────────────────────────────┘
             │ REST API (JSON)
             ▼
┌──────────────────────────────────────────────────────────────────┐
│  Backend — ElysiaJS (Bun Runtime)                                │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Plugins: CORS, Rate Limit, Auth Middleware              │   │
│  └──────────────────────────────────────────────────────────┘   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────────┐    │
│  │ Auth     │ │ Cards    │ │ Study    │ │ AI / Embedding │    │
│  │ Module   │ │ Module   │ │ Module   │ │ Module         │    │
│  └──────────┘ └──────────┘ └──────────┘ └────────────────┘    │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────────┐    │
│  │ Classes  │ │ Folders  │ │ Decks    │ │ Knowledge      │    │
│  │ Module   │ │ Module   │ │ Module   │ │ Graph Module   │    │
│  └──────────┘ └──────────┘ └──────────┘ └────────────────┘    │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────────┐    │
│  │ Search   │ │ Import/  │ │ Users    │ │ Templates      │    │
│  │ Module   │ │ Export   │ │ Module   │ │ Module         │    │
│  └──────────┘ └──────────┘ └──────────┘ └────────────────┘    │
│            │                                                     │
│            │ Drizzle ORM (SQL query builder)                     │
└────────────┼─────────────────────────────────────────────────────┘
             │
             ▼
┌──────────────────────────┐    ┌────────────────────────────────┐
│  PostgreSQL 15           │    │  Google Gemini API              │
│  + pgvector extension    │    │  ├── Generative (card gen)      │
│  ├── 16 tables           │    │  ├── Embedding (vector 768d)    │
│  ├── HNSW vector index   │    │  └── Streaming (real-time)      │
│  └── Docker container    │    └────────────────────────────────┘
└──────────────────────────┘
```

### 5.2. Database Schema (ERD Overview)

Hệ thống gồm **16 bảng** chính:

```
┌──────────────────────────────────────────────────────────────────┐
│                         users                                    │
│  id (PK), email, password_hash, display_name, avatar_url,       │
│  srs_algorithm, email_verified, created_at                       │
└──────┬───────────────────────────────────────────────────────────┘
       │ 1:N
       ├──► sessions (id, user_id, token, expires_at)
       ├──► classes (id, user_id, name, color, sort_order)
       │         └──► folders (id, class_id, name, sort_order)
       │                  └──► decks (id, folder_id, user_id, name, card_template_id)
       │                           └──► cards (id, deck_id, sort_order)
       │                                  ├──► card_field_values (id, card_id, template_field_id, value, embedding)
       │                                  ├──► card_links (id, source_card_id, target_card_id, link_type)
       │                                  └──► card_concepts (id, card_id, concept)
       │
       ├──► card_templates (id, user_id, name, is_system)
       │         └──► template_fields (id, template_id, name, field_type, side, sort_order)
       │
       ├──► study_progress (id, user_id, card_id, box_level, ease_factor, interval_days,
       │         next_review_at, last_reviewed_at, stability, difficulty, fsrs_state)
       │
       ├──► review_logs (id, user_id, card_id, action, box_level_before/after, ...)
       ├──► study_daily_logs (id, user_id, date, cards_studied, ...)
       ├──► ai_generation_jobs (id, user_id, deck_id, source_text, status, generated_cards, model)
       ├──► password_reset_tokens (id, user_id, token, expires_at)
       └──► fsrs_user_params (id, user_id, params)
```

**Thiết kế đáng chú ý:**

- **EAV Pattern** cho `card_field_values`: Nội dung thẻ lưu theo cặp (card_id, template_field_id, value:JSONB) — cho phép template tùy chỉnh mà không cần migrate schema.
- **pgvector column** trên `card_field_values.embedding`: Vector 768 chiều lưu trong cùng bảng, không cần database riêng.
- **Dual SRS state** trên `study_progress`: Chứa cả SM-2 fields (`box_level`, `ease_factor`, `interval_days`) và FSRS fields (`stability`, `difficulty`, `fsrs_state`) — nullable cho FSRS, backward-compatible.
- **Composite indexes**: `idx_sp_user_next_review` (userId, nextReviewAt) cho query "cards due today" hiệu quả.

### 5.3. Module Architecture

Mỗi module backend tuân theo cấu trúc:

```
modules/<module-name>/
├── <module>.routes.ts    → Route definitions + request validation
└── <module>.service.ts   → Business logic + database operations
```

Tổng cộng **15 modules**, tách biệt rõ ràng theo Single Responsibility Principle.

---

## 6. Quy trình phát triển Agile–Scrum

### 6.1. Sprint Overview

| Sprint | Thời gian | Theme | Deliverables |
|--------|-----------|-------|--------------|
| Sprint 0 | Week 1 | **Project Bootstrap** | Repo setup, Docker, DB schema, CI pipeline |
| Sprint 1 | Week 2–3 | **Core CRUD & Auth** | Authentication, Class/Folder/Deck/Card CRUD, Template system |
| Sprint 2 | Week 3–4 | **SRS Engine & Study Mode** | SM-2 implementation, Study UI, Keyboard shortcuts |
| Sprint 3 | Week 4–5 | **AI Integration & Search** | Gemini card generation, Embedding pipeline, Semantic search |
| Sprint 4 | Week 5–6 | **Knowledge Graph & Analytics** | Graph visualization, FSRS, Forecast, Heatmap, Duplicate detection |
| Sprint 5 | Week 6–7 | **Polish & Optimization** | Focus mode, Import/Export, Performance, CI/CD, Documentation |

### 6.2. Work Breakdown Structure (WBS)

#### Sprint 0 — Project Bootstrap

```
WBS 0: Project Bootstrap
│
├── 0.1 Repository & Monorepo Setup
│   ├── 0.1.1 Initialize Git repository on GitHub
│   ├── 0.1.2 Configure Bun Workspaces (apps/*, packages/*)
│   ├── 0.1.3 Setup root package.json with workspace scripts
│   └── 0.1.4 Configure .gitignore, README.md
│
├── 0.2 Backend Scaffolding
│   ├── 0.2.1 Initialize @engram/api with ElysiaJS
│   ├── 0.2.2 Configure Drizzle ORM + drizzle.config.ts
│   ├── 0.2.3 Setup environment variables (.env.example)
│   ├── 0.2.4 Configure CORS, rate limiting plugins
│   └── 0.2.5 Setup Pino structured logger
│
├── 0.3 Frontend Scaffolding
│   ├── 0.3.1 Initialize @engram/web with Vite + SolidJS
│   ├── 0.3.2 Configure TailwindCSS v4
│   ├── 0.3.3 Setup SolidJS Router
│   ├── 0.3.4 Configure Eden Treaty API client
│   └── 0.3.5 Design CSS variable system (light/dark theme)
│
├── 0.4 Database & Infrastructure
│   ├── 0.4.1 Create docker-compose.yml (pgvector/pgvector:pg15)
│   ├── 0.4.2 Design initial schema (users, sessions, classes, folders)
│   ├── 0.4.3 Run first migration (drizzle-kit generate + migrate)
│   └── 0.4.4 Create seed script (system templates + test user)
│
└── 0.5 CI/CD Pipeline
    ├── 0.5.1 Create GitHub Actions workflow (ci.yml)
    ├── 0.5.2 Configure automated typecheck on push/PR
    └── 0.5.3 Setup Bun setup-action with frozen lockfile
```

#### Sprint 1 — Core CRUD & Authentication

```
WBS 1: Core CRUD & Authentication
│
├── 1.1 Authentication Module
│   ├── 1.1.1 Implement user registration (email/password)
│   ├── 1.1.2 Implement argon2 password hashing
│   ├── 1.1.3 Implement session-based login (oslo/crypto token)
│   ├── 1.1.4 Create auth middleware for protected routes
│   ├── 1.1.5 Implement logout (session deletion)
│   ├── 1.1.6 Implement email verification flow (Nodemailer)
│   └── 1.1.7 Implement password reset flow (token + email)
│
├── 1.2 Content Hierarchy CRUD
│   ├── 1.2.1 Classes module — CRUD routes + service
│   ├── 1.2.2 Folders module — CRUD routes + service (scoped to class)
│   ├── 1.2.3 Decks module — CRUD routes + service (scoped to folder)
│   ├── 1.2.4 Cards module — CRUD routes + service (scoped to deck)
│   └── 1.2.5 Card sort order management (drag-drop reorder)
│
├── 1.3 Card Template System
│   ├── 1.3.1 Design card_templates + template_fields schema
│   ├── 1.3.2 System templates: Default (Front/Back), Vocabulary, Q&A
│   ├── 1.3.3 Custom template CRUD
│   └── 1.3.4 EAV card_field_values storage (JSONB)
│
└── 1.4 Frontend — Auth & Content Pages
    ├── 1.4.1 Login page + form validation
    ├── 1.4.2 Register page + email verification
    ├── 1.4.3 Dashboard page (class/folder/deck tree)
    ├── 1.4.4 Deck view page (card list, CRUD modals)
    ├── 1.4.5 Auth store (SolidJS signal-based state)
    ├── 1.4.6 Toast notification system
    └── 1.4.7 Sidebar navigation + responsive layout
```

#### Sprint 2 — SRS Engine & Study Mode

```
WBS 2: SRS Engine & Study Mode
│
├── 2.1 SM-2 Algorithm Implementation
│   ├── 2.1.1 Implement calculateNextReview() — 4 actions
│   ├── 2.1.2 Define SM-2 constants (DEFAULT_EF, MIN_EF, EF_DELTA values)
│   ├── 2.1.3 Implement study_progress schema + indexes
│   ├── 2.1.4 Implement review_logs for audit trail
│   └── 2.1.5 Study session service (get due cards, submit review)
│
├── 2.2 Study Mode Frontend
│   ├── 2.2.1 Study mode page — card flip animation
│   ├── 2.2.2 Review action buttons (Again, Hard, Good, Easy)
│   ├── 2.2.3 Keyboard shortcuts (Space, 1-4)
│   ├── 2.2.4 Progress bar + remaining cards counter
│   ├── 2.2.5 Session summary (cards reviewed, accuracy)
│   └── 2.2.6 Interleaved study mode (multi-deck)
│
└── 2.3 Study Optimization
    ├── 2.3.1 Partial composite index: idx_sp_user_next_review
    ├── 2.3.2 Cursor-based pagination for large decks
    └── 2.3.3 Optimistic UI updates for review submissions
```

#### Sprint 3 — AI Integration & Search

```
WBS 3: AI Integration & Search
│
├── 3.1 AI Card Generation Service
│   ├── 3.1.1 Gemini API client configuration (lazy-init, rate limit)
│   ├── 3.1.2 Vocabulary prompt engineering (vocab.prompt.ts)
│   ├── 3.1.3 Q&A prompt engineering (qa.prompt.ts)
│   ├── 3.1.4 Background job system (ai_generation_jobs table)
│   ├── 3.1.5 Streaming response handler + JSON parser
│   ├── 3.1.6 Job lifecycle: processing → pending → saved/expired
│   ├── 3.1.7 Orphan job recovery on server startup
│   └── 3.1.8 Stale job cleanup (24h expiration)
│
├── 3.2 Embedding Pipeline
│   ├── 3.2.1 Gemini Embedding API client (768-dim Matryoshka truncation)
│   ├── 3.2.2 Batch embedding generation (single API call for N texts)
│   ├── 3.2.3 pgvector column migration on card_field_values
│   ├── 3.2.4 Embedding storage helper (raw SQL for large vectors)
│   ├── 3.2.5 Auto-embed hook on card create/update (fire-and-forget)
│   └── 3.2.6 Backfill service (chunked batch, yield between iterations)
│
├── 3.3 Semantic Search
│   ├── 3.3.1 searchByEmbedding() — pgvector cosine distance
│   ├── 3.3.2 Text search fallback (ILIKE)
│   ├── 3.3.3 Hybrid strategy: semantic-first, text-fallback
│   ├── 3.3.4 Result enrichment (card fields + deck names)
│   └── 3.3.5 Frontend search UI (global search modal)
│
└── 3.4 AI Card Generation Frontend
    ├── 3.4.1 AI generation form (text input, language selector)
    ├── 3.4.2 Job polling (status check interval)
    ├── 3.4.3 Card preview + inline editing
    └── 3.4.4 Batch save with embedding auto-generation
```

#### Sprint 4 — Knowledge Graph & Analytics

```
WBS 4: Knowledge Graph & Analytics
│
├── 4.1 Knowledge Graph Backend
│   ├── 4.1.1 card_links schema (source_card, target_card, link_type)
│   ├── 4.1.2 card_concepts schema (card_id, concept)
│   ├── 4.1.3 Link CRUD service + ownership verification
│   ├── 4.1.4 getDeckGraph() — nodes + edges query (parallel fetch)
│   ├── 4.1.5 Retention overlay (R(t) per node)
│   └── 4.1.6 Search for linking (ILIKE on card front text)
│
├── 4.2 AI-Powered Graph Features
│   ├── 4.2.1 detectRelationships() — pairwise embedding cosine
│   ├── 4.2.2 extractConcepts() — Gemini LLM → card_concepts
│   ├── 4.2.3 Prerequisite chain (BFS, max depth 10)
│   └── 4.2.4 Duplicate detection service (per-card + full-deck scan)
│
├── 4.3 FSRS Implementation
│   ├── 4.3.1 Integrate ts-fsrs v5 library
│   ├── 4.3.2 Implement calculateFsrsReview() engine
│   ├── 4.3.3 Add FSRS columns to study_progress (nullable)
│   ├── 4.3.4 dispatchReview() router (SM-2 or FSRS)
│   ├── 4.3.5 User algorithm preference (srs_algorithm column)
│   └── 4.3.6 Fix learning_steps persistence bug
│
├── 4.4 Analytics Suite
│   ├── 4.4.1 Retention forecast service (R(t) per day, 1-90 days)
│   ├── 4.4.2 Retention heatmap service (per-deck, color-coded)
│   ├── 4.4.3 At-risk card detection (R < 80%, not yet due)
│   ├── 4.4.4 Smart groups (concept-based clustering, avg retention)
│   ├── 4.4.5 Related cards recommendation (links + semantic)
│   └── 4.4.6 Forecast widget + Smart groups widget (frontend)
│
└── 4.5 Knowledge Graph Frontend
    ├── 4.5.1 Cytoscape.js graph rendering
    ├── 4.5.2 Node retention color coding
    ├── 4.5.3 Link management UI (create/delete)
    └── 4.5.4 AI suggestion review modal
```

#### Sprint 5 — Polish & Optimization

```
WBS 5: Polish & Optimization
│
├── 5.1 Focus Mode (Gamification)
│   ├── 5.1.1 Focus drawer (timer, session history)
│   ├── 5.1.2 Ambient sounds (Web Audio API — break chime, dice roll)
│   ├── 5.1.3 Three.js dodecahedron dice animation
│   ├── 5.1.4 Reward popup with confetti effects
│   └── 5.1.5 localStorage session persistence
│
├── 5.2 Import/Export
│   ├── 5.2.1 CSV parser (handles quoted fields, commas in values)
│   ├── 5.2.2 CSV import (header→field mapping, batch insert)
│   ├── 5.2.3 CSV export (field values → escaped CSV text)
│   ├── 5.2.4 JSON export (deck structure + field data)
│   └── 5.2.5 Chunked fetch for large decks (500/batch)
│
├── 5.3 Performance Optimization
│   ├── 5.3.1 Lazy loading routes (SolidJS lazy())
│   ├── 5.3.2 Async font loading + inline loading shell
│   ├── 5.3.3 WebP asset conversion (PNG → WebP)
│   ├── 5.3.4 createMemo() for derived computations
│   ├── 5.3.5 batch() for multiple signal updates
│   ├── 5.3.6 Infinite scroll with server-side pagination
│   └── 5.3.7 Query client refetch on window focus
│
├── 5.4 UI/UX Refinements
│   ├── 5.4.1 3-layer dark mode depth system
│   ├── 5.4.2 Error handling with recursive error extraction
│   ├── 5.4.3 Settings page (SRS algorithm, profile, theme)
│   ├── 5.4.4 Sticky scroll-aware deck header
│   ├── 5.4.5 Route announcer (accessibility)
│   └── 5.4.6 Loading spinner with conic gradient animation
│
└── 5.5 Documentation & Architecture
    ├── 5.5.1 C4 Model diagrams (Structurizr DSL → SVG pipeline)
    ├── 5.5.2 SRS document (docs/srs/srs.md)
    ├── 5.5.3 In-app docs page (/docs)
    ├── 5.5.4 README.md with quickstart guide
    └── 5.5.5 Project presentation materials
```

### 6.3. Sprint Ceremonies

**Daily Scrum:**
- Cập nhật tiến độ; xác định blockers; đồng bộ kế hoạch trong ngày.

**Sprint Review:**
- Demo tính năng hoàn thành; so sánh Actual vs Planned deliverables; thu thập feedback.

**Sprint Retrospective:**
- Phân tích điểm mạnh (What went well); điểm cần cải thiện (What didn't go well); action items cho sprint tiếp theo.

---

## 7. Kiểm thử & Đảm bảo chất lượng

### 7.1. Chiến lược kiểm thử

| Cấp độ | Phương pháp | Công cụ | Mô tả |
|--------|-------------|---------|--------|
| **Unit Testing** | Automated | Bun Test (`bun:test`) | 198 test cases cho backend service layer (pure functions + mocked DB) |
| **Static Analysis** | Type checking | TypeScript `tsc --noEmit` | Kiểm tra kiểu dữ liệu toàn project (CI/CD automated) |
| **API Testing** | Manual/Automated | Postman / cURL | Kiểm tra endpoint behavior, error handling |
| **E2E Type Safety** | Compile-time | Eden Treaty | Thay đổi API → frontend báo lỗi ngay khi code |
| **Integration Testing** | Manual | Browser DevTools | Kiểm tra tương tác giữa các module |

**Backend Unit Test Coverage:**

| Phân loại | Số test | Mô tả |
|-----------|---------|-------|
| Pure functions | 85 | SRS engine (SM-2 + FSRS), errors, constants, embedding-utils |
| Service layer (mocked DB) | 113 | auth, decks, cards, classes, folders, study, forecast, card-templates, users, notifications, AI, knowledge-graph, import-export |
| **Tổng** | **198** | **20 test files, ~340 assertions, runtime ~500ms** |

### 7.2. CI/CD Pipeline

```yaml
# .github/workflows/ci.yml
Trigger: push to main/master, pull_request
Steps:
  1. Checkout code
  2. Setup Bun (latest)
  3. Install dependencies (frozen lockfile)
  4. Run typecheck (bun run typecheck)
```

Pipeline chạy tự động trên mỗi commit/PR, đảm bảo **zero type errors** trước khi merge.

### 7.3. Security Measures

| Biện pháp | Triển khai |
|-----------|------------|
| Password hashing | argon2id (OWASP recommended) |
| Session tokens | CSPRNG (oslo/crypto) |
| Rate limiting | elysia-rate-limit (chống brute-force) |
| CORS | Whitelist origins |
| Input validation | Elysia schema validation (auto-reject invalid requests) |
| SQL Injection | Drizzle ORM parameterized queries |
| Ownership verification | Per-request user ownership check trên mọi resource |

---

## 8. Kết quả & Sản phẩm bàn giao

### 8.1. Deliverables — Tài liệu kỹ thuật

| Tài liệu | Đường dẫn | Mô tả |
|-----------|-----------|--------|
| Software Requirements Specification | `docs/srs/srs.md` | Tài liệu đặc tả yêu cầu phần mềm |
| C4 Architecture Diagrams | `docs/c4/workspace.dsl` | Sơ đồ kiến trúc 4 cấp (Structurizr DSL → SVG) |
| Project Presentation | `docs/project_presebtation.md` | Tài liệu tóm tắt dự án |
| Q&A Preparation | `docs/project_description.md` | Giải thích kỹ thuật + chuẩn bị câu hỏi bảo vệ |

### 8.2. Deliverables — Source Code

| Package | Mô tả | Kích thước |
|---------|--------|------------|
| `apps/api/` | Backend — 15 modules, ~60 files | ElysiaJS, Drizzle ORM |
| `apps/web/` | Frontend — 12 pages, ~40 components | SolidJS, Vite |
| `packages/shared/` | Shared types | TypeScript interfaces |

### 8.3. Thống kê dự án

| Metric | Giá trị |
|--------|---------|
| Tổng số commits | 51 |
| Backend modules | 15 |
| Database tables | 16 |
| Frontend pages | 12 |
| API endpoints | ~60 |
| External integrations | 3 (Gemini AI, Nodemailer, pgvector) |

### 8.4. Triển khai

| Hạng mục | Chi tiết |
|----------|----------|
| **Local Development** | `bun install` → `docker-compose up -d` → `bun run db:migrate` → `bun run dev` |
| **Frontend** | http://localhost:3002 |
| **Backend API** | http://localhost:3001 |
| **Test credentials** | `test@example.com` / `password123` |

---

## 9. So sánh cạnh tranh & Đóng góp

### 9.1. Feature Comparison Matrix

| Feature | Quizlet | Anki | **Engram-Spira** |
|---------|---------|------|-------------------|
| SRS Algorithm | Basic | SM-2 only | **SM-2 + FSRS** (selectable) |
| AI Card Generation | Paid tier | ❌ | **✅ Gemini** (streaming) |
| Knowledge Graph | ❌ | ❌ | **✅ Cytoscape.js** |
| Semantic Search | ❌ | ❌ | **✅ pgvector** |
| Duplicate Detection | ❌ | ❌ | **✅ Embedding similarity** |
| Retention Forecast | Basic | Plugin | **✅ R(t) = e^(-t/S)** |
| E2E Type Safety | ❌ | ❌ | **✅ Eden Treaty** |
| Custom Card Templates | Limited | ✅ | **✅ EAV system** |
| Import/Export | ✅ | ✅ | **✅ CSV + JSON** |
| Open Source | ❌ | ✅ | **✅** |

### 9.2. Technical Contributions

1. **Dual SRS Architecture** — Chạy song song SM-2 và FSRS trong cùng storage layer, backward-compatible.
2. **Unified Vector Pipeline** — Embedding + search + duplicate detection + graph suggestions đều sử dụng chung pgvector, không cần infrastructure riêng.
3. **Background AI Job System** — Non-blocking card generation với lifecycle management và orphan recovery.
4. **End-to-End Type Safety** — Từ schema definition (Drizzle) → API response (ElysiaJS) → client call (Eden Treaty) → UI rendering (SolidJS).

---

## 10. Hạn chế & Hướng phát triển

### 10.1. Hạn chế hiện tại

- Chưa có integration test và frontend test toàn diện (backend đã có 198 unit tests).
- Chưa deploy production (chỉ chạy local development).
- Focus Mode gamification còn đơn giản.
- Knowledge Graph chưa hỗ trợ cross-deck visualization.

### 10.2. Hướng phát triển tương lai

| Tính năng | Mức độ ưu tiên | Mô tả |
|-----------|----------------|-------|
| Production Deployment | High | Deploy trên Vercel (frontend) + Railway/Fly.io (backend + Postgres) |
| Unit Testing | High | Bun test runner cho backend service layer |
| Mobile Responsive | Medium | Optimize study mode cho mobile browsers |
| Multi-user Sharing | Medium | Share decks giữa người dùng |
| Spaced Repetition Analytics | Low | Visualize learning curves per user |
