# Engram Spira — Next Phase Implementation Plan

> **Approach:** Incremental Delivery (4 phases) · **Strategy:** Foundation First  
> **Capacity:** Solo, full-time (~35-40h/week)  
> **Core Value:** 🔥 Performance is Priority — mọi quyết định thiết kế đều ưu tiên latency và throughput  
> **Tổng timeline ước tính:** ~5-5.5 tuần  
> **Created:** 2026-03-19  
> **Phase 1:** ✅ COMPLETED (2026-03-19) — Dice rounded, Email verification, review_logs retention, Embedding infra  
> **Phase 2:** ✅ COMPLETED (2026-03-19) — Semantic Search, Forgetting Forecast, Card Templates CRUD  
> **Phase 3:** ✅ COMPLETED (2026-03-19) — AI Duplicate Detection, Knowledge Graph Core  
> **Phase 4:** ✅ COMPLETED (2026-03-19) — KG AI auto-detect, Study Recommendations, Smart Grouping, Prerequisite Chains

---

## Mục lục

- [Tổng quan Features](#tổng-quan-features)
- [Dependency Graph](#dependency-graph)
- [Phase 1: Foundation + Quick Wins](#phase-1-foundation--quick-wins-1-tuần)
- [Phase 2: First Consumers + High Value](#phase-2-first-consumers--high-value-15-tuần)
- [Phase 3: AI Intelligence Layer](#phase-3-ai-intelligence-layer-15-tuần)
- [Phase 4: Advanced AI + Polish](#phase-4-advanced-ai--polish-1-15-tuần)
- [Performance Checklist](#performance-checklist)
- [Risk Register](#risk-register)

---

## Tổng quan Features

| #   | Feature                                 | Nguồn | Phase | Effort  | Depends On |
| --- | --------------------------------------- | ----- | ----- | ------- | ---------- |
| 1   | Dice border-radius (rounded corners)    | Q3    | 1     | ~1h     | —          |
| 2   | Email Verification                      | Q2    | 1     | ~1-1.5d | —          |
| 3   | review_logs retention policy            | Q5    | 1     | ~0.5d   | —          |
| 4   | Embedding Infrastructure                | Q4    | 1     | ~3-4d   | —          |
| 5   | Semantic Search                         | Q4    | 2     | ~2-3d   | #4         |
| 6   | Forgetting Forecast & Retention Heatmap | Q6    | 2     | ~3-5d   | —          |
| 7   | Custom Card Templates UI                | Q1    | 2     | ~2-3d   | —          |
| 8   | AI Duplicate Detection                  | Q4    | 3     | ~2-3d   | #4         |
| 9   | Knowledge Graph Core                    | Q7    | 3     | ~5-6d   | —          |
| 10  | Knowledge Graph AI auto-detect          | Q4+Q7 | 4     | ~3-4d   | #4, #9     |
| 11  | Study Recommendations + Smart Grouping  | Q4    | 4     | ~3-4d   | #4         |

---

## Dependency Graph

```text
Embedding Infrastructure (#4)
├── Semantic Search (#5)
├── AI Duplicate Detection (#8)
├── KG AI auto-detect (#10) ── also depends on → KG Core (#9)
├── Study Recommendations (#11)
└── Smart Grouping (#11)

Knowledge Graph Core (#9)
└── KG AI auto-detect (#10)

INDEPENDENT:
├── Dice border-radius (#1)
├── Email Verification (#2)
├── review_logs retention (#3)
├── Forgetting Forecast (#6) ← uses study_progress, NOT embedding
└── Custom Card Templates UI (#7) ← backend API already exists
```

---

## Phase 1: Foundation + Quick Wins (~1 tuần)

**Mục tiêu:** Dọn quick wins + xây embedding infrastructure — nền tảng cho Phase 2-4.

### 1.1 Dice Border-Radius (Rounded Corners)

**Effort:** ~1 giờ

**Files:**

- Modify: `apps/web/src/components/focus/dodecahedron-dice.tsx`
- Modify: `apps/web/package.json` (thêm `three-stdlib`)

**Chi tiết:**

Hiện tại dice dùng `THREE.BoxGeometry` — các góc vuông 90°. Thay bằng `RoundedBoxGeometry` từ `three-stdlib`:

```typescript
// BEFORE
import * as THREE from 'three';
const geometry = new THREE.BoxGeometry(1.6, 1.6, 1.6);

// AFTER
import { RoundedBoxGeometry } from 'three-stdlib';
const geometry = new RoundedBoxGeometry(1.6, 1.6, 1.6, 4, 0.15);
//                                      w    h    d   segments  radius
```

**Lưu ý:**

- `segments = 4`: đủ mượt, không cần cao hơn (performance)
- `radius = 0.15`: bo tròn nhẹ, giống xúc xắc thật. Điều chỉnh 0.05–0.3 tùy ý
- `EdgesGeometry` cũng cần dùng geometry mới: `new THREE.EdgesGeometry(geometry)`
- Kiểm tra canvas texture mapping vẫn đúng sau khi thay geometry

**Steps:**

- [ ] Install `three-stdlib` vào `apps/web`
- [ ] Thay `BoxGeometry` → `RoundedBoxGeometry` trong `dodecahedron-dice.tsx`
- [ ] Cập nhật `EdgesGeometry` reference
- [ ] Test visual: xúc xắc phải bo tròn nhẹ, dots + colors vẫn render đúng, animation unchanged
- [ ] Commit: `feat(focus): rounded dice corners using RoundedBoxGeometry`

---

### 1.2 Email Verification

**Effort:** ~1-1.5 ngày

**Files:**

- Modify: `apps/api/src/db/schema/users.ts` — thêm `emailVerified`, `emailVerificationToken`, `emailTokenExpiresAt`
- Create: `apps/api/src/db/migrations/0021_add_email_verification.sql`
- Modify: `apps/api/src/shared/email.ts` — thêm `sendVerificationEmail()`
- Modify: `apps/api/src/modules/auth/auth.service.ts` — integrate verification vào register flow
- Modify: `apps/api/src/modules/auth/auth.routes.ts` — thêm `GET /auth/verify-email`
- Modify: `apps/web/src/pages/dashboard.tsx` hoặc layout — banner "verify your email"

**Schema changes:**

```typescript
// users.ts — thêm 3 cột
emailVerified: boolean('email_verified').notNull().default(false),
emailVerificationToken: varchar('email_verification_token', { length: 64 }),
emailTokenExpiresAt: timestamp('email_token_expires_at', { withTimezone: true }),
```

```sql
-- 0021_add_email_verification.sql
ALTER TABLE "users" ADD COLUMN "email_verified" boolean NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "email_verification_token" varchar(64);
ALTER TABLE "users" ADD COLUMN "email_token_expires_at" timestamptz;
CREATE INDEX "idx_users_verification_token" ON "users" ("email_verification_token") WHERE "email_verification_token" IS NOT NULL;
```

**Backend logic:**

```typescript
// email.ts — thêm function
export async function sendVerificationEmail(
  toEmail: string,
  token: string,
): Promise<void> {
  const verifyLink = `${ENV.FRONTEND_URL}/verify-email?token=${token}`;
  // HTML template giống pattern sendPasswordResetEmail
  // Subject: "Engram Spira — Verify Your Email"
  // Body: link + "expires in 24 hours"
}
```

```typescript
// auth.service.ts — trong register()
// Sau khi tạo user:
// 1. Generate random token: crypto.randomBytes(32).toString('hex')
// 2. Lưu token + expiresAt (24h) vào users table
// 3. Gọi sendVerificationEmail() — ASYNC (không await, không block register response)
//    → dùng .catch(logger.error) để không block nếu email fail
```

```typescript
// auth.routes.ts — thêm endpoint
// GET /auth/verify-email?token=xxx
// 1. Tìm user có emailVerificationToken === token AND emailTokenExpiresAt > NOW
// 2. Nếu found: SET emailVerified = true, CLEAR token + expiresAt
// 3. Nếu not found/expired: return error
// 4. Redirect hoặc return success JSON
```

**Frontend:**

- Dashboard/layout: `Show when={!user.emailVerified}` → banner nhẹ với "Verify your email" + resend button
- `GET /verify-email` page: nhận token từ URL, gọi API, hiển thị kết quả

**⚡ Performance notes:**

- Email gửi **async fire-and-forget** — register response không chờ email
- Partial index trên `email_verification_token WHERE NOT NULL` — chỉ index rows cần thiết
- Banner check dùng user data đã có từ session — ZERO extra query

**Steps:**

- [ ] Tạo migration `0021_add_email_verification.sql`
- [ ] Cập nhật schema `users.ts` — thêm 3 cột mới
- [ ] Thêm `sendVerificationEmail()` vào `email.ts`
- [ ] Cập nhật `auth.service.ts` → register gửi verification email (async, fire-and-forget)
- [ ] Thêm `GET /auth/verify-email` endpoint vào `auth.routes.ts`
- [ ] Thêm `POST /auth/resend-verification` endpoint (rate-limited: 3 requests/10 min)
- [ ] Frontend: tạo `/verify-email` page
- [ ] Frontend: banner "Verify your email" trên dashboard khi `emailVerified === false`
- [ ] Test: register → email gửi → click link → verified
- [ ] Commit: `feat(auth): email verification flow`

---

### 1.3 review_logs Retention Policy

**Effort:** ~0.5 ngày

**Files:**

- Create: `apps/api/src/modules/study/review-logs-cleanup.ts`
- Modify: `apps/api/src/index.ts` — gọi cleanup khi startup + optional interval

**Chi tiết:**

Bảng `review_logs` là append-only (immutable). Mỗi review = 1 row mới, không bao giờ bị xóa. Cần policy:

```typescript
// review-logs-cleanup.ts
import { sql, lt } from 'drizzle-orm';
import { db } from '../../db';
import { reviewLogs } from '../../db/schema';
import { logger } from '../../shared/logger';

const RETENTION_DAYS = 730; // 2 năm — đủ cho FSRS optimization + analytics
const BATCH_SIZE = 5000; // Delete in batches to avoid long locks

/**
 * Delete review_logs older than RETENTION_DAYS.
 * Runs in batches to minimize lock contention and memory usage.
 * Index idx_rl_user_reviewed_at ensures efficient range scan.
 */
export async function cleanupOldReviewLogs(): Promise<number> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000);
  let totalDeleted = 0;

  while (true) {
    const result = await db.execute<{ count: number }>(sql`
      DELETE FROM review_logs
      WHERE id IN (
        SELECT id FROM review_logs
        WHERE reviewed_at < ${cutoff}
        LIMIT ${BATCH_SIZE}
      )
      RETURNING 1
    `);

    const batchCount = result.length;
    totalDeleted += batchCount;

    if (batchCount < BATCH_SIZE) break; // No more rows to delete

    // Yield to event loop between batches — prevent starving other requests
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  if (totalDeleted > 0) {
    logger.info(
      { totalDeleted, retentionDays: RETENTION_DAYS },
      'Review logs cleanup completed',
    );
  }
  return totalDeleted;
}
```

```typescript
// index.ts — thêm vào startup (sau server listen)
import { cleanupOldReviewLogs } from './modules/study/review-logs-cleanup';

// Run cleanup once on startup (non-blocking)
cleanupOldReviewLogs().catch((err) =>
  logger.warn({ err: err.message }, 'Review logs cleanup failed'),
);

// Optional: schedule periodic cleanup (every 24h)
setInterval(
  () => {
    cleanupOldReviewLogs().catch((err) =>
      logger.warn({ err: err.message }, 'Periodic review logs cleanup failed'),
    );
  },
  24 * 60 * 60 * 1000,
);
```

**⚡ Performance notes:**

- **Batched DELETE** (5000 rows/batch) — tránh table lock lâu
- **`setTimeout(100)`** giữa batches — yield event loop cho requests khác
- **Index-backed** — `idx_rl_user_reviewed_at` đã có, DELETE dùng range scan O(log n)
- **Startup + periodic** — không cần external cron, chạy in-process

**Steps:**

- [ ] Tạo `review-logs-cleanup.ts` với batched delete logic
- [ ] Thêm startup call + periodic interval vào `index.ts`
- [ ] Test: tạo dummy old logs → verify cleanup xóa đúng
- [ ] Commit: `feat(study): review_logs retention policy (730 days)`

---

### 1.4 Embedding Infrastructure (pgvector + Pipeline)

**Effort:** ~3-4 ngày. ĐÂY LÀ NỀN TẢNG CHO PHASE 2, 3, 4.

**Files:**

- Create: `apps/api/src/db/migrations/0022_add_embedding_infrastructure.sql`
- Modify: `apps/api/src/db/schema/cards.ts` — thêm `embedding` column conceptually (pgvector managed via raw SQL)
- Create: `apps/api/src/modules/embedding/embedding.service.ts` — core embedding logic
- Create: `apps/api/src/modules/embedding/embedding.routes.ts` — admin/internal endpoints
- Modify: `apps/api/src/config/env.ts` — thêm `GEMINI_EMBEDDING_MODEL`
- Modify: `apps/api/src/index.ts` — mount routes + startup backfill
- Create: `apps/api/src/modules/embedding/embedding.queue.ts` — background job processor

#### 1.4.1 Database Setup

```sql
-- 0022_add_embedding_infrastructure.sql

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding column to card_field_values
-- Stores 768-dimensional vector from Gemini text-embedding-004
ALTER TABLE "card_field_values" ADD COLUMN "embedding" vector(768);

-- HNSW index for fast approximate nearest neighbor search
-- vector_cosine_ops = cosine similarity (best for text embeddings)
-- m=16, ef_construction=64 = good balance of speed/accuracy for <1M vectors
CREATE INDEX "idx_cfv_embedding"
  ON "card_field_values"
  USING hnsw ("embedding" vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Partial index: only index rows that HAVE embeddings (save space)
-- Uncomment this and remove the above if you prefer partial indexing:
-- CREATE INDEX "idx_cfv_embedding"
--   ON "card_field_values"
--   USING hnsw ("embedding" vector_cosine_ops)
--   WITH (m = 16, ef_construction = 64)
--   WHERE "embedding" IS NOT NULL;

-- Track embedding status per card for backfill progress
CREATE TABLE IF NOT EXISTS "embedding_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "card_id" uuid NOT NULL REFERENCES "cards"("id") ON DELETE CASCADE,
  "status" varchar(20) NOT NULL DEFAULT 'pending',  -- pending | processing | done | failed
  "error" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "completed_at" timestamptz,
  UNIQUE ("card_id")
);
CREATE INDEX "idx_embedding_jobs_status" ON "embedding_jobs" ("status") WHERE "status" = 'pending';
```

#### 1.4.2 Embedding Service

```typescript
// embedding.service.ts — Core logic

// Key functions:
// 1. generateEmbedding(text: string): Promise<number[]>
//    - Call Gemini text-embedding-004 API
//    - Return 768-dim float array
//    - Cache-friendly: idempotent, same text = same vector
//
// 2. generateEmbeddings(texts: string[]): Promise<number[][]>
//    - Batch API call (Gemini supports batch embed)
//    - Reduce roundtrips: 50 texts in 1 call vs 50 calls
//
// 3. embedCard(cardId: string): Promise<void>
//    - Fetch card's field values (front + back text)
//    - Concatenate into single text
//    - Generate embedding
//    - UPDATE card_field_values SET embedding = vector WHERE card_id = X
//    - NOTE: embed the FIRST text field (typically "front") for search relevance
//
// 4. backfillEmbeddings(batchSize: number): Promise<number>
//    - Find cards without embedding (embedding IS NULL)
//    - Process in chunks of batchSize
//    - Async, non-blocking, yield between batches
//    - Return count of newly embedded cards
//
// 5. searchByEmbedding(queryVector: number[], limit: number, userId: string): Promise<SearchResult[]>
//    - SQL: SELECT ... ORDER BY embedding <=> $queryVector LIMIT $limit
//    - pgvector <=> operator = cosine distance (used by HNSW index)
//    - Filter by userId (ownership)
//    - Return: card data + similarity score
```

**Gemini Embedding API call pattern:**

```typescript
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(ENV.GEMINI_API_KEY);

export async function generateEmbedding(text: string): Promise<number[]> {
  const model = genAI.getGenerativeModel({ model: 'text-embedding-004' });
  const result = await model.embedContent(text);
  return result.embedding.values; // number[768]
}

export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const model = genAI.getGenerativeModel({ model: 'text-embedding-004' });
  const result = await model.batchEmbedContents({
    requests: texts.map((text) => ({
      content: { parts: [{ text }], role: 'user' },
    })),
  });
  return result.embeddings.map((e) => e.values);
}
```

#### 1.4.3 Background Queue

```typescript
// embedding.queue.ts — Simple PostgreSQL-backed job queue

// processEmbeddingQueue():
// 1. SELECT card_id FROM embedding_jobs WHERE status = 'pending' LIMIT 50
// 2. UPDATE status = 'processing'
// 3. Batch generate embeddings
// 4. UPDATE card_field_values SET embedding = vector
// 5. UPDATE embedding_jobs SET status = 'done'
// 6. On error: SET status = 'failed', error = message
//
// Called by:
// - Startup: backfill all existing cards (runs once)
// - Card create/update hook: enqueue single card
// - Periodic: every 30s check for pending jobs

// PERFORMANCE:
// - Batch size = 50 (Gemini batch limit)
// - 100ms yield between batches
// - Non-blocking: uses setImmediate/setTimeout
// - Graceful: logs errors, doesn't crash server
```

#### 1.4.4 Integration Points

```typescript
// cards.service.ts — Hook after card create/update
// After successful INSERT/UPDATE:
//   enqueueEmbedding(cardId) — fire-and-forget, does NOT await
//   Card creation latency: 0ms additional

// index.ts — Startup
// After server.listen():
//   startEmbeddingBackfill() — process existing cards in background
//   startEmbeddingWorker()  — periodic queue processor
```

#### 1.4.5 Env Config

```typescript
// env.ts — thêm
GEMINI_EMBEDDING_MODEL: process.env.GEMINI_EMBEDDING_MODEL || 'text-embedding-004',
```

**⚡ Performance guarantees:**

- **Card creation: +0ms** — embedding is async background job
- **Batch embedding: 50 cards/API call** — minimize roundtrips
- **HNSW index: ~5-20ms** search on 100K vectors — sub-frame latency
- **Backfill: non-blocking** — chunked + yield, server stays responsive
- **Storage: ~3KB/card** — 100K cards ≈ 300MB vectors + 300MB HNSW index

**Steps:**

- [ ] Thêm `GEMINI_EMBEDDING_MODEL` vào `env.ts`
- [ ] Tạo migration `0022_add_embedding_infrastructure.sql`
- [ ] Implement `embedding.service.ts` — generateEmbedding, generateEmbeddings, embedCard, searchByEmbedding
- [ ] Implement `embedding.queue.ts` — job queue processor
- [ ] Implement `embedding.routes.ts` — admin endpoints: POST /embedding/backfill, GET /embedding/status
- [ ] Hook vào `cards.service.ts` — enqueue embedding after card create/update
- [ ] Hook vào `index.ts` — startup backfill + periodic worker
- [ ] Test: tạo card → verify embedding được tạo trong background
- [ ] Test: backfill 100 existing cards → verify embeddings populated
- [ ] Commit: `feat(embedding): pgvector infrastructure + async pipeline`

---

### Phase 1 Deliverables

| Feature                  | Deliverable                 | Performance Impact         |
| ------------------------ | --------------------------- | -------------------------- |
| Dice border-radius       | Visual improvement          | 0ms (geometry swap only)   |
| Email Verification       | Full verification flow      | 0ms (async email send)     |
| review_logs retention    | Automatic cleanup           | Reduce DB size long-term   |
| Embedding Infrastructure | pgvector + pipeline + queue | 0ms on card create (async) |

---

## Phase 2: First Consumers + High Value (~1.5 tuần)

**Mục tiêu:** Ship 2 tính năng high-impact: Semantic Search (first embedding consumer) + Forgetting Forecast (USP). Plus Custom Templates UI.

### 2.1 Semantic Search

**Effort:** ~2-3 ngày

**Files:**

- Create: `apps/api/src/modules/search/search.service.ts`
- Create: `apps/api/src/modules/search/search.routes.ts`
- Modify: `apps/api/src/index.ts` — mount search routes
- Create: `apps/web/src/components/search/global-search.tsx` — search modal/panel
- Modify: `apps/web/src/components/layout/sidebar.tsx` — search trigger

**Backend:**

```typescript
// search.service.ts

// semanticSearch(userId, query, options):
// 1. Generate embedding cho search query (1 API call, ~50ms)
// 2. SQL: pgvector cosine similarity search
//    SELECT c.id, c.deck_id, cfv.value,
//           1 - (cfv.embedding <=> $queryVector) AS similarity
//    FROM card_field_values cfv
//    JOIN cards c ON cfv.card_id = c.id
//    JOIN decks d ON c.deck_id = d.id
//    WHERE d.user_id = $userId
//      AND cfv.embedding IS NOT NULL
//    ORDER BY cfv.embedding <=> $queryVector
//    LIMIT $limit
// 3. Enrich results with deck name, template field info
// 4. Return: { results: [{ cardId, deckId, deckName, fields, similarity }] }

// hybridSearch(userId, query, options):
// 1. Run semantic search (embedding-based)
// 2. Run text search (ILIKE/tsvector on card_field_values.value)
// 3. Merge + dedupe results, prefer semantic ranking
// 4. Return combined results
// → Hybrid = fallback khi card chưa có embedding

// Options:
// - limit: number (default 20, max 50)
// - deckId?: string (filter by specific deck)
// - threshold?: number (minimum similarity, default 0.5)
```

**API:**

```typescript
// search.routes.ts
// GET /search?q=query&limit=20&deckId=xxx
// - requireAuth
// - Rate limit: 60 requests/minute
// - Returns: { results: SearchResult[], query, total }
```

**Frontend:**

```typescript
// global-search.tsx
// - Cmd+K / Ctrl+K keyboard shortcut to open
// - Debounced input (300ms) — reuse createDebouncedSignal pattern
// - TanStack Query with staleTime: 30s
// - Results: card preview cards with deck name + similarity badge
// - Click result → navigate to deck-view with card highlighted
// - Empty state: "Start typing to search across all your cards"
```

**⚡ Performance notes:**

- **Query embedding: ~50ms** (1 API call, cached nếu cùng query)
- **pgvector search: ~5-20ms** trên 100K vectors (HNSW)
- **Total latency: ~70-100ms** — cảm nhận instant
- **Debounce 300ms** — tránh spam API calls khi typing
- **TanStack Query cache** — cùng query không gọi lại

**Steps:**

- [ ] Implement `search.service.ts` — semanticSearch, hybridSearch
- [ ] Implement `search.routes.ts` — GET /search with auth + rate limit
- [ ] Mount routes vào `index.ts`
- [ ] Frontend: tạo `global-search.tsx` component
- [ ] Frontend: thêm Cmd+K trigger vào sidebar/layout
- [ ] Frontend: debounced input + TanStack Query integration
- [ ] Test: tìm "quang hợp" → trả về card "photosynthesis" (semantic match)
- [ ] Test: card chưa có embedding → fallback text search
- [ ] Commit: `feat(search): semantic search with pgvector + hybrid fallback`

---

### 2.2 Forgetting Forecast & Retention Heatmap

**Effort:** ~3-5 ngày

**Files:**

- Create: `apps/api/src/modules/study/forecast.service.ts`
- Modify: `apps/api/src/modules/study/study.routes.ts` — thêm forecast endpoints
- Create: `apps/web/src/components/dashboard/forecast-widget.tsx`
- Create: `apps/web/src/components/dashboard/at-risk-badge.tsx`
- Create: `apps/web/src/components/deck-view/retention-heatmap.tsx`
- Modify: `apps/web/src/pages/dashboard.tsx` — integrate widgets

**Backend — Forecast Service:**

```typescript
// forecast.service.ts

// CORE FORMULA (FSRS):
// R(t) = e^(-t/S)
// R = retention probability (0-1)
// t = days since last review
// S = stability (from study_progress)

// SM-2 APPROXIMATION:
// S_approx = intervalDays * (easeFactor / 2.5)
// R(t) = e^(-t/S_approx)

// ─── Endpoints ───

// getForecast(userId, days: 7|14|30):
// 1. Fetch ALL study_progress rows for user (with stability/intervalDays/easeFactor/nextReviewAt)
// 2. For each card, compute R(t) for each day in [today, today+days]
// 3. Aggregate: per-day count of cards where R(t) < 0.8 (at-risk threshold)
// 4. Return: { forecast: [{ date, atRiskCount, avgRetention }] }
//
// PERF: Single query → in-memory computation. No per-card queries.
//       1000 cards × 30 days = 30K R(t) calculations = <5ms in JS

// getRetentionHeatmap(userId, deckId):
// 1. Fetch study_progress for cards in deck
// 2. For each card: compute current R(t)
// 3. Return: { cards: [{ cardId, retention, lastReviewed, stability, nextReview }] }
// 4. Frontend renders as color-coded grid

// getAtRiskCards(userId, threshold: 0.8):
// 1. Fetch study_progress where nextReviewAt > now (not yet due)
// 2. Compute R(t) for each
// 3. Filter: R(t) < threshold
// 4. Sort by R(t) ascending (most at-risk first)
// 5. Return top 20 at-risk cards with deck info
```

**API routes (thêm vào study.routes.ts):**

```typescript
// GET /study/forecast?days=7|14|30
// GET /study/retention-heatmap?deckId=xxx
// GET /study/at-risk-cards?threshold=0.8&limit=20
```

**Frontend — Forecast Widget:**

```typescript
// forecast-widget.tsx
// - Line chart (lightweight: dùng <canvas> hoặc thư viện nhẹ như uPlot/Chart.js)
// - X axis: ngày (today → +N days)
// - Y axis: số cards at-risk
// - Hover tooltip: "March 25: ~12 cards may drop below 80% retention"
// - TanStack Query: staleTime 5 phút (forecast thay đổi chậm)
```

```typescript
// at-risk-badge.tsx
// - Nhỏ gọn, hiện trên dashboard bên cạnh due decks
// - "⚠️ 8 cards at risk" — click → filter view
// - Chỉ hiện khi có cards at-risk > 0
```

```typescript
// retention-heatmap.tsx (trong deck-view)
// - Grid: mỗi ô = 1 card
// - Color: xanh (>90%) → vàng (70-90%) → đỏ (<70%)
// - Hover: card preview + exact retention %
// - Toggle: show/hide trong deck view toolbar
```

**⚡ Performance notes:**

- **Forecast computation: pure math** — `Math.exp(-t / S)` for each card × day
- **1000 cards × 30 days = 30K operations ≈ <5ms** — negligible
- **Single DB query** to fetch all progress rows → in-memory compute
- **Frontend caching: staleTime 5 min** — forecast doesn't change rapidly
- **Chart rendering: canvas-based** — không dùng heavy SVG chart library
- **Heatmap: CSS grid** — no chart library needed, pure div + background-color

**Steps:**

- [ ] Implement `forecast.service.ts` — getForecast, getRetentionHeatmap, getAtRiskCards
- [ ] Thêm 3 endpoints vào `study.routes.ts`
- [ ] Frontend: `forecast-widget.tsx` — line chart trên dashboard
- [ ] Frontend: `at-risk-badge.tsx` — badge trên dashboard
- [ ] Frontend: `retention-heatmap.tsx` — color grid trong deck-view
- [ ] Integrate vào dashboard page (thêm widget section)
- [ ] Test: user có 50 cards với various stability → verify forecast numbers hợp lý
- [ ] Test: retention heatmap hiển thị đúng màu theo retention %
- [ ] Commit: `feat(study): forgetting forecast + retention heatmap`

---

### 2.3 Custom Card Templates UI

**Effort:** ~2-3 ngày

**Files:**

- Create: `apps/web/src/components/templates/template-builder.tsx` — form tạo template
- Create: `apps/web/src/components/templates/field-row.tsx` — draggable field row
- Modify: `apps/web/src/pages/settings.tsx` hoặc tạo `/templates` page
- Modify: `apps/api/src/modules/card-templates/card-templates.routes.ts` — thêm DELETE/UPDATE nếu chưa có

**Backend:** API `POST /card-templates` đã có sẵn (xem `card-templates.service.ts:52-92`). Cần thêm:

- `PUT /card-templates/:id` — update template name/description + fields
- `DELETE /card-templates/:id` — delete user template (chỉ cho user templates, không cho system)
- Validation: không cho xóa template đang được dùng bởi decks

**Frontend — Template Builder:**

```typescript
// template-builder.tsx
// 1. Name input + description textarea
// 2. Fields list (drag-to-reorder):
//    - Each field: name, fieldType (text/richtext/image/audio), side (front/back), isRequired toggle
//    - Add field button
//    - Remove field button (trash icon)
//    - Drag handle for reorder (dùng @dnd-kit/sortable hoặc tương tự)
// 3. Preview panel: mock card hiển thị layout template
// 4. Save button → POST /card-templates
// 5. Validation: ít nhất 1 field mỗi side (front + back)
```

**⚡ Performance notes:**

- **Template list: cached** — system templates đã cache in-memory (xem `getSystemTemplates()`)
- **Drag-and-drop: lightweight** — dùng native HTML drag hoặc minimal library
- **Preview: CSS only** — không render actual card, chỉ mock layout

**Steps:**

- [ ] Backend: thêm `PUT /card-templates/:id` + `DELETE /card-templates/:id` endpoints
- [ ] Backend: validation — prevent delete template in use
- [ ] Frontend: `template-builder.tsx` — form với drag-drop fields
- [ ] Frontend: `field-row.tsx` — individual field editor
- [ ] Frontend: template preview panel
- [ ] Frontend: integrate vào Settings hoặc tạo `/templates` page
- [ ] Test: tạo template "Vocabulary" với 5 fields → verify API response
- [ ] Test: tạo deck với custom template → tạo card → verify fields render đúng
- [ ] Commit: `feat(templates): custom card template builder UI`

---

### Phase 2 Deliverables

| Feature             | Deliverable                | Performance Impact        |
| ------------------- | -------------------------- | ------------------------- |
| Semantic Search     | Cmd+K global search        | ~70-100ms search latency  |
| Forgetting Forecast | Dashboard widget + heatmap | <5ms compute, pure math   |
| Custom Templates UI | Template builder form      | 0ms (UI only, API exists) |

---

## Phase 3: AI Intelligence Layer (~1.5 tuần)

**Mục tiêu:** AI Duplicate Detection + Knowledge Graph Core (manual linking + visualization).

### 3.1 AI Duplicate Detection

**Effort:** ~2-3 ngày

**Files:**

- Create: `apps/api/src/modules/ai/duplicate-detection.service.ts`
- Modify: `apps/api/src/modules/ai/ai.routes.ts` — thêm duplicate endpoints
- Create: `apps/web/src/components/cards/duplicate-warning.tsx`
- Modify: `apps/web/src/components/cards/card-form.tsx` hoặc tương tự — integrate warning

**Backend:**

```typescript
// duplicate-detection.service.ts

// checkDuplicates(userId, cardId | fieldValues):
// 1. Generate embedding cho card mới (hoặc dùng existing embedding)
// 2. pgvector: tìm top 5 cards có similarity > 0.85
//    SELECT c.id, 1 - (cfv.embedding <=> $queryVector) AS similarity
//    FROM card_field_values cfv
//    JOIN cards c ON cfv.card_id = c.id
//    JOIN decks d ON c.deck_id = d.id
//    WHERE d.user_id = $userId
//      AND cfv.embedding IS NOT NULL
//      AND c.id != $currentCardId  -- exclude self
//    ORDER BY cfv.embedding <=> $queryVector
//    LIMIT 5
// 3. Filter: similarity > threshold (default 0.85)
// 4. Return: { duplicates: [{ cardId, deckName, fields, similarity }] }

// batchCheckDeck(userId, deckId):
// 1. Fetch all cards in deck with embeddings
// 2. For each card, find nearest neighbor WITHIN same deck
// 3. Return pairs with similarity > 0.85
// 4. UI: "These 3 pairs might be duplicates"
```

**API:**

```typescript
// POST /ai/check-duplicates
// Body: { cardId: string } | { fieldValues: { front: string, back: string } }
// → Real-time check khi user tạo/sửa card

// POST /ai/deck-duplicates
// Body: { deckId: string }
// → Batch scan toàn bộ deck cho duplicates
```

**Frontend:**

```typescript
// duplicate-warning.tsx
// - Inline warning khi tạo/sửa card
// - "⚠️ Similar card found in [Deck Name]" + preview
// - Dismiss button hoặc "Go to original" link
// - Chỉ hiện khi similarity > 0.85
// - Debounced check: 500ms sau khi user ngừng typing
```

**⚡ Performance notes:**

- **Real-time check: ~60-80ms** (embedding generation 50ms + pgvector search 10-20ms)
- **Debounce 500ms** trên frontend — tránh check mỗi keystroke
- **Batch deck scan: async** — chạy background, notify khi xong
- **Threshold 0.85** — đủ strict để tránh false positives

**Steps:**

- [ ] Implement `duplicate-detection.service.ts`
- [ ] Thêm endpoints vào `ai.routes.ts`
- [ ] Frontend: `duplicate-warning.tsx` — inline warning component
- [ ] Frontend: integrate vào card create/edit form (debounced)
- [ ] Frontend: deck-level "Check for Duplicates" button trong deck-view toolbar
- [ ] Test: tạo card trùng nội dung → verify warning hiện
- [ ] Test: cards khác nội dung → verify no warning
- [ ] Commit: `feat(ai): embedding-based duplicate detection`

---

### 3.2 Knowledge Graph Core (Manual Linking + Visualization)

**Effort:** ~5-6 ngày

**Files:**

- Create: `apps/api/src/modules/knowledge-graph/kg.service.ts`
- Create: `apps/api/src/modules/knowledge-graph/kg.routes.ts`
- Modify: `apps/api/src/index.ts` — mount KG routes
- Create: `apps/web/src/components/knowledge-graph/graph-view.tsx` — d3-force visualization
- Create: `apps/web/src/components/knowledge-graph/link-dialog.tsx` — link creation UI
- Modify: `apps/web/src/pages/deck-view/deck-view-page.tsx` — thêm "Graph View" tab

**Schema đã có sẵn:**

- `card_links` table — `source_card_id`, `target_card_id`, `link_type` (prerequisite | related)
- `card_concepts` table — `card_id`, `concept` (extracted concepts/tags)

**Backend:**

```typescript
// kg.service.ts

// createLink(userId, sourceCardId, targetCardId, linkType):
// 1. Verify ownership of BOTH cards
// 2. Validate: no self-link (DB constraint chk_no_self_link đã có)
// 3. INSERT into card_links
// 4. Return created link

// deleteLink(userId, linkId):
// 1. Verify ownership
// 2. DELETE from card_links

// getCardLinks(userId, cardId):
// 1. Fetch all links where source OR target = cardId
// 2. Enrich with card field values (preview text)
// 3. Return: { outgoing: Link[], incoming: Link[] }

// getDeckGraph(userId, deckId):
// 1. Fetch all cards in deck (nodes)
// 2. Fetch all links between cards in deck (edges)
// 3. Return: { nodes: Node[], edges: Edge[] }
// Node: { id, label (from first field), retention (if study_progress exists) }
// Edge: { source, target, type }

// searchCardsForLinking(userId, query, excludeCardId):
// 1. Text search across user's cards (ILIKE on card_field_values)
// 2. OR semantic search if embedding available
// 3. Exclude current card
// 4. Return top 10 results for link target picker

// addConcepts(userId, cardId, concepts: string[]):
// 1. Verify ownership
// 2. INSERT into card_concepts (batch)
// 3. Return created concepts

// getCardConcepts(userId, cardId):
// 1. Fetch from card_concepts WHERE card_id = cardId
```

**API:**

```typescript
// kg.routes.ts
// POST   /knowledge-graph/links          — create link
// DELETE /knowledge-graph/links/:id      — delete link
// GET    /knowledge-graph/cards/:id/links — get links for a card
// GET    /knowledge-graph/decks/:id/graph — get full graph for deck
// GET    /knowledge-graph/search?q=xxx&exclude=cardId — search for link targets
// POST   /knowledge-graph/cards/:id/concepts — add concepts
// GET    /knowledge-graph/cards/:id/concepts — get concepts
```

**Frontend — Graph View:**

```typescript
// graph-view.tsx
// - d3-force directed graph (d3-force + canvas rendering cho performance)
// - Nodes = cards (label = first field text, truncated)
// - Edges = links (solid = prerequisite, dashed = related)
// - Node color = retention heatmap color (green → red)
// - Click node → highlight connected nodes + show card preview
// - Double-click node → navigate to card
// - Zoom + pan support
// - Layout: embedded trong deck-view page, toggle "Graph View" tab
```

```typescript
// link-dialog.tsx
// - Opened from card detail/edit view
// - Search input: find target card by text
// - Link type selector: "Prerequisite" | "Related"
// - Preview: show selected target card
// - Save button → POST /knowledge-graph/links
```

**⚡ Performance notes:**

- **Graph data: single query** — JOIN cards + card_links, no N+1
- **d3-force: canvas rendering** (NOT SVG) — handles 500+ nodes smoothly
- **Lazy load graph**: chỉ render khi user click "Graph View" tab
- **Search for linking: debounced** — reuse `createDebouncedSignal`

**Steps:**

- [ ] Implement `kg.service.ts` — CRUD links, getDeckGraph, searchCardsForLinking, concepts
- [ ] Implement `kg.routes.ts` — 7 endpoints
- [ ] Mount routes vào `index.ts`
- [ ] Install d3-force + d3-selection vào `apps/web`
- [ ] Frontend: `graph-view.tsx` — canvas-based d3-force graph
- [ ] Frontend: `link-dialog.tsx` — search + select + create link
- [ ] Frontend: integrate "Graph View" tab vào deck-view page
- [ ] Frontend: card detail → "Link to..." button → open link-dialog
- [ ] Test: tạo 5 cards + 3 links → verify graph hiển thị đúng nodes + edges
- [ ] Test: prerequisite vs related edge styling
- [ ] Test: click node → preview + highlight neighbors
- [ ] Commit: `feat(knowledge-graph): manual linking + d3-force visualization`

---

### Phase 3 Deliverables

| Feature                | Deliverable                 | Performance Impact            |
| ---------------------- | --------------------------- | ----------------------------- |
| AI Duplicate Detection | Real-time + batch checking  | ~60-80ms per check            |
| Knowledge Graph Core   | Manual linking + graph view | Canvas rendering, lazy loaded |

---

## Phase 4: Advanced AI + Polish (~1-1.5 tuần)

**Mục tiêu:** AI-powered relationship detection + study recommendations + smart grouping.

### 4.1 Knowledge Graph AI Auto-Detect

**Effort:** ~3-4 ngày

**Depends on:** Phase 1 (Embedding) + Phase 3 (KG Core)

**Files:**

- Create: `apps/api/src/modules/knowledge-graph/kg-ai.service.ts`
- Modify: `apps/api/src/modules/knowledge-graph/kg.routes.ts` — thêm AI endpoints
- Create: `apps/web/src/components/knowledge-graph/ai-suggestions.tsx`

**Backend:**

```typescript
// kg-ai.service.ts

// detectRelationships(userId, deckId):
// APPROACH: Embedding similarity + Gemini LLM verification
//
// Step 1: Embedding clustering
//   - Fetch all card embeddings in deck
//   - For each card, find top 3 nearest neighbors (cosine similarity > 0.7)
//   - This gives CANDIDATE pairs quickly (pgvector, no LLM cost)
//
// Step 2: LLM verification (optional, higher accuracy)
//   - For top N candidate pairs (limit 20):
//     Send to Gemini: "Card A: [text]. Card B: [text].
//     Are these related? If yes, is A a prerequisite for B, B for A, or just related?"
//   - Gemini returns: { relationship: 'prerequisite' | 'related' | 'none', confidence, reason }
//
// Step 3: Return suggestions (NOT auto-create links)
//   - { suggestions: [{ sourceCardId, targetCardId, linkType, similarity, aiReason }] }
//   - User reviews + approves each suggestion
//
// PERF: Step 1 = pure pgvector (~20ms). Step 2 = batched Gemini calls (1 call per 5 pairs).
//       Total: ~2-5 seconds for 100-card deck. Run as async job.

// autoConceptExtraction(userId, cardId):
// - Send card text to Gemini: "Extract 2-5 key concepts/topics from this flashcard"
// - Save to card_concepts table
// - Run during embedCard() hook — piggyback on existing AI call
```

**API:**

```typescript
// POST /knowledge-graph/ai/detect?deckId=xxx
// → Returns: { jobId } (async job)
// GET  /knowledge-graph/ai/detect/:jobId
// → Returns: { status, suggestions[] }
// POST /knowledge-graph/ai/accept-suggestion
// → Body: { sourceCardId, targetCardId, linkType }
// → Creates the link
```

**Frontend:**

```typescript
// ai-suggestions.tsx
// - "Detect Relationships" button trong deck-view graph tab
// - Progress indicator khi AI processing
// - Suggestion list: card A ↔ card B, relationship type, AI reasoning
// - Accept / Reject buttons per suggestion
// - "Accept All" bulk action
```

**⚡ Performance notes:**

- **Step 1 (pgvector clustering): ~20ms** — instant
- **Step 2 (LLM verification): ~2-5s** — run as async background job
- **User not blocked** — sees "Analyzing..." progress, results load when ready
- **Concept extraction: piggybacked** on embedding creation — 0 extra requests

**Steps:**

- [ ] Implement `kg-ai.service.ts` — detectRelationships, autoConceptExtraction
- [ ] Thêm AI endpoints vào `kg.routes.ts`
- [ ] Hook concept extraction vào embedding pipeline
- [ ] Frontend: `ai-suggestions.tsx` — suggestions panel
- [ ] Frontend: "Detect Relationships" button + progress
- [ ] Frontend: accept/reject individual suggestions
- [ ] Test: deck 20 cards → AI suggests 5 relationships → accept 3 → verify links created
- [ ] Commit: `feat(knowledge-graph): AI relationship detection + concept extraction`

---

### 4.2 Study Recommendations + Smart Grouping

**Effort:** ~3-4 ngày

**Files:**

- Create: `apps/api/src/modules/study/recommendations.service.ts`
- Modify: `apps/api/src/modules/study/study.routes.ts` — thêm recommendation endpoints
- Create: `apps/web/src/components/study/related-cards-panel.tsx`
- Create: `apps/web/src/components/dashboard/smart-groups-widget.tsx`

**Backend:**

```typescript
// recommendations.service.ts

// getRelatedCards(userId, cardId, limit: 5):
// 1. Check card_links first (explicit relationships) — instant, no AI
// 2. If < limit results, supplement with embedding similarity search
//    SELECT ... ORDER BY embedding <=> currentCardEmbedding LIMIT remaining
// 3. Return: { related: [{ cardId, deckName, fields, source: 'link' | 'semantic', similarity }] }
//
// USE CASE: Khi user nhấn "Again" → show "Related cards you might want to review"

// getSmartGroups(userId, topN: 5):
// 1. Fetch user's cards with embeddings
// 2. Simple clustering: group cards by concept (from card_concepts table)
// 3. OR: group by embedding proximity (k-means light, in-memory)
// 4. For each group: name = most common concept, count, avg retention
// 5. Return: { groups: [{ name, cardCount, avgRetention, sampleCards }] }
//
// USE CASE: Dashboard widget — "Your knowledge areas"

// getPrerequisiteChain(userId, cardId):
// 1. Walk card_links WHERE link_type = 'prerequisite' backwards
// 2. BFS/DFS to build chain: A → B → C → current card
// 3. Check if any prerequisite has low retention
// 4. Return: { chain: Card[], weakLinks: Card[] }
//
// USE CASE: "You forgot card C. You might want to review card A first (prerequisite)"
```

**API:**

```typescript
// GET /study/recommendations/:cardId?limit=5
// GET /study/smart-groups?topN=5
// GET /study/prerequisite-chain/:cardId
```

**Frontend:**

```typescript
// related-cards-panel.tsx
// - Shown in study mode after "Again" response
// - "Related cards:" → compact card previews
// - Click → add to current review queue
// - Collapsible panel, doesn't block study flow

// smart-groups-widget.tsx
// - Dashboard widget: "Knowledge Areas"
// - Colored cards/badges per group
// - Each group: name, card count, avg retention bar
// - Click → filter study to that group
```

**⚡ Performance notes:**

- **Related cards: link-first** — card_links lookup is instant (indexed)
- **Embedding fallback: ~10ms** — pgvector already indexed
- **Smart groups: in-memory** — card_concepts GROUP BY, no heavy clustering
- **Prerequisite chain: BFS** — max depth limited to 10 (prevent infinite loops)
- **Frontend: lazy loaded** — panels only fetch data when expanded/visible

**Steps:**

- [ ] Implement `recommendations.service.ts` — getRelatedCards, getSmartGroups, getPrerequisiteChain
- [ ] Thêm 3 endpoints vào `study.routes.ts`
- [ ] Frontend: `related-cards-panel.tsx` — study mode integration
- [ ] Frontend: `smart-groups-widget.tsx` — dashboard widget
- [ ] Frontend: prerequisite warning khi review card có weak prerequisites
- [ ] Test: card với 2 explicit links + 3 semantic matches → verify 5 results
- [ ] Test: 50 cards, 3 concepts → verify 3 smart groups formed
- [ ] Commit: `feat(study): recommendations + smart grouping + prerequisite chains`

---

### Phase 4 Deliverables

| Feature               | Deliverable                     | Performance Impact            |
| --------------------- | ------------------------------- | ----------------------------- |
| KG AI Auto-detect     | Background job + suggestions UI | Async, ~2-5s per deck scan    |
| Study Recommendations | Related cards + smart groups    | <10ms (link-first + pgvector) |

---

## Performance Checklist

Mọi feature phải pass checklist này trước khi ship:

### Database

- [ ] Mọi query mới có EXPLAIN ANALYZE < 10ms trên 100K rows
- [ ] Index phù hợp cho WHERE/ORDER BY/JOIN conditions
- [ ] Không N+1 queries — dùng parallel `Promise.all()` hoặc batch fetch
- [ ] Embedding queries dùng HNSW index, NOT sequential scan

### API

- [ ] Response time P95 < 200ms cho user-facing endpoints
- [ ] Background jobs (embedding, AI detect) KHÔNG block request thread
- [ ] Rate limiting trên AI endpoints (prevent abuse + cost control)
- [ ] Batch operations khi có nhiều items (embeddings, links)

### Frontend

- [ ] Debounce trên tất cả search inputs (300-500ms)
- [ ] TanStack Query với staleTime phù hợp (search: 30s, forecast: 5min, graph: 2min)
- [ ] Lazy load heavy components (d3 graph, chart library)
- [ ] VirtualList cho danh sách dài (search results, smart groups)
- [ ] Canvas rendering cho graph (NOT SVG — performance với 500+ nodes)

### Memory & Storage

- [ ] Embedding pipeline: chunked batches + yield between batches
- [ ] review_logs cleanup: batched DELETE + yield
- [ ] No memory leaks: cleanup listeners, abort controllers, d3 simulations

---

## Risk Register

| Risk                                            | Impact                     | Probability                      | Mitigation                                                              |
| ----------------------------------------------- | -------------------------- | -------------------------------- | ----------------------------------------------------------------------- |
| pgvector extension không available trên hosting | 🔴 High — blocks Phase 2-4 | Thấp (hầu hết managed PG hỗ trợ) | Verify trước khi bắt đầu Phase 1.4. Fallback: Supabase/Neon đều support |
| Gemini embedding API rate limit                 | 🟡 Medium — slow backfill  | Trung bình                       | Batch 50/call, retry with backoff, backfill can run overnight           |
| d3-force performance với 500+ nodes             | 🟡 Medium — laggy graph    | Thấp                             | Canvas rendering (not SVG), limit visible nodes, progressive loading    |
| Embedding storage cost at scale                 | 🟢 Low — $5-10/month       | Thấp                             | 100K cards = 600MB. Monitor, add compression nếu cần                    |
| AI Duplicate false positives                    | 🟡 Medium — annoying UX    | Trung bình                       | Threshold 0.85 + user confirms. Tuneable setting                        |

---

## Timeline Overview

```text
Week 1:        Phase 1 — Foundation + Quick Wins
               ├── Day 1: Dice border-radius + Email Verification start
               ├── Day 2: Email Verification complete + review_logs retention
               ├── Day 3-5: Embedding Infrastructure (pgvector + pipeline + queue)

Week 2-3:      Phase 2 — First Consumers + High Value
               ├── Day 6-8: Semantic Search (backend + frontend)
               ├── Day 9-11: Forgetting Forecast & Retention Heatmap
               ├── Day 12-13: Custom Card Templates UI

Week 3-4:      Phase 3 — AI Intelligence Layer
               ├── Day 14-16: AI Duplicate Detection
               ├── Day 17-22: Knowledge Graph Core (manual + visualization)

Week 5:        Phase 4 — Advanced AI + Polish
               ├── Day 23-25: Knowledge Graph AI auto-detect
               ├── Day 26-28: Study Recommendations + Smart Grouping
```

---

> **Ghi chú:** Plan này tập trung vào feature Q1-Q7, KHÔNG bao gồm AI Tutor hay Shared Deck Marketplace. Mỗi phase có thể ship independently — không cần đợi phase sau để release.
