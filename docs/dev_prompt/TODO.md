# 📋 Engram Spira — Implementation TODO

> Auto-generated from `feature_roadmap_plan.md` analysis.  
> Mỗi task được checkbox khi hoàn thành. Cập nhật tiến độ liên tục.

---

## Giai đoạn 1: Gia cố MVP (2-4 tuần)

### Sprint 1.1 — Bảo mật & Nợ kỹ thuật

- [x] **1.1.1** Rate limiting trên `/auth` prefix (5 req/min/IP) via `elysia-rate-limit`
- [x] **1.1.2** Email validation — thay `.includes('@')` bằng `t.String({ format: 'email' })` trong Elysia schema
- [x] **1.1.3** Thêm "Easy" action vào SM-2 engine (`EASY: 'easy'`, `EF_DELTA = +0.15`, `interval * ef * 1.3`)
- [x] **1.1.4** Dọn dead code — xóa `SRS_INTERVALS` trong constants.ts, xóa `export type {}` trong types/index.ts, xóa `ForbiddenError` dead import
- [x] **1.1.5** Error boundary SolidJS — wrap `<Router>` trong `<ErrorBoundary>` (component `AppErrorBoundary`)
- [x] **1.1.6** Populate `@engram/shared` — export shared types: `ReviewAction`, `FieldType`, `FieldSide`, `PASSWORD`, `SYSTEM_TEMPLATES`, `NOTIFICATIONS`, `LINK_TYPES`

### Sprint 1.2 — Missing Endpoints

- [x] **1.2.1** Batch card creation — `POST /cards/by-deck/:deckId/batch`
- [x] **1.2.2** Card reorder — `PATCH /cards/by-deck/:deckId/reorder`
- [x] **1.2.3** Move deck between folders — `PATCH /decks/:id/move`
- [x] **1.2.4** Change password — `POST /auth/change-password` + frontend modal trong Settings
- [x] **1.2.5** Password reset flow — `POST /auth/forgot-password` + `POST /auth/reset-password` + bảng `password_reset_tokens`

### Sprint 1.3 — Frontend & Import/Export

- [x] **1.3.1** Mobile responsive navigation (sidebar → bottom nav via `mobile-nav.tsx`)
- [x] **1.3.2** TanStack Query — `QueryClientProvider` đã wired, sẽ migrate dần khi thêm feature mới (Phase 2+)
- [x] **1.3.3** CSV Import — `POST /import/csv/:deckId`
- [x] **1.3.4** CSV/JSON Export — `GET /export/:deckId?format=csv|json`

---

## Giai đoạn 2: Khác biệt hóa (6-8 tuần)

### Sprint 2.1 — Review Logging Foundation (NỀN TẢNG)

- [x] **2.1.1** Schema: tạo bảng `review_logs` (id, user_id, card_id, rating, state, elapsed_days, scheduled_days, review_timestamp, review_duration_ms)
- [x] **2.1.2** Indexes: `(user_id, card_id)`, `(user_id, reviewed_at)`
- [x] **2.1.3** Export schema + generate migration
- [x] **2.1.4** Integrate logging vào `study.service.ts` — `reviewCard()` + `reviewCardBatch()` ghi vào `review_logs`

### Sprint 2.2 — AI Card Factory

- [x] **2.2.1** Install Gemini SDK: `bun add @google/generative-ai`
- [x] **2.2.2** Tạo `config/ai.ts` — initialize Gemini client + per-user rate limiter
- [x] **2.2.3** Schema: tạo bảng `ai_generation_jobs` + TTL cleanup
- [x] **2.2.4** Tạo `modules/ai/ai.service.ts` — generateCardsFromText, saveGeneratedCards, improveCard
- [x] **2.2.5** Tạo `modules/ai/ai.routes.ts` — preview, generate, jobs, save, improve
- [x] **2.2.6** Register `ai.routes.ts` trong `src/index.ts`
- [x] **2.2.7** Frontend: "Generate with AI" button + modal trong deck-view

### Sprint 2.3 — Interleaved Practice Mode

- [x] **2.3.1** `study.service.ts`: `getInterleavedDueCards()` — urgency-weighted round-robin
- [x] **2.3.2** `study.service.ts`: `getAutoInterleavedCards()` — auto-select top 5 decks by due count
- [x] **2.3.3** Routes: `POST /study/interleaved`, `GET /study/interleaved/auto`
- [x] **2.3.4** Frontend: Dashboard "Interleaved Study" button + interleaved study page

### Sprint 2.4 — AI Duplicate & Quality Detection

- [x] **2.4.1** pgvector setup: enable extension + migration cho `card_field_values.embedding vector(768)` (graceful degradation nếu pgvector không có)
- [x] **2.4.2** `ai.service.ts`: `generateEmbedding()`, `checkDuplicates()`, `qualityScore()`
- [x] **2.4.3** Hook embedding generation vào card creation flow (fire-and-forget)
- [x] **2.4.4** Routes: `POST /ai/check-duplicates`, `POST /ai/quality-score`

### Sprint 2.5 — Browser Extension MVP

- [x] **2.5.1** Tạo `packages/browser-extension/` (Chrome Manifest V3)
- [x] **2.5.2** Popup: login + chọn target deck
- [x] **2.5.3** Content script: bôi đen → context menu → create flashcard

---

## Giai đoạn 3: Xây dựng Rào cản Moat (10-14 tuần)

### Sprint 3.1 — Knowledge Graph Backend

- [x] **3.1.1** Schema: `card_links` (với UNIQUE constraint + self-link check + indexes)
- [x] **3.1.2** Schema: `card_concepts` (với indexes)
- [ ] **3.1.3** Service: `card-links.service.ts` — createLink (cycle detect), getCardLinks, deleteLink, getDeckGraph
- [ ] **3.1.4** Service: `getPrerequisiteStatus()` — adaptive mastery check (SM-2 boxLevel/easeFactor)
- [ ] **3.1.5** Sửa `getDueCards()` — filter blocked cards theo prerequisite chains
- [ ] **3.1.6** Routes: `POST /cards/:id/links`, `GET /cards/:id/links`, `DELETE /cards/links/:linkId`, `GET /decks/:id/graph`
- [ ] **3.1.7** AI: `POST /ai/detect-relationships` — scan deck, đề xuất links

### Sprint 3.2 — Knowledge Graph Frontend

- [ ] **3.2.1** Install d3-force
- [ ] **3.2.2** `components/flashcard/knowledge-graph.tsx` — force-directed graph
- [ ] **3.2.3** Graph tab trong deck-view
- [ ] **3.2.4** Card editor: "Link Cards" UI
- [ ] **3.2.5** Study mode: prerequisite warning + quick link

### Sprint 3.3 — Forgetting Forecast & Retention Heatmap

- [ ] **3.3.1** Service: `getForecast()`, `getRetentionHeatmap()`, `getAtRiskCards()` (dùng SM-2 intervalDays/easeFactor)
- [ ] **3.3.2** Routes: `GET /study/forecast`, `GET /study/retention-heatmap`, `GET /study/at-risk-cards`
- [ ] **3.3.3** Frontend: Dashboard forecast widget (line chart + heatmap + alerts)

### Sprint 3.4 — AI Tutor

- [ ] **3.4.1** Service: `explainCard()` — mnemonic, explain, related cards, micro-quiz
- [ ] **3.4.2** Route: `POST /ai/explain`
- [ ] **3.4.3** Frontend: AI tutor slide-out panel khi ấn "Again"

### Sprint 3.5 — Shared Deck Marketplace

- [ ] **3.5.1** Schema: `published_decks` (⚠️ snapshot cards, KHÔNG FK reference), `deck_ratings`, `deck_subscriptions`
- [ ] **3.5.2** Service: publish (snapshot), search, clone, rate
- [ ] **3.5.3** Routes: `POST /marketplace/publish`, `GET /marketplace/search`, `POST /marketplace/:id/clone`, `POST /marketplace/:id/rate`
- [ ] **3.5.4** Frontend: Marketplace page + browse/search/clone UI

### Sprint 3.6 — Image Occlusion

- [ ] **3.6.1** Thêm field_type `image_occlusion` trong template system
- [ ] **3.6.2** Canvas drawing UI cho vùng che
- [ ] **3.6.3** Study mode: render occlusion cards
- [ ] **3.6.4** SRS integration: mỗi vùng che = 1 thẻ con riêng

---

## Giai đoạn 4: Moonshot (16-24 tuần)

- [ ] **4.1** Memory Fingerprint — mô hình nhận thức cá nhân hóa
- [ ] **4.2** Desirable Difficulty Mode — biến thể thẻ thích ứng
- [ ] **4.3** Flow Study — thời lượng phiên học thích ứng
- [ ] **4.4** Optimal Review Time — lên lịch dựa trên nhịp sinh học
- [ ] **4.5** Context Replay — ghi nhớ môi trường học

---

## 📊 Tiến độ Tổng quan

| Giai đoạn   | Tổng tasks | Hoàn thành | %       |
| ----------- | ---------- | ---------- | ------- |
| Giai đoạn 1 | 14         | 14         | 100%    |
| Giai đoạn 2 | 18         | 18         | 100%    |
| Giai đoạn 3 | 20         | 2          | 10%     |
| Giai đoạn 4 | 5          | 0          | 0%      |
| **Tổng**    | **57**     | **34**     | **60%** |

---

## 📝 Ghi chú kỹ thuật

### FSRS đã bị loại bỏ

Sprint FSRS Algorithm Engine đã được triển khai rồi loại bỏ do các vấn đề với scheduling interval cho learning cards. Toàn bộ FSRS code, schema columns, dependencies (`ts-fsrs`), và bảng `fsrs_user_params` đã được cleanup qua migration `0013_flowery_blue_marvel.sql`. Ứng dụng hiện chỉ sử dụng thuật toán **SM-2** với các bug fix:

- Again: reset boxLevel=0 + nextReviewAt sau 10 phút
- Hard: boxLevel = Math.max(1, reps)
- Easy: EF bonus +0.15, interval × 1.3

### Các vấn đề còn tồn tại (Nợ kỹ thuật)

- **CSRF**: Chưa có bảo vệ CSRF ngoài `sameSite=lax` (chấp nhận được cho SPA cookie-based nhưng không hoàn hảo)
- **Frontend pagination**: deck-view tải tất cả cards, chưa có phân trang/infinite scroll (chỉ ảnh hưởng khi deck lớn 500+ cards)
- **Rate limiting**: Áp dụng chung cho toàn `/auth` prefix (5 req/min) thay vì per-endpoint riêng biệt
