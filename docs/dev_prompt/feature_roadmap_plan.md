# Kế hoạch: Engram Spira — Phân tích Chuyên sâu & Lộ trình Tính năng Đột phá

---

## 📊 Phân tích Trạng thái Hiện tại

### Stack Công nghệ

| Lớp                | Công nghệ                                      | Trạng thái                                                                         |
| ------------------ | ---------------------------------------------- | ---------------------------------------------------------------------------------- |
| Runtime            | Bun 1.3+                                       | ✅ Hiện đại nhất (Bleeding-edge)                                                   |
| Backend            | ElysiaJS v1.4.26 (AOT)                         | ✅ Sẵn sàng cho Production                                                         |
| Cơ sở dữ liệu      | PostgreSQL 15 (Docker)                         | ✅ Vững chắc                                                                       |
| ORM                | Drizzle ORM v0.45                              | ✅ Dựa trên Schema, migrations                                                     |
| Xác thực (Auth)    | Custom Lucia-style (argon2 + SHA-256 sessions) | ✅ Bảo mật                                                                         |
| Frontend           | SolidJS v1.9.11 + Vite 7                       | ✅ Reactive (Phản ứng)                                                             |
| Styling            | TailwindCSS v4 + CVA                           | ✅ Đã có Design system                                                             |
| API Client         | Eden Treaty (E2E type-safe)                    | ✅ Zero-codegen                                                                    |
| Quản lý trạng thái | SolidJS signals + TanStack Query               | ✅ Toàn bộ 9+ pages đã migrate sang createQuery/createMutation/createInfiniteQuery |
| Monorepo           | Bun Workspaces                                 | ✅ `apps/*` + `packages/*`                                                         |
| Shared pkg         | `@engram/shared`                               | ✅ Populated (REVIEW_ACTIONS, FIELD_TYPES, SYSTEM_TEMPLATES, LINK_TYPES, etc.)     |

**Kiến trúc**: Monorepo, backend dựa trên module (`module/{name}.routes.ts` + `{name}.service.ts`), hệ thống thẻ EAV cho các template linh hoạt. **50+ API endpoints**, 16 bảng DB, thuật toán SM-2.

---

### Danh mục Tính năng

| Tính năng                                 | Backend                              | Frontend                                       | Mức độ hoàn thiện                                                     |
| ----------------------------------------- | ------------------------------------ | ---------------------------------------------- | --------------------------------------------------------------------- |
| **Auth (đăng ký/đăng nhập/đăng xuất/me)** | ✅                                   | ✅                                             | 98% — có change password + reset password, chưa xác minh email        |
| **Class CRUD**                            | ✅                                   | ✅ sidebar (tạo/đổi tên/xóa)                   | 95%                                                                   |
| **Folder CRUD**                           | ✅                                   | ✅ sidebar (tạo/đổi tên/xóa)                   | 95%                                                                   |
| **Deck CRUD**                             | ✅                                   | ✅ folder-view (tạo), sidebar (không tạo được) | 95% — có endpoint move deck giữa các thư mục                          |
| **Card Templates (Mẫu thẻ)**              | ✅ Chỉ GET/POST                      | ✅ Bộ chọn khi tạo deck                        | 60% — chưa thể cập nhật/xóa, không có UI tạo template tùy chỉnh       |
| **Card CRUD**                             | ✅                                   | ✅ deck-view (tạo/sửa/xóa)                     | 95% — có batch create + reorder endpoints                             |
| **SM-2 + FSRS Study**                     | ✅ dual-algorithm engine + routes    | ✅ trang study-mode + algorithm toggle         | 100% — SM-2 + FSRS v5 (ts-fsrs), toggle trong Settings                |
| **Dashboard**                             | ✅ streak/hoạt động/thống kê/đến hạn | ✅ dashboard phong phú                         | 95%                                                                   |
| **Focus Timer (Pomodoro)**                | N/A (chỉ frontend)                   | ✅ drawer + phần thưởng xúc xắc 3D             | 90%                                                                   |
| **Thông báo (deck đến hạn)**              | ✅                                   | ✅ chuông + dropdown                           | 90%                                                                   |
| **Phản hồi (email)**                      | ✅                                   | ✅ form đầy đủ                                 | 95%                                                                   |
| **Giao diện (sáng/tối/hệ thống)**         | N/A                                  | ✅                                             | 100%                                                                  |
| **Cài đặt**                               | ✅ avatar upload + change password   | ✅ profile + change password modal             | 90% — đã có đổi mật khẩu                                              |
| **AI Card Factory**                       | ✅ Gemini 3 Flash                    | ✅ Generate modal trong deck-view              | 95%                                                                   |
| **Interleaved Practice**                  | ✅ interleaved + auto-interleaved    | ✅ Dashboard button + study page               | 95%                                                                   |
| **AI Duplicate Detection**                | ❌ Đã loại bỏ (embedding bị xóa)     | ❌ Chưa có                                     | 0% — pgvector embedding đã bị xóa (migration 0015), không có endpoint |
| **Browser Extension**                     | N/A                                  | ✅ Chrome Manifest V3 + context menu           | 80% — MVP hoạt động                                                   |
| **Review Logging**                        | ✅ review_logs table + auto-logging  | N/A (transparent)                              | 100%                                                                  |
| **Import/Export CSV**                     | ✅ import + export endpoints         | ✅ UI trong deck-view                          | 95%                                                                   |

**Đã lên kế hoạch nhưng chưa bắt đầu** (từ TODO.md):

- Tìm kiếm & lọc (cấp độ sidebar)
- Biểu đồ thống kê nâng cao
- Tạo UI cho template tùy chỉnh
- Knowledge Graph frontend (d3-force)
- Shared Deck Marketplace

---

### Phân tích Lỗ hổng — Nợ Kỹ thuật & Bảo mật

| Hạng mục      | Vấn đề                                                                                                                                     | Mức độ nghiêm trọng       | Trạng thái                                                                                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Bảo mật**   | Không có rate limiting (giới hạn tỷ lệ) trên `/auth/login` và `/auth/register`                                                             | 🔴 Cao                    | ✅ ĐÃ SỬA — `elysia-rate-limit` 5 req/min/IP trên `/auth` prefix                                                                                                      |
| **Bảo mật**   | Không có bảo vệ CSRF ngoài `sameSite=lax`                                                                                                  | 🟠 Trung bình             | ⚠️ CHẤP NHẬN — SPA cookie-based với sameSite=lax đủ an toàn cho hiện tại                                                                                              |
| **Bảo mật**   | Xác thực email chỉ là `.includes('@')` — không kiểm tra định dạng                                                                          | 🟡 Thấp                   | ✅ ĐÃ SỬA — dùng `t.String({ format: 'email' })` Elysia schema validation                                                                                             |
| **Code**      | `ForbiddenError` được import nhưng không dùng trong classes.service.ts                                                                     | 🟢 Không đáng kể          | ✅ ĐÃ SỬA — xóa import                                                                                                                                                |
| **Code**      | Hằng số `SRS_INTERVALS` cũ là dead code trong constants.ts                                                                                 | 🟢 Không đáng kể          | ✅ ĐÃ SỬA — xóa dead code                                                                                                                                             |
| **Code**      | `types/index.ts` không export gì cả                                                                                                        | 🟢 Không đáng kể          | ✅ ĐÃ SỬA — dọn dẹp file                                                                                                                                              |
| **Code**      | Gói `@engram/shared` trống — các type bị lặp lại/inlined                                                                                   | 🟡 Thấp                   | ✅ ĐÃ SỬA — exported REVIEW_ACTIONS, FIELD_TYPES, SYSTEM_TEMPLATES, etc.                                                                                              |
| **Kiến trúc** | Đã cấu hình TanStack Query nhưng không dùng `createQuery`/`createMutation` ở đâu cả — toàn bộ việc fetch data dùng `createResource` thô    | 🟠 Trung bình             | ✅ ĐÃ MIGRATE — Toàn bộ 9+ pages đã chuyển sang createQuery/createMutation/createInfiniteQuery. 0 createResource còn lại. Sidebar cũng dùng TanStack Query.           |
| **Kiến trúc** | Không có error boundary (`<ErrorBoundary>`) ở frontend                                                                                     | 🟠 Trung bình             | ✅ ĐÃ SỬA — `<ErrorBoundary>` wrap `<Router>`                                                                                                                         |
| **Dữ liệu**   | FK của `card_templates` dùng NO CASCADE — xóa một template có chứa các deck liên kết sẽ thất bại một cách âm thầm                          | 🟡 Trung bình             | ✅ ĐÃ SỬA — cascade behavior corrected                                                                                                                                |
| **UX**        | Điều hướng không responsive trên mobile (chỉ thu gọn được sidebar)                                                                         | 🟠 Trung bình             | ✅ ĐÃ SỬA — mobile-nav.tsx bottom nav component                                                                                                                       |
| **Hiệu suất** | Frontend không phân trang thẻ — tải tất cả, render tất cả                                                                                  | 🟡 Trung bình (scale kém) | ✅ ĐÃ SỬA — cursor pagination backend + VirtualList đã tích hợp trong deck-view-page.tsx + createInfiniteQuery cho infinite scroll. DOM chỉ render viewport.          |
| **Hiệu suất** | Search card không debounce — `onInput` fire mỗi keystroke, recompute `filteredCards` memo mỗi ký tự                                        | 🟠 Trung bình             | ✅ ĐÃ SỬA — `createDebouncedSignal` (250ms) tích hợp trong deck-view. Input dùng immediateValue, filter dùng debouncedValue.                                          |
| **Hiệu suất** | VirtualList đã implement (`lib/virtual-list.tsx`) nhưng KHÔNG được import/sử dụng ở bất kỳ đâu — card list render tất cả vào DOM           | 🟠 Trung bình             | ✅ ĐÃ SỬA — VirtualList đã tích hợp vào deck-view-page.tsx với CSS `contain: strict`, `onReachEnd` callback cho infinite scroll. DOM chỉ render ~15-20 nodes visible. |
| **Hiệu suất** | Waterfall requests trong `use-deck-data.ts`: deck → template → cards (3 sequential) — template chờ deck resolve xong mới fetch             | 🟠 Trung bình             | ✅ ĐÃ SỬA — use-deck-data.ts dùng TanStack Query: deck + cards fetch song song (createInfiniteQuery), template chờ deck (cần cardTemplateId). Giảm ~200ms.            |
| **Hiệu suất** | Sidebar folders N+1: mỗi class expand trigger `GET /folders/by-class/:classId` riêng biệt — 10 classes = 10 requests tuần tự               | 🟡 Thấp                   | ✅ ĐÃ SỬA — `GET /folders/all` batch endpoint + sidebar-context.tsx dùng TanStack Query với `createMemo` derived `foldersByClass`.                                    |
| **Hiệu suất** | Không có cache sharing giữa pages (createResource) — navigate deck→study→deck = refetch toàn bộ. Dashboard refetch 4 queries mỗi lần mount | 🟠 Trung bình             | ✅ ĐÃ SỬA — TanStack Query cache active trên toàn bộ pages. Navigate giữa pages dùng stale-while-revalidate, không blank screen.                                      |
| **Hiệu suất** | `card-templates.service.ts` `getWithFields`: fetch template rồi mới fetch fields (sequential) — có thể `Promise.all`                       | 🟡 Thấp                   | ✅ ĐÃ SỬA — `getWithFields` dùng `Promise.all` fetch template + fields song song. Giảm ~5-15ms.                                                                       |
| **Hiệu suất** | Export CSV/JSON load toàn bộ cards + field_values vào memory — deck 10K cards × 5 fields = 50K rows in memory, không streaming             | 🟡 Trung bình (scale kém) | ✅ ĐÃ CẢI THIỆN — `EXPORT_CHUNK_SIZE = 500` chunked processing. Vẫn in-memory nhưng đã giới hạn chunk size. True streaming response chưa có.                          |
| **Hiệu suất** | `review_logs` table tăng không giới hạn (immutable append-only) — không có retention policy hay archival strategy                          | 🟡 Thấp (long-term)       | ⚠️ CÒN TỒN TẠI — mỗi review = 1 row mới. User active 50 reviews/ngày × 365 = 18K rows/năm/user. Cần partition hoặc archival khi scale                                 |
| **Thiếu sót** | Không có luồng đổi/đặt lại mật khẩu                                                                                                        | 🟠 Trung bình             | ✅ ĐÃ SỬA — change password modal + reset password flow                                                                                                               |
| **Thiếu sót** | Không có endpoint tạo thẻ hàng loạt                                                                                                        | 🟠 Trung bình             | ✅ ĐÃ SỬA — `POST /cards/by-deck/:deckId/batch`                                                                                                                       |
| **Thiếu sót** | Không có endpoint sắp xếp lại thẻ (schema đã có `sort_order`)                                                                              | 🟡 Thấp                   | ✅ ĐÃ SỬA — `PATCH /cards/by-deck/:deckId/reorder`                                                                                                                    |
| **Thiếu sót** | Không thể di chuyển deck giữa các thư mục                                                                                                  | 🟡 Thấp                   | ✅ ĐÃ SỬA — `PATCH /decks/:id/move`                                                                                                                                   |

---

## 🔬 Tóm tắt Nghiên cứu Thị trường

### Cảnh quan Cạnh tranh

| Đối thủ        | Tính năng Khủng                                                | Điểm yếu                                                                    | Cơ hội cho Engram Spira                                                     |
| -------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| **Anki**       | Hệ sinh thái plugin, sức mạnh desktop, thuật toán FSRS (2023+) | UI xấu, đường cong học tập dốc, không collab realtime                       | UI hiện đại + AI Card Factory + zero-config                                 |
| **SuperMemo**  | Thuật toán SM-18, đọc tăng dần (incremental reading)           | Chỉ có trên Windows, UI cổ lỗ sĩ, giá $60+                                  | Ưu tiên Web, điều chỉnh concept incremental reading                         |
| **Mochi**      | Thẻ Markdown, tối giản                                         | Không được chọn thuật toán SRS, không có tính xã hội                        | Tính linh hoạt của template đã vượt trội                                    |
| **RemNote**    | Knowledge graph + SRS + backlinks                              | Cồng kềnh, chậm, phức tạp                                                   | Tập trung vào SRS + knowledge graph như một tiện ích bổ sung                |
| **Quizlet**    | Thư viện deck chia sẻ khổng lồ, game hóa                       | Trả phí chặn tính năng, không có thuật toán SRS thực sự (ôn tập ngẫu nhiên) | Đem SM-2/FSRS thực thụ đối đầu với tính năng "spaced study" giả của Quizlet |
| **Brainscape** | Lặp lại dựa trên độ tự tin (thang 1-5)                         | Tùy chỉnh hạn chế, đắt đỏ                                                   | Đã có sẵn review đa hành động                                               |
| **Memrise**    | Nội dung do AI tạo, video nhập vai                             | Chỉ dạng gói đăng ký, tập trung vào ngôn ngữ                                | AI tạo thẻ là một tính năng, không phải là toàn bộ sản phẩm                 |
| **Orbit**      | Nhúng SRS vào bài viết (Andy Matuschak)                        | Không phải là ứng dụng độc lập                                              | Extension trình duyệt + concept nhúng ôn tập                                |
| **Mnemosyne**  | Mã nguồn mở, dữ liệu cấp độ nghiên cứu                         | UI tồi tệ, chỉ có trên desktop                                              | Giải pháp mã nguồn mở hiện đại thay thế                                     |
| **Wanikani**   | Tiến trình kanji dựa trên bộ thủ, siêu trí nhớ                 | Chỉ tiếng Nhật, mang tính áp đặt (opinionated)                              | Concept chuỗi điều kiện tiên quyết (prerequisite) cho mọi môn học           |

### Những Nhu cầu Chưa được Đáp ứng trên Thị trường (2024-2026)

1. **Chưa có ứng dụng SRS nào kết hợp AI tạo thẻ + knowledge graph + interleaved practice** trong cùng một sản phẩm. (Engram Spira đã có AI + interleaved, đang xây KG)
2. **Trực quan hóa đường cong quên lãng cho từng thẻ** — chỉ Anki làm được qua add-on, không ai làm native.
3. **Phát hiện tải lượng nhận thức (Cognitive load)** — không ứng dụng nào cảnh báo khi bạn học quá nhiều/kém hiệu quả.
4. **Học liền mạch đa thiết bị** — bắt đầu trên điện thoại, tiếp tục chính xác vị trí đó trên desktop.
5. **Ghi nhớ bối cảnh học tập** — "lúc học cái này mình đang nghĩ gì nhỉ?" không bao giờ được ghi lại.
6. **Lập lịch xen kẽ (Interleaving)** — xáo trộn thẻ từ các deck/môn học khác nhau một cách khoa học (đã được chứng minh là tốt hơn học theo khối).
7. **AI chấm điểm chất lượng thẻ** — phát hiện thẻ tệ (quá mơ hồ, quá giống nhau, câu hỏi mẹo).

---

## 💡 Đề xuất Tính năng

### Nhóm 1: Thay đổi Cuộc chơi (Ít ai có — tạo competitive moat)

#### 1. 🧠 FSRS Algorithm Engine — ✅ ĐÃ TRIỂN KHAI LẠI THÀNH CÔNG

> **Trạng thái**: ✅ **Đã triển khai lại thành công** (Performance Sprint, Jan 2025). FSRS v5 tích hợp qua `ts-fsrs` package, đã sửa root cause (dùng `card.due` Date trực tiếp thay vì truncate float → integer). Migration `0019_add_fsrs_support.sql` + `0020_add_fsrs_learning_steps.sql` đã applied.
>
> **Dual-algorithm**: SM-2 mặc định, FSRS opt-in trong Settings (toggle UI). Engine dispatcher `dispatchReview()` trong `srs.engine.ts` route đến đúng algorithm. Các cột FSRS (`stability`, `difficulty`, `fsrs_state`, `learning_steps`, `last_elapsed_days`) nullable trong `study_progress` để không ảnh hưởng SM-2 users.

##### Root Cause (đã sửa)

Lỗi scheduling ban đầu do `study_progress.intervalDays` type **integer** truncate FSRS float (VD: `0.007` ngày → `0`). **Đã sửa** bằng cách dùng `card.due` Date trực tiếp từ ts-fsrs v5 → `nextReviewAt` timestamp. `intervalDays` giữ integer cho display only.

##### Implementation Details

- **Engine**: `fsrs.engine.ts` — `calculateFsrsReview()` với `learning_steps: ['1m', '15m']`, `relearning_steps: ['10m']`
- **Dispatcher**: `srs.engine.ts` — `dispatchReview(algorithm, action, sm2State, fsrsState)`
- **Schema**: Migration 0019 + 0020 — `stability`, `difficulty`, `fsrs_state`, `last_elapsed_days`, `learning_steps` (nullable) + `fsrs_user_params` table + `users.srs_algorithm`
- **Frontend**: Settings page có SM-2/FSRS toggle cards với mutation + invalidation
- **Backward compatible**: SM-2 users không bị ảnh hưởng (FSRS columns nullable)

---

#### 2. 🤖 AI Card Factory (Tự động tạo thẻ từ bất kỳ nội dung nào) — ✅ ĐÃ TRIỂN KHAI

**Mô tả**: Người dùng dán văn bản, tải PDF lên, hoặc cung cấp URL → hệ thống dùng LLM trích xuất các khái niệm chính và tạo flashcard khớp với template mà người dùng đã chọn. Hỗ trợ: văn bản thuần, PDF, transcript YouTube, Wikipedia, chương sách giáo khoa.

**Tại sao đột phá**: Tạo thẻ là rào cản #1 trong việc áp dụng SRS. Người dùng Anki tốn nhiều thời gian làm thẻ hơn là học. Chưa có ứng dụng SRS web nào có tính năng tạo thẻ AI đạt chuẩn production mà lại nhận thức được template.

**Mức độ khó**: Trung bình (dùng Google Gemini API) — hệ thống EAV dựa trên template hiện tại làm cho việc này trở nên tinh gọn vì AI chỉ cần điền vào các trường template.

**Ưu tiên**: Bắt buộc phải có (Giai đoạn 2)

**Thay đổi Schema**:

- Bảng `ai_generation_jobs`: `id`, `user_id`, `deck_id`, `source_text` (text, max 10K chars), `status` (processing/pending/failed/saved/expired), `card_count` (int), `generated_cards` (jsonb nullable), `model` (text), `error_message` (text nullable), `created_at`
- Không thay đổi schema của card — AI tạo thẻ dùng cấu trúc `cards` + `card_field_values` hiện có

**API endpoints** (4 endpoints):

- `POST /ai/generate` — nhận `{ deckId, sourceText, backLanguage? }`, trả về `{ jobId, status: 'processing' }`. Background job gọi Gemini streaming.
- `GET /ai/jobs/:jobId` — poll trạng thái job + lấy generated cards
- `POST /ai/jobs/:jobId/save` — lưu thẻ đã tạo vào deck (hỗ trợ editedCards cho preview/edit trước khi lưu)
- `GET /ai/jobs` — liệt kê jobs của user (filter theo status, mặc định 20 gần nhất)

**Bên thứ 3**: **Google Gemini 3 Flash** (model mặc định `gemini-3-flash-preview`, override qua env `GEMINI_MODEL`). Free tier đủ cho giai đoạn đầu. Chi phí paid tier rẻ hơn đáng kể so với OpenAI ở quy mô 100+ users.

**Rate limiting**: Per-user in-memory rate limit 30 req/hour + route-level `elysia-rate-limit` 20 req/min trên POST /ai/generate.

**Tương thích**: Sử dụng hệ thống trường template hiện có — AI auto-detect mode (vocabulary/Q&A) từ template fields. Vocabulary mode sinh thêm IPA, word type, examples. Tích hợp với batch insert trong transaction có row-level lock.

---

#### 3. 🔗 Knowledge Graph & Prerequisite Chains (Đồ thị Kiến thức & Chuỗi Tiên quyết)

**Mô tả**: Thẻ có thể được liên kết với nhau bằng các loại quan hệ: `related_to` (liên quan), `prerequisite_of` (tiên quyết cho), `opposite_of` (trái nghĩa), `example_of` (ví dụ của). Người dùng có thể liên kết thủ công hoặc AI tự động phát hiện. Giao diện đồ thị trực quan cho thấy kiến thức kết nối ra sao. Chuỗi tiên quyết bắt buộc thứ tự học — thẻ B sẽ không xuất hiện để ôn tập cho đến khi thẻ A được thành thạo (ease_factor > 2.0, trên 3 lần ôn tập thành công).

**Tại sao đột phá**: RemNote có backlinks nhưng không có chuỗi tiên quyết nhận thức được SRS. Anki không có tính năng liên kết. Không có ứng dụng SRS nào bắt buộc học theo kiểu "học A trước B" một cách thông minh.

**Bằng chứng**: Roediger & Butler (2011) — kiến thức tiên quyết ảnh hưởng mạnh mẽ đến việc ghi nhớ tài liệu mới. Knowledge graph khai thác hiệu ứng "mã hóa tỉ mỉ" (elaborative encoding).

**Mức độ khó**: Khó

**Ưu tiên**: Nên có (Giai đoạn 3)

**Thay đổi Schema**:

- Bảng `card_links` (✅ Đã tạo): `id`, `source_card_id` (FK→cards ON DELETE CASCADE), `target_card_id` (FK→cards ON DELETE CASCADE), `link_type` (varchar(20), default 'related'), `created_at`. Constraints: UNIQUE(source, target) + CHECK no self-link. Indexes: btree trên source và target.
- Bảng `card_concepts` (✅ Đã tạo): `id`, `card_id` (FK→cards ON DELETE CASCADE), `concept` (varchar(255)), `created_at`. Indexes: btree trên card_id và concept.
- ⚠️ **Lưu ý**: cột `embedding vector(768)` ban đầu được thêm vào `card_field_values` (migration 0011) nhưng đã bị **xóa hoàn toàn** (migration 0015). card_concepts hiện KHÔNG có cột embedding. Cần thêm lại nếu muốn dùng pgvector cho semantic search.
- ⚠️ **Trạng thái thực tế**: Chỉ có schema (Drizzle + migration). **KHÔNG có routes, services, hay endpoints nào** cho Knowledge Graph. Bảng là shell rỗng. Types exported sang `@engram/shared` (LINK_TYPES).

**API endpoints**:

- `POST /cards/:id/links` — tạo liên kết
- `GET /cards/:id/links` — lấy toàn bộ liên kết của thẻ
- `DELETE /cards/links/:linkId` — xóa liên kết
- `GET /decks/:id/graph` — lấy dữ liệu đồ thị (node + edge) để hiển thị
- `POST /ai/detect-relationships` — AI quét deck và đề xuất liên kết
- `GET /study/deck/:deckId` — sửa đổi để tôn trọng chuỗi tiên quyết (lọc bỏ thẻ mà thẻ tiên quyết của nó chưa được thành thạo)

---

#### 4. 📊 Forgetting Forecast & Retention Heatmap (Dự báo Quên & Biểu đồ Nhiệt Ghi nhớ)

**Mô tả**: Một widget trên dashboard dự đoán chính xác những thẻ nào bạn sẽ quên trong 7/14/30 ngày tới dựa trên đường cong ổn định (stability curves) hiện tại. Hiển thị một heatmap về xác suất ghi nhớ của tất cả thẻ theo thời gian. Gửi thông báo chủ động: "5 thẻ trong deck IELTS của bạn sắp rớt xuống dưới 80% tỷ lệ ghi nhớ."

**Tại sao đột phá**: Không có ứng dụng SRS nào hiển thị dự báo quên cá nhân hóa. Anki có add-on "dự báo" nhưng chỉ đếm thẻ đến hạn — nó không dự đoán xác suất ghi nhớ thực sự của từng thẻ.

**Bằng chứng**: Đường cong quên Ebbinghaus + mô hình ổn định FSRS cho phép dự đoán khả năng ghi nhớ thẻ ở bất kỳ thời điểm tương lai $t$ nào: $R(t) = e^{-t/S}$ trong đó $S$ là độ ổn định (stability) của thẻ.

**Mức độ khó**: Trung bình (dùng dữ liệu SM-2 intervalDays/easeFactor thay vì FSRS stability)

**Ưu tiên**: Nên có (Giai đoạn 3)

**API endpoints**:

- `GET /study/forecast?days=N` — Trả về dự báo theo ngày: `{ date, predictedForgotten, predictedRetention, cardsByDeck[] }`
- `GET /study/retention-heatmap?deckId=X` — Trả về ma trận xác suất ghi nhớ thẻ × thời gian
- `GET /study/at-risk-cards?threshold=0.8` — Các thẻ được dự đoán sẽ rớt xuống dưới ngưỡng

---

#### 5. 🎯 Interleaved Practice Mode (Chế độ Học Xen kẽ) — ✅ ĐÃ TRIỂN KHAI

**Mô tả**: Thay vì học từng deck một (học theo khối - blocked practice), người dùng có thể vào "Chế độ Xen kẽ" — hệ thống xáo trộn các thẻ đến hạn từ nhiều deck/môn học khác nhau, hiển thị theo thứ tự xen kẽ tối ưu. Xen kẽ cải thiện khả năng phân biệt và ghi nhớ dài hạn đáng kể.

**Tại sao đột phá**: Mọi ứng dụng SRS đều bắt buộc học theo từng deck. Không ứng dụng nào áp dụng phương pháp học xen kẽ đã được khoa học chứng minh này. Đây là khám phá bị bỏ ngỏ nhiều nhất trong khoa học học tập.

**Bằng chứng**: Rohrer, D. (2012). "Interleaving Helps Students Distinguish among Similar Concepts" — cải thiện 43% điểm kiểm tra. Kornell & Bjork (2008) cũng xác nhận lợi ích duy trì ghi nhớ.

**Mức độ khó**: Trung bình

**Ưu tiên**: Bắt buộc phải có (Giai đoạn 2)

**Thay đổi Schema**: Không có (dùng `study_progress` hiện tại trên nhiều deck)

**API endpoints**:

- `POST /study/interleaved` — nhận `{ deckIds[], limit? }`, trả về thẻ đến hạn đan xen từ nhiều deck, sắp xếp kết hợp giữa độ cấp bách + luân phiên môn học
- `GET /study/interleaved/auto` — Hệ thống tự chọn deck để đan xen dựa trên số lượng đến hạn và sự đa dạng môn học

**Tương thích**: Tái sử dụng hạ tầng học hiện tại. Frontend thêm nút "Học Xen kẽ" trên dashboard.

---

### Nhóm 2: Yếu tố Khác biệt Mạnh mẽ

#### 6. 🔍 AI Duplicate & Quality Detection (AI Phát hiện Trùng lặp & Kiểm tra Chất lượng) — ❌ CHƯA TRIỂN KHAI

> **Trạng thái**: ❌ **Chưa triển khai**. Embedding column `vector(768)` từng được thêm vào `card_field_values` (migration 0011) nhưng đã bị **xóa hoàn toàn** (migration 0015). Không có endpoint `/ai/check-duplicates` hay `/ai/quality-score` nào trong codebase. Zero backend code cho tính năng này.
>
> Roadmap trước đây ghi "✅ ĐÃ TRIỂN KHAI (Backend)" là **sai**. Cần triển khai từ đầu.

**Mô tả**: Khi tạo hoặc import thẻ, AI kiểm tra: thẻ trùng lặp ngữ nghĩa (khác câu chữ, cùng khái niệm), các vấn đề chất lượng (quá mơ hồ, quá dài, câu hỏi mẹo, thiếu ngữ cảnh), và đề xuất cải thiện.

**Mức độ khó**: Trung bình (embedding similarity + LLM evaluation)

**Ưu tiên**: Nên có (Giai đoạn 3 — chuyển từ Giai đoạn 2 vì chưa bắt đầu)

**Thay đổi Schema cần thiết**:

- Thêm cột `embedding` (vector(768)) vào `card_concepts` — dimension của Gemini `text-embedding-004`
- Yêu cầu extension pgvector (migration graceful: chỉ thêm cột nếu extension có sẵn)
- Hoặc: dùng approach LLM-only (gửi batch card text cho Gemini so sánh) — không cần pgvector

**API endpoints (chưa có, cần tạo)**:

- `POST /ai/check-duplicates` — `{ deckId, fieldValues[] }` → trả về các thẻ tương tự hiện có kèm điểm tương đồng
- `POST /ai/quality-score` — chấm điểm thẻ từ 1-10 kèm đề xuất cải thiện

---

#### 7. 💡 AI Tutor (Giải thích khi Thất bại)

**Mô tả**: Khi người dùng ấn "Again" (quên), một bảng gia sư AI sẽ trượt ra kèm theo: mẹo ghi nhớ (mnemonic) cho thẻ đó, giải thích về khái niệm, kết nối với những thẻ khác mà họ đã thuộc, và một câu đố nhỏ (micro-quiz) để củng cố.

**Mức độ khó**: Trung bình

**Ưu tiên**: Nên có (Giai đoạn 3)

**API endpoints**:

- `POST /ai/explain` — `{ cardId, context: 'forgot' }` → trả về giải thích, mẹo ghi nhớ, các thẻ liên quan

---

#### 8. 🏪 Shared Deck Marketplace (Chợ Deck Chia sẻ)

**Mô tả**: Người dùng có thể publish deck lên chợ công cộng. Người khác có thể clone (fork) chúng. Hệ thống đánh giá (1-5 sao), lượt tải, danh mục/tag. Phiên bản hóa deck — khi tác giả cập nhật, người đăng ký sẽ nhận được thông báo.

**Mức độ khó**: Khó

**Ưu tiên**: Nên có (Giai đoạn 3)

**Thay đổi Schema**:

- Bảng mới `published_decks`: `id`, `deck_id`, `author_id`, `title`, `description`, `category`, `tags` (text[]), `card_count`, `rating_avg`, `rating_count`, `download_count`, `version`, `is_public`, `published_at`, `updated_at`
- Bảng mới `deck_ratings`: `id`, `published_deck_id`, `user_id`, `rating` (1-5), `review_text`, `created_at`
- Bảng mới `deck_subscriptions`: `id`, `user_id`, `published_deck_id`, `forked_deck_id`, `subscribed_at`

**API endpoints**:

- `POST /marketplace/publish` — publish một deck
- `GET /marketplace/search?q=&category=&sort=` — tìm kiếm deck trên chợ
- `POST /marketplace/:id/clone` — fork deck vào thư viện của người dùng
- `POST /marketplace/:id/rate` — đánh giá deck

---

#### 9. ⏰ Optimal Review Time Prediction (Dự đoán Giờ Ôn tập Tối ưu)

**Mô tả**: Vượt ra ngoài việc lên lịch ngày nào cần ôn tập, dự đoán _giờ_ tối ưu trong ngày dựa trên biểu đồ hiệu suất lịch sử của người dùng. "Bạn ghi nhớ tốt hơn 15% khi học từ vựng lúc 9h sáng so với 11h đêm."

**Bằng chứng**: Nghiên cứu nhịp sinh học chỉ ra rằng quá trình củng cố trí nhớ thay đổi theo thời gian trong ngày (Smarr & Schirmer, 2018).

**Mức độ khó**: Trung bình (cần review_logs có timestamp)

**Ưu tiên**: Có thì tốt (Giai đoạn 4)

**Thay đổi Schema**: Dùng `review_logs` từ Tính năng #1 (đã có `review_timestamp`)

**API endpoints**:

- `GET /study/optimal-time` — trả về giờ học được đề xuất dựa trên tỷ lệ thành công lịch sử theo giờ

---

#### 10. 🧩 Image Occlusion (Che Hình ảnh)

**Mô tả**: Tải ảnh lên (sơ đồ giải phẫu, bản đồ, mạch điện), vẽ các vùng chữ nhật/tự do để "che" (occlude). Khi học, một vùng sẽ bị che đi — người dùng phải nhớ nội dung bên dưới là gì. Tính năng cực kỳ thiết yếu cho sinh viên y, địa lý, các môn học trực quan.

**Mức độ khó**: Khó (vẽ canvas + lưu trữ vùng che + render)

**Ưu tiên**: Nên có (Giai đoạn 3)

**Thay đổi Schema**:

- Thêm field_type mới trong template: `image_occlusion`
- Dữ liệu vùng che lưu trong `card_field_values.value` dưới dạng jsonb: `{ imageUrl, regions: [{ x, y, w, h, label }] }`
- Mỗi vùng che trở thành một "thẻ con" riêng biệt cho mục đích tính toán SRS

---

### Nhóm 3: Table Stakes (Yêu cầu cơ bản để cạnh tranh)

#### 11. Import/Export (CSV, Anki, JSON) — ✅ CSV ĐÃ TRIỂN KHAI

**Mức độ khó**: Trung bình — `POST /import/csv`, `GET /export/:deckId?format=csv|json`. Anki .apkg chưa làm.

#### 12. Browser Extension (Bôi đen → Tạo Thẻ) — ✅ MVP ĐÃ TRIỂN KHAI

**Mức độ khó**: Trung bình — Chrome Manifest V3, context menu + popup

#### 13. Mobile-Responsive PWA

**Mức độ khó**: Trung bình — responsive CSS + service worker + manifest.json

#### 14. Password Reset & Email Verification — ✅ CHANGE + RESET ĐÃ TRIỂN KHAI

**Mức độ khó**: Dễ — `POST /auth/change-password` + modal UI, `POST /auth/forgot-password` + `POST /auth/reset-password` + bảng `password_reset_tokens`. Email verification chưa làm.

#### 15. Rate Limiting & CSRF Protection — ✅ RATE LIMITING ĐÃ TRIỂN KHAI (đầy đủ)

**Mức độ khó**: Dễ — `elysia-rate-limit` trên **4 module**:

- `/auth`: 5 req/min/IP
- `/study`: 180 req/min/IP
- `/ai` POST generate: 20 req/min/IP + per-user in-memory 30 req/hour
- `/import-export`: 15 req/min/IP

CSRF chưa làm (sameSite=lax đủ dùng cho SPA).

---

### Nhóm 4: Ý tưởng Đột phá Moonshot (Chưa ai làm)

#### 16. 🌀 "Context Replay" — Ghi lại Bối cảnh Học

Khi học, hệ thống âm thầm ghi lại "bối cảnh học": lúc mấy giờ, môi trường (ồn/yên tĩnh qua mic), tốc độ lật thẻ, kiểu chần chừ. Khi bạn quên một thẻ vài tuần sau, hệ thống có thể báo: "Lần trước bạn học cái này lúc 2h chiều ngày 5 tháng 3, bạn chần chừ 4.2s trước khi lật, và bạn đã trả lời đúng sau khi thấy nó 3 lần." Tính năng này khai thác **tính đặc thù mã hóa (encoding specificity)** (Tulving & Thomson, 1973) — nhớ lại bối cảnh học giúp hồi tưởng nội dung.
**Chưa có app SRS nào ghi lại hoặc phát lại bối cảnh học.**

#### 17. 🧬 "Memory Fingerprint" — Mô hình Nhận thức Cá nhân hóa

Xây dựng mô hình cá nhân hóa về điểm mạnh/yếu của trí nhớ mỗi người: "Bạn tiếp thu khái niệm trực quan nhanh hơn 40% so với định nghĩa trừu tượng. Tỷ lệ nhớ của bạn giảm mạnh sau phiên học 45 phút. Bạn học tốt hơn 25% vào buổi sáng." Điều này vượt xa FSRS (chỉ mô hình hóa cấp độ thẻ) để mô hình hóa **chính người học**.
Dùng: phân tích review_logs, theo dõi thời lượng phiên học (đã có focus timer!), hiệu suất theo loại template thẻ, phân tích thời gian trong ngày.

#### 18. 🎭 "Desirable Difficulty" Mode (Chế độ Khó mong muốn)

Tự động đưa ra các biến thể khó hơn của thẻ mà bạn đang thuộc quá dễ: hiển thị định nghĩa → nhớ ra từ (reverse cards), thêm nhiễu/yếu tố gây xao nhãng, loại bỏ dần trường ngữ cảnh, tạo ra câu hỏi tương tự-nhưng-khác. Dựa trên khung "những khó khăn đáng mong đợi" của Bjork (1994).

#### 19. 🌊 "Flow Study" — Thời lượng Phiên học Thích ứng

Thay vì "học 20 thẻ đến hạn", hệ thống tự động điều chỉnh độ dài phiên học dựa trên hiệu suất thời gian thực: nếu bạn đang trong trạng thái "flow" (nhanh, chính xác), nó sẽ cho học tiếp. Nếu độ chính xác giảm (cạn kiệt nhận thức), nó tự động kết thúc phiên kèm tóm tắt. Phát hiện flow qua pattern thời gian phản hồi.

---

## 🗺️ Lộ trình Đề xuất

### Giai đoạn 1: Gia cố MVP (2-4 tuần) — ✅ HOÀN THÀNH 100%

1. ~~**Rate limiting** trên các endpoint auth~~ ✅
2. ~~**Error boundary** ở frontend~~ ✅
3. ~~**Đổi mật khẩu** trong Cài đặt~~ ✅
4. ~~**Endpoint tạo thẻ hàng loạt**~~ ✅
5. ~~**Endpoint sắp xếp lại thẻ**~~ ✅
6. ~~**Sửa TanStack Query**~~ ✅ — QueryClientProvider wired (chưa migrate pages sang createQuery)
7. ~~**Điều hướng mobile responsive**~~ ✅
8. ~~**`@engram/shared`** điền các type dùng chung~~ ✅
9. ~~**Thêm nút "Easy"** vào SM-2 engine~~ ✅
10. ~~**Import/Export CSV**~~ ✅

### Giai đoạn 2: Khác biệt hóa (1-2 tháng) — ✅ HOÀN THÀNH 95% (AI Duplicate chuyển sang Phase 3)

1. ~~**FSRS Algorithm Engine** (Tính năng #1)~~ ✅ Đã triển khai lại thành công với ts-fsrs v5 (migration 0019 + 0020)
2. ~~**AI Card Factory** (Tính năng #2)~~ ✅ — Gemini 3 Flash (model `gemini-3-flash-preview`)
3. ~~**Học Xen kẽ (Interleaved Practice)** (Tính năng #5)~~ ✅
4. **AI Duplicate Detection** (Tính năng #6) ❌ — embedding đã bị xóa, không có endpoint. **Chuyển sang Giai đoạn 3**
5. ~~**Ghi log ôn tập (Review logging)**~~ ✅ — review_logs table + auto-logging
6. ~~**Browser Extension** MVP~~ ✅ — Chrome Manifest V3

### Giai đoạn 3: Xây dựng Rào cản (Moat) (3-6 tháng) — 🔄 ĐANG TIẾN HÀNH (3/8 tasks — FSRS + TanStack + Performance đã xong)

1. **Knowledge Graph** (Tính năng #3) — liên kết thẻ + chuỗi tiên quyết (schema card_links + card_concepts ĐÃ TẠO, **chưa có routes/services**)
2. **Forgetting Forecast** (Tính năng #4) — phân tích dự đoán (giờ đã có FSRS stability cho dự đoán chính xác hơn)
3. **AI Duplicate Detection** (Tính năng #6) — phát hiện trùng lặp (chuyển từ Giai đoạn 2)
4. **AI Tutor** (Tính năng #7) — giải thích khi quên
5. **Shared Deck Marketplace** (Tính năng #8) — cộng đồng
6. ~~**FSRS Algorithm Engine** (Tính năng #1)~~ ✅ Đã triển khai lại (Performance Sprint)
7. ~~**Migrate TanStack Query**~~ ✅ Toàn bộ 9+ pages đã migrate (Performance Sprint)
8. ~~**Performance Fixes**~~ ✅ Debounce, VirtualList, waterfall, sidebar batch, export chunking (Performance Sprint)

### Giai đoạn 4: Moonshot (6-12 tháng)

1. **Memory Fingerprint** (Tính năng #17) — mô hình nhận thức theo người dùng
2. **Desirable Difficulty Mode** (Tính năng #18) — các biến thể thẻ thích ứng
3. **Flow Study** (Tính năng #19) — thởi lượng phiên học thích ứng
4. **Optimal Review Time** (Tính năng #9) — lên lịch dựa trên nhịp sinh học
5. **Context Replay** (Tính năng #16) — ghi nhớ môi trường học

---

## ⚙️ Ghi chú Triển khai Kỹ thuật

### Tóm tắt Thay đổi Schema (tất cả các giai đoạn)

| Bảng                    | Mục đích                                                | Giai đoạn   | Trạng thái       |
| ----------------------- | ------------------------------------------------------- | ----------- | ---------------- |
| `review_logs`           | Log sự kiện cho mỗi lần ôn tập (nền tảng cho analytics) | 2           | ✅ Đã tạo        |
| `fsrs_user_params`      | Tham số FSRS riêng cho người dùng (JSON params)         | 2 (re-impl) | ✅ Đã tạo lại    |
| `ai_generation_jobs`    | Hàng đợi (queue) chạy job tạo thẻ AI                    | 2           | ✅ Đã tạo        |
| `card_links`            | Mối quan hệ giữa các thẻ + chuỗi tiên quyết             | 3           | ✅ Schema đã tạo |
| `card_concepts`         | Khái niệm thẻ (chưa có embedding, pgvector đã xóa)      | 3           | ✅ Schema đã tạo |
| `published_decks`       | Các deck được publish lên marketplace                   | 3           | Chưa             |
| `deck_ratings`          | Đánh giá marketplace                                    | 3           | Chưa             |
| `deck_subscriptions`    | Lượt đăng ký/fork trên marketplace                      | 3           | Chưa             |
| `password_reset_tokens` | Token đặt lại mật khẩu (TTL 1h)                         | 1           | ✅ Đã tạo        |
| `study_daily_logs`      | Log học hàng ngày                                       | 1           | ✅ Đã tạo        |

### Nhóm API Endpoint Mới

| Nhóm                                                                     | Số lượng    | Giai đoạn   | Trạng thái  |
| ------------------------------------------------------------------------ | ----------- | ----------- | ----------- |
| `/study/algorithm` (GET + PATCH)                                         | 2 endpoints | 2 (re-impl) | ✅ Xong     |
| `/ai/*` (generate, jobs/:id, jobs/:id/save, jobs)                        | 4 endpoints | 2           | ✅ 4/4 xong |
| `/study/interleaved/*`                                                   | 2 endpoints | 2           | ✅ Xong     |
| `/study/forecast`, `/study/retention-heatmap`, `/study/at-risk-cards`    | 3 endpoints | 3           | Chưa        |
| `/marketplace/*`                                                         | 4 endpoints | 3           | Chưa        |
| `/import/*`, `/export/*`                                                 | 3 endpoints | 1           | ✅ Xong     |
| `/auth/forgot-password`, `/auth/reset-password`, `/auth/change-password` | 3 endpoints | 1           | ✅ Xong     |

### Dịch vụ Bên Thứ ba Cần thiết

| Dịch vụ                             | Mục đích                                                     | Ước tính Chi phí                               | Trạng thái                                                   |
| ----------------------------------- | ------------------------------------------------------------ | ---------------------------------------------- | ------------------------------------------------------------ |
| **Google Gemini 3 Flash**           | AI tạo thẻ (generative, model `gemini-3-flash-preview`)      | Free tier đủ dùng. Paid: rẻ hơn OpenAI đáng kể | ✅ Đã tích hợp                                               |
| **Gemini `text-embedding-004`**     | Sinh vector dimension 768 cho phát hiện trùng lặp & KG       | Free tier đủ dùng; paid rất rẻ                 | ❌ Chưa tích hợp (embedding đã bị xóa)                       |
| **pgvector** (PostgreSQL extension) | Tìm kiếm độ tương đồng vector cho embeddings (`vector(768)`) | Miễn phí (tự host)                             | ❌ Đã loại bỏ (migration 0015 xóa cột + index)               |
| **ts-fsrs** (npm package)           | Triển khai thuật toán FSRS v5                                | Miễn phí (MIT licensed)                        | ✅ Đã tích hợp lại (Performance Sprint, migration 0019+0020) |

### Ước lượng Nỗ lực (Effort)

| Giai đoạn   | Thời gian  | Deliverables Chính                                  | Trạng thái                                |
| ----------- | ---------- | --------------------------------------------------- | ----------------------------------------- |
| Giai đoạn 1 | 2-4 tuần   | Gia cố MVP, import/export, mobile, sửa lỗi bảo mật  | ✅ Hoàn thành                             |
| Giai đoạn 2 | 6-8 tuần   | AI tạo thẻ, học xen kẽ, ghi log ôn tập, extension   | ✅ 95% (FSRS đã re-impl, AI Dup chưa làm) |
| Giai đoạn 3 | 10-14 tuần | KG, AI Dup, marketplace, dự báo, image occlusion    | 🔄 3/9 tasks (FSRS+TanStack+Perf xong)    |
| Giai đoạn 4 | 16-24 tuần | Mô hình nhận thức, độ khó thích ứng, phát hiện flow | ⬜ Chưa bắt đầu                           |

### Quyết định Cốt lõi

- **Dual-algorithm SM-2 + FSRS**: SM-2 là mặc định, FSRS v5 opt-in qua Settings toggle. FSRS đã được triển khai lại thành công (Performance Sprint) bằng cách dùng `card.due` Date trực tiếp từ ts-fsrs v5 thay vì convert sang integer days. Engine dispatcher `dispatchReview()` route đến đúng algorithm dựa trên `users.srs_algorithm`.
- **Chọn Google Gemini 3 Flash thay vì OpenAI**: Model mặc định `gemini-3-flash-preview` (override qua env `GEMINI_MODEL`). Free tier đủ cho giai đoạn bootstrap. Paid tier rẻ hơn GPT-4o-mini. API key quản lý qua Google AI Studio / GCP.
- **pgvector hiện đã bị loại bỏ**: Embedding column và HNSW index đã bị xóa (migration 0015). Nếu cần AI Duplicate Detection hoặc Knowledge Graph semantic search, có 2 hướng: (a) thêm lại pgvector với graceful degradation, hoặc (b) dùng LLM-only approach (gửi batch text cho Gemini so sánh).
- **Học Xen kẽ (Interleaving) đưa vào Giai đoạn 2**: Không phức tạp về code (tái sử dụng hạ tầng học hiện tại), được khoa học chứng minh mạnh mẽ, zero đối thủ cạnh tranh — tính năng mang lại ROI cao nhất.
- **Ghi log ôn tập làm đầu tiên**: Bảng `review_logs` là nền tảng cho thống kê, mô hình nhận thức, FSRS parameter optimization, và dự đoán giờ học tối ưu. Đã xây dựng ở Giai đoạn 2.
- **Performance Sprint hoàn tất**: TanStack Query migration (9+ pages), VirtualList, debounce, waterfall fix, sidebar batch, export chunking, FSRS re-impl — tất cả đã ship. Xem chi tiết tại `docs/dev_prompt/performance-sprint-plan.md`.

---

## 🎯 Phân tích Chi tiết Các Task Chưa Triển khai (PM Review — Updated 2026-03-18)

### Tổng quan Hiện trạng

| Metric                          | Giá trị                                                    |
| ------------------------------- | ---------------------------------------------------------- |
| **Phase 1**                     | ✅ 100% hoàn thành                                         |
| **Phase 2**                     | ✅ 95% (chỉ còn AI Duplicate Detection)                    |
| **Phase 3**                     | 🔄 3/9 (FSRS, TanStack, Performance đã xong)               |
| **Phase 4**                     | ⬜ 0%                                                      |
| **Tổng tính năng core shipped** | 16/16 features chính                                       |
| **Tech debt còn lại**           | 2 items nhỏ (review_logs retention, export true streaming) |
| **Pending features (Phase 3)**  | 5 features chưa bắt đầu (Image Occlusion đã loại bỏ)       |
| **Pending features (Phase 4)**  | 5 features moonshot                                        |

### Bảng Xếp hạng Ưu tiên — Phase 3 Remaining

| #   | Feature                                     | Lợi ích (1-5) | Khả thi (1-5) | Effort     | ROI Score      | Đề xuất Thứ tự      |
| --- | ------------------------------------------- | ------------- | ------------- | ---------- | -------------- | ------------------- |
| 1   | **Forgetting Forecast + Retention Heatmap** | ⭐⭐⭐⭐⭐    | ⭐⭐⭐⭐⭐    | 3-5 ngày   | **Rất cao**    | 🥇 Sprint tiếp theo |
| 2   | **AI Tutor (Giải thích khi quên)**          | ⭐⭐⭐⭐      | ⭐⭐⭐⭐⭐    | 2-3 ngày   | **Cao**        | 🥈 Sprint tiếp theo |
| 3   | **AI Duplicate Detection**                  | ⭐⭐⭐        | ⭐⭐⭐⭐      | 3-5 ngày   | **Trung bình** | 🥉 Sprint sau       |
| 4   | **Knowledge Graph**                         | ⭐⭐⭐⭐⭐    | ⭐⭐⭐        | 8-12 ngày  | **Trung bình** | Sprint sau          |
| 5   | **Shared Deck Marketplace**                 | ⭐⭐⭐⭐      | ⭐⭐          | 15-20 ngày | **Thấp**       | Defer               |

---

### 1. 📊 Forgetting Forecast + Retention Heatmap — ĐỀ XUẤT LÀM TRƯỚC

**Tại sao ưu tiên #1:**

- **FSRS stability đã có sẵn** → công thức $R(t) = e^{-t/S}$ áp dụng trực tiếp. SM-2 users dùng approximation từ `intervalDays` + `easeFactor`. Không cần thêm bất kỳ dependency nào.
- **Data đã đầy đủ**: `study_progress` (stability, intervalDays, nextReviewAt) + `review_logs` (timestamps). Chỉ cần logic tính toán + API + UI.
- **Unique selling point**: Không app SRS nào hiển thị forgetting forecast cá nhân hóa native (Anki chỉ đếm due cards qua add-on).
- **Dashboard screenshot** cho thấy UI sẵn sàng cho widget mới (khu vực "Study Activity" heatmap có thể mở rộng).

**Hướng triển khai:**

```
Backend (2-3 ngày):
├── GET /study/forecast?days=7|14|30
│   └── Tính R(t) cho mỗi card, aggregate theo ngày
├── GET /study/retention-heatmap?deckId=X
│   └── Ma trận card × day với probability values
└── GET /study/at-risk-cards?threshold=0.8
    └── Cards dự đoán rớt dưới threshold

Frontend (1-2 ngày):
├── Dashboard: Thêm "Retention Forecast" widget (line chart)
├── Dashboard: Thêm "At Risk" badge trên due decks
└── Deck-view: Optional retention indicator per card
```

**Rủi ro:** Thấp. Thuần computation, không có 3rd party dependency mới.

---

### 2. 🤖 AI Tutor (Giải thích khi quên) — ĐỀ XUẤT LÀM TIẾP

**Tại sao ưu tiên #2:**

- **Gemini API đã tích hợp** — chỉ cần thêm 1 endpoint + 1 prompt template. Tái sử dụng `config/ai.ts` và rate limiting infrastructure.
- **UX impact cao**: Khi user nhấn "Again", hiện tại chỉ flip card và move on. AI Tutor biến khoảnh khắc thất bại thành cơ hội học.
- **Effort rất nhỏ** so với value: 1 API endpoint, 1 frontend panel.
- **Tích hợp tự nhiên** với Knowledge Graph sau này (AI Tutor có thể reference related cards).

**Hướng triển khai:**

```
Backend (1-2 ngày):
└── POST /ai/explain
    ├── Input: { cardId, context: 'forgot' | 'curious' }
    ├── Fetch card fields + related cards (nếu có card_links)
    ├── Gemini prompt: mnemonic + explanation + micro-quiz
    └── Stream response cho UX tốt hơn

Frontend (1 ngày):
├── Study mode: "Why did I forget?" slide panel khi nhấn Again
├── Streaming text display (đã có pattern từ AI Card Factory)
└── Optional: "Save mnemonic" button → lưu vào card notes
```

**Rủi ro:** API cost tăng (mỗi "Again" = 1 Gemini call). Mitigate bằng: opt-in toggle, per-user rate limit, cache mnemonics per card.

---

### 3. 🔍 AI Duplicate Detection — TRUNG BÌNH ƯU TIÊN

**Tại sao ưu tiên #3:**

- **Problem thực sự tồn tại** nhưng không blocking: User có thể tự nhận ra duplicate khi review. Critical hơn khi deck lớn (500+ cards).
- **Hai approach khả thi**, mỗi cái có trade-off rõ ràng:

| Approach                                    | Ưu điểm                          | Nhược điểm                                            | Effort   |
| ------------------------------------------- | -------------------------------- | ----------------------------------------------------- | -------- |
| **A: LLM-only** (gửi batch text cho Gemini) | Không cần pgvector, đơn giản     | Chậm hơn, cost per call, không scalable 1000+ cards   | 2-3 ngày |
| **B: pgvector + embeddings**                | Nhanh, scalable, semantic search | Cần thêm lại extension, migration, embedding pipeline | 5-7 ngày |

**Đề xuất:** Bắt đầu với **Approach A** (LLM-only). Nếu user base grow, migrate sang B.

**Hướng triển khai (Approach A):**

```
Backend (2-3 ngày):
├── POST /ai/check-duplicates
│   ├── Input: { deckId, fieldValues[] }
│   ├── Fetch existing cards text (limit 200 per batch)
│   ├── Gemini prompt: so sánh new card vs existing, trả similarity score
│   └── Return: matched cards + similarity %
└── POST /ai/quality-score
    ├── Input: { front, back }
    ├── Gemini prompt: đánh giá 1-10 + suggestions
    └── Return: { score, issues[], suggestions[] }

Frontend (1-2 ngày):
├── Deck-view: "Check Quality" button cho batch analysis
└── Card create/edit: Warning badge nếu duplicate detected
```

---

### 4. 🔗 Knowledge Graph — CAO GIÁ TRỊ, CAO EFFORT

**Tại sao chưa nên làm ngay:**

- **Effort lớn nhất** trong Phase 3 (8-12 ngày). Schema đã có (card_links, card_concepts) nhưng cần: 6 API endpoints, frontend d3-force visualization, prerequisite chain logic trong study engine, AI relationship detection.
- **Giá trị cao nhất khi kết hợp** với AI Tutor + Forgetting Forecast → nên làm SAU 2 features đó để tạo synergy.
- **Standalone value thấp**: Nếu chỉ có manual linking mà không có AI auto-detect, rất ít user sẽ dùng.

**Đề xuất:** Chia thành 2 sub-phases:

```
Phase 3A (5-6 ngày) — Core linking:
├── Backend: CRUD routes cho card_links (create/read/delete)
├── Backend: GET /decks/:id/graph (node + edge data)
├── Frontend: Card detail → "Link to..." search + add
└── Frontend: Deck-view → "Graph View" tab (d3-force basic)

Phase 3B (3-5 ngày) — Smart features:
├── Backend: POST /ai/detect-relationships (Gemini scan deck)
├── Backend: Modify study engine → prerequisite filtering
├── Frontend: AI suggestion panel khi AI detect relationships
└── Frontend: Graph view → highlight prerequisites
```

---

### 5. 🏪 Shared Deck Marketplace — DEFER

**Tại sao defer:**

- **Effort rất lớn** (15-20 ngày): 3 bảng DB mới, 4+ endpoints, toàn bộ UI mới (search, browse, ratings, fork, subscriptions).
- **Cần user base trước**: Marketplace trống = UX xấu. Cần ít nhất 50+ active users tạo content trước khi marketplace có giá trị.
- **Security surface tăng**: Public content = moderation, spam, copyright issues.
- **Alternative tốt hơn cho giai đoạn này**: Import/Export CSV đã có → users có thể share decks thủ công qua file.

**Khi nào nên làm:** Sau khi có 50+ users active, có data cho discovery algorithm, và core learning experience đã polish xong.

---

### 6. 🧩 Image Occlusion — DEFER

**Tại sao defer:**

- **Niche nhưng deep**: Cực kỳ quan trọng cho y khoa/địa lý, nhưng phần lớn use case SRS không cần.
- **Effort cao**: Canvas drawing UI, region storage (jsonb), render engine cho study mode, mỗi region = 1 sub-card cho SRS.
- **Mobile UX phức tạp**: Drawing regions trên mobile screen rất khó dùng.

**Khi nào nên làm:** Khi có nhu cầu rõ ràng từ user feedback (medical students, geography learners).

---

### Đề xuất Sprint Tiếp theo (2-3 tuần)

| Tuần       | Tasks                                      | Deliverables                            |
| ---------- | ------------------------------------------ | --------------------------------------- |
| **Tuần 1** | Forgetting Forecast backend + frontend     | 3 API endpoints + Dashboard widget      |
| **Tuần 2** | AI Tutor backend + frontend                | 1 API endpoint + Study mode panel       |
| **Tuần 3** | AI Duplicate Detection (LLM-only approach) | 2 API endpoints + Deck-view integration |

**Sau sprint này**, Engram Spira sẽ có:

- ✅ **Dự báo quên cá nhân** — không ai có
- ✅ **AI gia sư khi thất bại** — không ai có
- ✅ **AI phát hiện duplicate** — Anki chỉ có qua add-on
- Kết hợp với AI Card Factory + FSRS + Interleaved Practice → **bộ tính năng AI + SRS mạnh nhất thị trường**

### Các Items Nhỏ Nên Xen kẽ (Low-hanging Fruit)

| Item                              | Effort   | Lý do                                                             |
| --------------------------------- | -------- | ----------------------------------------------------------------- |
| **Search & Filter sidebar**       | 1-2 ngày | TanStack Query đã có, chỉ cần filter UI + query param             |
| **Custom Template UI**            | 2-3 ngày | Backend POST đã có, chỉ thiếu frontend form                       |
| **Email Verification**            | 1-2 ngày | Đã có email infrastructure (password reset), chỉ thêm verify flow |
| **review_logs retention policy**  | 0.5 ngày | Cron job xóa logs > 2 năm hoặc partition by month                 |
| **PWA manifest + service worker** | 1 ngày   | Offline-first cho study mode, push notifications                  |

---

### Phase 4 Moonshot — Đánh giá Sơ bộ

| Feature                  | Khả thi    | Khi nào                | Ghi chú                                                                            |
| ------------------------ | ---------- | ---------------------- | ---------------------------------------------------------------------------------- |
| **Memory Fingerprint**   | Cao        | Sau KG + Forecast      | Dùng review_logs + daily_logs aggregate. Cần 30+ ngày data per user.               |
| **Desirable Difficulty** | Trung bình | Sau AI Tutor           | Gemini generate reverse/harder variants. Cần A/B testing framework.                |
| **Flow Study**           | Cao        | Bất kỳ lúc nào         | Response time tracking đã implicit trong review flow. Thêm adaptive cutoff logic.  |
| **Optimal Review Time**  | Cao        | Sau Memory Fingerprint | review_logs có timestamp. Aggregate success rate by hour-of-day. Simple analytics. |
| **Context Replay**       | Thấp       | Dài hạn                | Cần microphone permission (ồn/yên tĩnh), privacy concerns, storage cost.           |
