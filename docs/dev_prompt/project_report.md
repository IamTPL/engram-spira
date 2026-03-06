# 📚 Engram Spira — Báo cáo Kỹ thuật Toàn diện

> **Người viết**: Project Owner  
> **Đối tượng**: Intern mới onboard  
> **Mục tiêu**: Hiểu toàn bộ hệ thống — từ kiến trúc tổng thể đến từng dòng logic  
> **Ngày cập nhật**: March 2026

---

## Lời mở đầu: Engram Spira là gì?

Engram Spira là một **ứng dụng học flashcard thông minh** (Spaced Repetition System - SRS). Ý tưởng cốt lõi đến từ khoa học nhận thức: não người quên kiến thức theo một đường cong có thể dự đoán được (Ebbinghaus Forgetting Curve). Thay vì học ngẫu nhiên, SRS tính toán chính xác _khi nào_ một thẻ sắp bị quên và lên lịch ôn tập ngay trước thời điểm đó — giúp bạn nhớ lâu hơn với ít thời gian hơn.

**Điểm khác biệt** so với Anki (đối thủ lớn nhất):

- UI hiện đại, responsive, không xấu như Anki
- AI tự động tạo flashcard từ văn bản
- Interleaved Practice (xáo trộn thẻ từ nhiều deck)
- Duplicate Detection bằng vector embeddings
- Browser Extension để tạo thẻ khi lướt web

---

## Phần 1: Kiến trúc Tổng thể

### 1.1 Monorepo Structure

```
engram_spira/
├── apps/
│   ├── api/          ← Backend (Bun + ElysiaJS + Drizzle ORM)
│   └── web/          ← Frontend (SolidJS + Vite + TailwindCSS)
├── packages/
│   ├── shared/       ← Types & constants dùng chung 2 app
│   └── browser-extension/  ← Chrome Extension
└── docs/             ← Tài liệu + kế hoạch
```

**Tại sao monorepo?** Vì backend và frontend dùng chung TypeScript types. Khi bạn thêm một endpoint mới ở API, frontend ngay lập tức biết kiểu dữ liệu trả về mà không cần viết lại types thủ công. Điều này được thực hiện bởi **Eden Treaty** — một thư viện zero-codegen type-safe API client.

### 1.2 Tech Stack — Tại sao chọn những thứ này?

| Layer    | Công nghệ                     | Lý do chọn                                                      |
| -------- | ----------------------------- | --------------------------------------------------------------- |
| Runtime  | **Bun 1.3+**                  | Nhanh hơn Node.js ~3x, có bundler + test runner tích hợp        |
| Backend  | **ElysiaJS v1.4**             | Framework nhanh nhất cho Bun, AOT compilation, type-safe routes |
| Database | **PostgreSQL 15**             | ACID transactions, pgvector cho AI embeddings                   |
| ORM      | **Drizzle ORM**               | Type-safe, schema-first, migration tự động                      |
| Auth     | **Custom (Argon2 + SHA-256)** | Không phụ thuộc thư viện auth phức tạp, kiểm soát hoàn toàn     |
| Frontend | **SolidJS v1.9**              | Reactive signal-based, không có virtual DOM overhead như React  |
| Styling  | **TailwindCSS v4 + CVA**      | Utility-first, Design Variants dễ tái sử dụng                   |
| AI       | **Google Gemini 2.0 Flash**   | Free tier 1500 req/day, rẻ hơn OpenAI ~10x                      |

### 1.3 Luồng Request cơ bản

```
Browser (SolidJS)
    │
    │  HTTP Cookie (session token)
    ▼
ElysiaJS API (port 4000)
    │
    ├── Auth Middleware (validate session token)
    │
    ├── Route Handler (e.g. /study/review)
    │
    ├── Service Layer (business logic)
    │
    └── Drizzle ORM → PostgreSQL
```

---

## Phần 2: Hệ thống Authentication (Xác thực)

### 2.1 Tổng quan

Engram Spira không dùng JWT. Thay vào đó, dùng **session-based authentication** theo kiểu của Lucia Auth (nhưng tự implement để không phụ thuộc).

### 2.2 Tại sao KHÔNG dùng JWT?

JWT (JSON Web Token) là token tự chứa thông tin — server không cần tra database để biết token có hợp lệ không. Nghe hay, nhưng có vấn đề:

- **Không thể thu hồi ngay lập tức**: Nếu user bị hack, bạn không thể "đăng xuất" họ cho đến khi JWT hết hạn
- **Token lớn**: Mỗi request gửi kèm ~200 bytes header
- **Thích hợp cho microservices**: Nhưng chúng ta chỉ có 1 server

Session token nhỏ hơn (32 bytes), có thể xóa ngay lập tức, và phù hợp với SPA cookie-based.

### 2.3 Flow Đăng ký

```
Client                          Server
  │                               │
  │── POST /auth/register ──────→ │
  │   { email, password }         │
  │                               │── 1. Validate email format (t.String({ format: 'email' }))
  │                               │── 2. Check password length (8-128 chars)
  │                               │── 3. Check email uniqueness (SELECT FROM users)
  │                               │── 4. Hash password (Argon2, memory-hard)
  │                               │── 5. INSERT INTO users
  │                               │── 6. Generate session token (32 random bytes → hex)
  │                               │── 7. Hash token (SHA-256) → sessionId
  │                               │── 8. INSERT INTO sessions
  │← ─────────── 200 OK ──────── │
  │   Set-Cookie: session=<token> │
  │   { user: {...} }             │
```

**Chi tiết kỹ thuật quan trọng**:

1. **Argon2** là thuật toán hash password mạnh nhất hiện tại (2024). Khác bcrypt ở chỗ nó sử dụng nhiều bộ nhớ RAM (`memory-hard`), khiến tấn công brute-force bằng GPU gần như bất khả thi.

2. **Session token** được tạo từ `crypto.getRandomValues()` — 32 bytes ngẫu nhiên cryptographically secure, encode ra 64 ký tự hex. Token này gửi về client qua cookie.

3. **Session ID** lưu trong DB là **SHA-256 hash của token** — nếu DB bị leak, hacker không thể dùng session ID để đăng nhập (vì họ cần raw token).

4. **Rate limiting**: Toàn bộ `/auth` prefix bị giới hạn **5 requests/phút/IP** bằng `elysia-rate-limit`.

### 2.4 Session Validation & Auto-refresh

```typescript
// session.utils.ts — validateSession()
export async function validateSession(token: string) {
  const sessionId = hashToken(token);  // SHA-256

  const result = await db.select().from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, sessionId));

  // 1. Session not found → unauthorized
  if (!result.length) return { session: null, user: null };

  // 2. Session expired (30 days) → delete + unauthorized
  if (Date.now() >= session.expiresAt.getTime()) {
    await db.delete(sessions).where(eq(sessions.id, session.id));
    return { session: null, user: null };
  }

  // 3. Session expires within 15 days → auto-refresh (extend another 30 days)
  if (Date.now() >= session.expiresAt.getTime() - REFRESH_THRESHOLD_MS) {
    await db.update(sessions).set({ expiresAt: newExpiresAt })...
  }

  return { session, user };
}
```

Auto-refresh đảm bảo user đang active không bao giờ bị đăng xuất đột ngột.

### 2.5 Password Reset Flow

Khi user quên mật khẩu:

```
User                    Server                    Email
  │                       │                         │
  ├─ POST /auth/forgot ──→ │                         │
  │  { email }             │                         │
  │                        │── 1. Tìm user theo email│
  │                        │── 2. Tạo reset token    │
  │                        │   (32 bytes random)     │
  │                        │── 3. Hash token → store │
  │                        │   trong bảng            │
  │                        │   password_reset_tokens │
  │                        │   (expires 1 hour)      │
  │                        │── 4. Gửi email với raw  ──→ User nhận link
  │                        │   token trong link       │  /reset-password?token=xxx
  │← ─── 200 OK ────────── │                         │
  │  (không tiết lộ user   │                         │
  │  có tồn tại không)     │                         │
  │                        │                         │
  ├─ POST /auth/reset ────→ │                         │
  │  { token, newPassword } │                         │
  │                        │── 1. Hash token         │
  │                        │── 2. Tìm trong DB        │
  │                        │── 3. Kiểm tra chưa hết  │
  │                        │   hạn (1 giờ)           │
  │                        │── 4. Hash mật khẩu mới  │
  │                        │── 5. Update users        │
  │                        │── 6. Xóa token (1 lần   │
  │                        │   dùng)                  │
  │← ─────── 200 OK ─────── │                         │
```

**Lưu ý bảo mật**: Response của `forgot-password` luôn trả về `{ message: "If the email exists..." }` — không bao giờ tiết lộ email có trong DB hay không (tránh **user enumeration attack**).

---

## Phần 3: Mô hình Dữ liệu (Database Schema)

### 3.1 Sơ đồ quan hệ

```
users
  ├── sessions (1:N)        ← Session-based auth
  ├── classes (1:N)         ← Nhóm học/môn học
  │     └── folders (1:N)   ← Thư mục
  │           └── decks (1:N) ← Bộ thẻ
  │                 └── cards (1:N) ← Thẻ
  │                       ├── card_field_values (1:N) ← Nội dung thẻ (EAV)
  │                       │     └── [embedding vector(768)] ← pgvector
  │                       ├── study_progress (1:1 per user) ← Trạng thái SM-2
  │                       └── review_logs (1:N) ← Lịch sử ôn tập
  │
  ├── card_templates (1:N)  ← Template định nghĩa cấu trúc thẻ
  │     └── template_fields (1:N) ← Các trường (Front, Back, v.v.)
  │
  ├── study_daily_logs (1:N) ← Heatmap/Streak tracking
  ├── ai_generation_jobs (1:N) ← Lịch sử tạo thẻ AI
  └── password_reset_tokens (1:N)

card_links (self-referential)  ← Knowledge Graph
card_concepts                   ← AI-detected concepts
```

### 3.2 Thiết kế EAV cho Cards (Quan trọng!)

**EAV** = Entity-Attribute-Value pattern. Đây là pattern nâng cao, nhiều intern thường thấy lạ.

**Vấn đề**: Flashcard có thể có nhiều loại khác nhau:

- **Basic Q&A**: 2 trường (Front, Back)
- **Vocabulary**: 4 trường (Word, Pronunciation, Definition, Example)
- **Cloze**: 1 trường với `{{c1::hidden text}}`
- **Image Occlusion**: 1 ảnh với nhiều vùng che

Nếu dùng bảng thông thường, bạn phải tạo một cột cho mỗi loại trường:

```sql
-- Cách BAD: Fixed schema
CREATE TABLE cards (
  id uuid,
  front text,        -- Chỉ dùng cho Basic
  back text,         -- Chỉ dùng cho Basic
  word text,         -- Chỉ dùng cho Vocab
  pronunciation text, -- Chỉ dùng cho Vocab
  -- ... 20 cột NULL hầu hết
);
```

**Engram Spira dùng EAV:**

```sql
-- Card chỉ lưu metadata
CREATE TABLE cards (
  id uuid PRIMARY KEY,
  deck_id uuid REFERENCES decks,
  sort_order integer
);

-- Nội dung lưu trong bảng riêng
CREATE TABLE card_field_values (
  id uuid PRIMARY KEY,
  card_id uuid REFERENCES cards,
  template_field_id uuid REFERENCES template_fields,
  value jsonb  -- Linh hoạt: text, number, array, image URL...
               -- UNIQUE(card_id, template_field_id)
);

-- Template định nghĩa trường nào cần có
CREATE TABLE template_fields (
  id uuid PRIMARY KEY,
  template_id uuid REFERENCES card_templates,
  name varchar(100),   -- "Front", "Back", "Word"...
  field_type varchar,  -- text | textarea | image_url | audio_url | json_array
  side varchar(10),    -- "front" | "back"
  sort_order integer
);
```

**Ưu điểm**: Thêm loại thẻ mới hoàn toàn không cần migration DB.

### 3.3 Bảng study_progress — Trái tim của SRS

```sql
CREATE TABLE study_progress (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES users,
  card_id uuid REFERENCES cards,

  -- SM-2 state (3 con số này quyết định lịch ôn tập)
  box_level integer DEFAULT 0,      -- Số lần ôn tập thành công liên tiếp
  ease_factor float DEFAULT 2.5,    -- Hệ số tăng trưởng interval (1.3 → 2.5)
  interval_days integer DEFAULT 1,  -- Khoảng cách ngày đến lần ôn tiếp theo

  -- Timestamps
  next_review_at timestamp,         -- Khi nào ôn tiếp theo
  last_reviewed_at timestamp,

  UNIQUE(user_id, card_id)  -- Mỗi user chỉ có 1 record per card
);
```

Đây là bảng UPSERT (INSERT or UPDATE) — không bao giờ có 2 rows cho cùng 1 cặp `(user, card)`.

### 3.4 Bảng review_logs — Lịch sử bất biến

Khác `study_progress` (chỉ lưu state hiện tại), `review_logs` là **append-only log** — mỗi lần ôn tập thêm 1 row mới, không bao giờ sửa:

```sql
CREATE TABLE review_logs (
  id uuid PRIMARY KEY,
  user_id uuid,
  card_id uuid,
  rating varchar(10),       -- 'again' | 'hard' | 'good' | 'easy'
  state varchar(15),        -- 'new' | 'learning' | 'review' | 'relearning'
  elapsed_days integer,     -- Bao nhiêu ngày kể từ lần trước
  scheduled_days integer,   -- Interval đã lên lịch là bao nhiêu ngày
  review_duration_ms integer, -- User trả lời nhanh hay chậm
  reviewed_at timestamp
);
```

**Dùng để làm gì?**

- Vẽ **Forgetting Curve** cho từng thẻ
- Phân tích hiệu suất học tập theo thời gian
- Nền tảng để xây dựng FSRS (nếu muốn sau này)
- **Retention Heatmap** (Sprint 3.3 — chưa implement frontend)

---

## Phần 4: Thuật toán SM-2 (Spaced Repetition)

### 4.1 SM-2 là gì và tại sao dùng?

SuperMemo 2 (SM-2) được xuất bản năm 1987 bởi Piotr Woźniak, vẫn là thuật toán SRS được dùng nhiều nhất thế giới (Anki dùng biến thể của nó).

**Ý tưởng cốt lõi**: Mỗi card có một **ease factor** riêng — phản ánh card đó khó hay dễ với BẠN cụ thể. Interval tiếp theo = interval hiện tại × ease factor.

```
Lần 1 GOOD → interval = 1 ngày
Lần 2 GOOD → interval = 6 ngày
Lần 3 GOOD → interval = 6 × 2.5 = 15 ngày
Lần 4 GOOD → interval = 15 × 2.5 = 37 ngày
Lần 5 GOOD → interval = 37 × 2.5 = 93 ngày
```

So sánh với **Leitner Box** (hộp thẻ cổ điển):

- Leitner: 1 ngày → 3 ngày → 7 ngày → 14 ngày → 30 ngày (CỐ ĐỊNH cho mọi người)
- SM-2: Cá nhân hóa theo ease factor của từng người

### 4.2 Code Implementation

File: `apps/api/src/modules/study/srs.engine.ts`

```typescript
export interface SrsState {
  boxLevel: number;    // Số lần ôn thành công (≈ repetitions)
  easeFactor: number;  // Hệ số nhân interval (tối thiểu 1.3)
  intervalDays: number; // Khoảng cách (ngày) hiện tại
}

export function calculateNextReview(
  action: ReviewAction,  // 'again' | 'hard' | 'good' | 'easy'
  current: Partial<SrsState> = {}
): SrsResult {
  const reps = current.boxLevel ?? 0;
  const ef = current.easeFactor ?? 2.5;   // Default ease factor
  const interval = current.intervalDays ?? 1;

  switch (action) { ... }
}
```

**4 nút bấm và logic của chúng:**

#### AGAIN (Quên rồi — Đỏ)

```typescript
case 'again': {
  const newEf = Math.max(1.3, ef - 0.20);  // Phạt ease factor -0.20
  return {
    boxLevel: 0,           // Reset về 0 (coi như thẻ mới)
    easeFactor: newEf,
    intervalDays: 0,
    nextReviewAt: new Date(now + 10 * 60 * 1000),  // Ôn lại sau 10 PHÚT
  };
}
```

Khi bấm AGAIN, card bị "quên". Nó sẽ xuất hiện lại ngay trong phiên học (10 phút), và ease factor bị phạt nặng nhất.

#### HARD (Khó — Cam)

```typescript
case 'hard': {
  const newEf = Math.max(1.3, ef - 0.15);   // Phạt nhẹ hơn AGAIN
  const newReps = Math.max(1, reps);          // Ít nhất tăng lên 1
  const newInterval = newReps <= 1
    ? 1                                        // Lần đầu → 1 ngày
    : Math.max(interval + 1, Math.round(interval * 1.2));  // Tăng chậm
  return { boxLevel: newReps, easeFactor: newEf, intervalDays: newInterval, ... };
}
```

#### GOOD (Bình thường — Xanh lá)

```typescript
case 'good': {
  const newReps = reps + 1;
  const newInterval =
    newReps === 1 ? 1 :      // Lần 1: 1 ngày
    newReps === 2 ? 6 :      // Lần 2: 6 ngày (cố định theo SM-2 gốc)
    Math.round(interval * ef);  // Lần 3+: interval × ease_factor
  return { boxLevel: newReps, easeFactor: ef, ... };  // EF không đổi
}
```

#### EASY (Quá dễ — Xanh dương)

```typescript
case 'easy': {
  const newEf = ef + 0.15;   // Bonus ease factor
  const newReps = reps + 1;
  const newInterval =
    newReps === 1 ? 1 :
    newReps === 2 ? Math.round(6 * 1.3) :  // Lần 2: 6 × 1.3 = 7 ngày
    Math.round(interval * newEf * 1.3);     // Tăng thêm × 1.3 bonus
  return { boxLevel: newReps, easeFactor: newEf, ... };
}
```

### 4.3 Phân loại trạng thái card

Trong hàm `reviewCard()`, system phân loại card vào 4 trạng thái để ghi vào `review_logs`:

```typescript
const cardState = !currentProgress
  ? 'new' // Chưa học lần nào
  : prevBoxLevel === 0
    ? 'relearning' // Đã học rồi, quên rồi (boxLevel reset)
    : prevIntervalDays < 21
      ? 'learning' // Đang trong giai đoạn học
      : 'review'; // Đã thuộc lâu dài (21+ ngày)
```

### 4.4 Atomic Operations — Tại sao dùng Promise.all?

```typescript
// Ghi 3 thứ cùng lúc để đảm bảo consistency
await Promise.all([
  db.insert(studyProgress).values(upsertSet).onConflictDoUpdate(...),
  upsertDailyLog(userId, 1),           // Cập nhật heatmap
  db.insert(reviewLogs).values(logEntry),  // Ghi log bất biến
]);
```

`Promise.all` không phải là transaction (nếu 1 fail, 2 kia vẫn chạy). Nhưng đây là trade-off có chủ ý: nếu review log fail, điều quan trọng nhất (cập nhật progress) vẫn xảy ra. Log là "nice to have", không phải critical.

---

## Phần 5: Streak & Heatmap Tracking

### 5.1 Bảng study_daily_logs

```sql
CREATE TABLE study_daily_logs (
  user_id uuid,
  study_date date,         -- 'YYYY-MM-DD'
  cards_reviewed integer,
  PRIMARY KEY (user_id, study_date)  -- UPSERT target
);
```

Mỗi ngày học, system increment `cards_reviewed` bằng SQL UPSERT:

```sql
INSERT INTO study_daily_logs VALUES (userId, today, count)
ON CONFLICT (user_id, study_date)
DO UPDATE SET cards_reviewed = study_daily_logs.cards_reviewed + count;
```

**Tại sao dùng SQL thay vì JavaScript?** Vì đây là atomic — nếu 2 requests đến cùng lúc, không có race condition.

### 5.2 Tính Streak (Current & Longest)

```typescript
// Lấy tất cả ngày học trong 365 ngày gần nhất
const studyDates = new Set(rows.map((r) => r.studyDate)); // O(1) lookup

// Current streak: đếm ngược từ hôm nay (hoặc hôm qua nếu hôm nay chưa học)
while (true) {
  const dateStr = checkDate.toISOString().slice(0, 10);
  if (!studyDates.has(dateStr)) break; // Gặp ngày không học → dừng
  currentStreak++;
  checkDate.setDate(checkDate.getDate() - 1); // Lùi 1 ngày
}

// Longest streak: slide qua tất cả ngày đã sắp xếp
for (let i = 1; i < sortedDates.length; i++) {
  const diffDays = (curr - prev) / (1000 * 60 * 60 * 24);
  if (diffDays === 1)
    runLength++; // Ngày liên tiếp
  else {
    longestStreak = Math.max(longestStreak, runLength);
    runLength = 1;
  }
}
```

### 5.3 Heatmap trên Frontend

Frontend vẽ lưới 91 ngày (13 tuần × 7 ngày), tô màu theo `cardsReviewed`:

```
Số thẻ ôn    Màu
0            Xám nhạt
1-3          Xanh nhạt
4-7          Xanh vừa
8-14         Xanh đậm
15+          Xanh tối
```

---

## Phần 6: Interleaved Practice (Học xen kẽ)

### 6.1 Tại sao Interleaving?

Nghiên cứu nhận thức học cho thấy học xen kẽ nhiều chủ đề hiệu quả hơn học theo khối (blocked learning). Khi não phải liên tục chuyển context, nó phải làm việc nhiều hơn để retrieve kiến thức — điều này củng cố memory sâu hơn.

### 6.2 getInterleavedDueCards() — Urgency-Weighted Round-Robin

Thay vì chọn thẻ ngẫu nhiên từ nhiều deck, system dùng **urgency weighting**:

```
Urgency của một thẻ = (now - nextReviewAt) / (intervalDays × 24h)
```

Thẻ ôn muộn càng nhiều ngày (so với interval của nó) → urgency càng cao → ưu tiên ôn trước.

**Round-Robin Algorithm**:

```
Deck A: [thẻ A1 (urgency 3.2), A2 (1.5)]
Deck B: [thẻ B1 (urgency 5.1), B2 (0.8)]
Deck C: [thẻ C1 (urgency 2.0)]

Vòng 1: Lấy thẻ có urgency cao nhất từ TỪNG deck → [A1, B1, C1]
Vòng 2: Lấy tiếp → [A2, B2]
Kết quả: [A1, B1, C1, A2, B2]
```

Điều này đảm bảo mỗi deck được đại diện đồng đều, không bị một deck "lấn át" toàn bộ session.

### 6.3 getAutoInterleavedCards() — Tự động chọn deck

User không cần chọn deck thủ công. System tự động:

1. Tìm top N deck có nhiều thẻ đến hạn nhất
2. Gọi `getInterleavedDueCards()` với các deck đó

```typescript
// Lấy top 5 deck của user có nhiều thẻ due nhất
const topDecks = await db.select(...)
  .from(studyProgress)
  .innerJoin(cards, ...)
  .where(and(eq(userId), lte(nextReviewAt, now)))
  .groupBy(cards.deckId)
  .orderBy(desc(count(studyProgress.id)))
  .limit(topN);
```

---

## Phần 7: AI Card Factory

### 7.1 Tổng quan

User paste văn bản (đoạn sách, ghi chú, Wikipedia) → AI phân tích → tạo flashcard tự động.

**Model**: Google Gemini 2.0 Flash (rẻ, nhanh, đủ tốt cho task này).

### 7.2 Rate Limiting per User

Mỗi user được tối đa **30 AI requests/giờ** (in-memory, reset theo giờ):

```typescript
// config/ai.ts
const buckets = new Map<string, { count: number; resetAt: number }>();

export function checkAiRateLimit(userId: string): void {
  let bucket = buckets.get(userId);

  if (!bucket || Date.now() >= bucket.resetAt) {
    bucket = { count: 0, resetAt: Date.now() + ONE_HOUR_MS };
    buckets.set(userId, bucket);
  }

  if (bucket.count >= 30) throw new Error('Rate limit exceeded');
  bucket.count++;
}

// Cleanup stale buckets mỗi 10 phút để tránh memory leak
setInterval(
  () => {
    for (const [key, bucket] of buckets) {
      if (Date.now() >= bucket.resetAt) buckets.delete(key);
    }
  },
  10 * 60 * 1000,
);
```

### 7.3 Preview → Confirm Workflow

AI generation không save ngay. Thay vào đó có 2 bước:

```
Step 1: POST /ai/generate-cards/preview
  → Gọi Gemini API
  → Tạo ai_generation_jobs record (status: 'pending')
  → Trả về jobId + preview cards

Step 2: POST /ai/generate-cards/save
  → User xem preview, có thể edit từng card
  → Gửi lên jobId + editedCards (optional)
  → System insert vào cards + card_field_values
  → Update job status: 'pending' → 'saved'
```

**Tại sao cần preview?** AI không hoàn hảo — đôi khi tạo ra thẻ cẩu thả hoặc sai. User cần xem và edit trước khi lưu.

### 7.4 Prompt Engineering

```typescript
function buildPrompt(sourceText: string, cardCount: number): string {
  return `You are an expert flashcard creator. Generate exactly ${cardCount} high-quality flashcards...

Rules:
- Each card should test ONE concept  (tránh thẻ quá rộng)
- Front: Clear, specific question
- Back: Concise, accurate answer
- If the text is in Vietnamese, generate in Vietnamese
- If the text is in English, generate in English

Source text: ${sourceText}

Respond ONLY with a JSON array... No markdown fences.`;
}
```

**Robust JSON parsing** — AI đôi khi wrap JSON trong markdown code fences:

````typescript
const cleaned = text
  .replace(/```(?:json)?\s*/g, '') // Xóa ```json
  .replace(/```/g, '') // Xóa ``` đóng
  .trim();
generatedCards = JSON.parse(cleaned);
````

### 7.5 Job TTL (Time To Live)

Job `pending` sau 24 giờ sẽ bị đánh dấu `expired` (cleanup function):

```typescript
export async function cleanupExpiredJobs() {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  await db
    .update(aiGenerationJobs)
    .set({ status: 'expired' })
    .where(
      and(
        eq(aiGenerationJobs.status, 'pending'),
        lt(aiGenerationJobs.createdAt, cutoff),
      ),
    );
}
```

---

## Phần 8: AI Duplicate Detection (pgvector)

### 8.1 Vector Embeddings là gì?

Mỗi đoạn văn bản có thể được chuyển thành một **vector số học** (768 chiều trong trường hợp này). Các văn bản có nghĩa gần giống nhau sẽ có vector **gần nhau trong không gian vector** — đo bằng **cosine similarity**.

```
"Quả táo là loại quả có màu đỏ"  → [0.23, -0.45, 0.87, ...]  768 số
"Apple is a red fruit"            → [0.21, -0.43, 0.89, ...]  768 số
                                       └──────────────────────────┘
                                       Gần nhau → cosine similarity ≈ 0.95
```

### 8.2 pgvector Extension

PostgreSQL extension `pgvector` cho phép lưu và tìm kiếm vector:

```sql
-- Migration 0011_pgvector_embeddings.sql
CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE card_field_values ADD COLUMN embedding vector(768);
```

### 8.3 Phát hiện Duplicate

```typescript
export async function checkDuplicates(userId, deckId, text, threshold = 0.85) {
  // 1. Tạo embedding cho text cần kiểm tra
  const embedding = await generateEmbedding(text);

  // 2. Tìm card có embedding gần nhất trong cùng deck
  const results = await db.execute(sql`
    SELECT cfv.card_id, cfv.value as front_text,
           1 - (cfv.embedding <=> ${vecStr}::vector) as similarity
    FROM card_field_values cfv
    INNER JOIN cards c ON c.id = cfv.card_id
    WHERE c.deck_id = ${deckId}
      AND cfv.embedding IS NOT NULL
      AND 1 - (cfv.embedding <=> ${vecStr}::vector) > ${threshold}
    ORDER BY similarity DESC
    LIMIT 10
  `);
  //                       ^^^^^^^^^^^^
  // <=> là cosine distance operator của pgvector
  // 1 - cosine_distance = cosine similarity
}
```

**Luồng Fire-and-Forget**: Khi user tạo card mới, embedding được tạo ngầm (không blocking UI):

```typescript
// cards.service.ts — sau khi INSERT card
embedCardFields(newCard.id).catch((err) => {
  console.error('Embedding failed:', err); // Log nhưng không throw
});
// User không phải chờ embedding xong mới thấy card được tạo
```

### 8.4 Quality Score

AI đánh giá chất lượng flashcard (1-10) dựa trên 4 tiêu chí:

- **Specificity**: Câu hỏi rõ ràng, có thể kiểm tra được?
- **Conciseness**: Câu trả lời ngắn gọn, tập trung?
- **Accuracy**: Câu trả lời đúng với câu hỏi?
- **Recall-friendliness**: Kích thích active recall?

---

## Phần 9: Knowledge Graph Schema

### 9.1 Bảng card_links

```sql
CREATE TABLE card_links (
  id uuid PRIMARY KEY,
  source_card_id uuid REFERENCES cards ON DELETE CASCADE,
  target_card_id uuid REFERENCES cards ON DELETE CASCADE,
  link_type varchar(20) DEFAULT 'related',  -- 'related' | 'prerequisite' | 'opposite' | 'example'
  created_at timestamp,
  UNIQUE(source_card_id, target_card_id),   -- Không link trùng
  CHECK(source_card_id != target_card_id)   -- Không self-link
);
```

**Ý nghĩa các link types**:

- `prerequisite`: Phải thuộc card A trước khi học card B
- `related`: Hai khái niệm liên quan, gợi ý đọc thêm
- `opposite`: Trái nghĩa, contrast
- `example`: Card A là ví dụ cụ thể của card B

> ⚠️ **Lưu ý**: Service implementation của Knowledge Graph (3.1.3 — 3.1.7) chưa được implement (chỉ có schema). Đây là Sprint 3.1 trong TODO.

---

## Phần 10: Import/Export

### 10.1 CSV Import

```typescript
// Tự parse CSV thủ công (không dùng library ngoài)
function parseCSV(text: string): string[][] {
  // Hỗ trợ: quoted fields với dấu phẩy bên trong, escaped quotes ("")
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++;
      } // Escaped ""
      else if (ch === '"') inQuotes = false;
      else field += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') {
        row.push(field);
        field = '';
      } else if (ch === '\n') {
        rows.push(row);
        row = [];
        field = '';
      } else field += ch;
    }
  }
}
```

**Mapping CSV columns → template fields**:

```
CSV header: "Front, Back, Notes"
Template fields: Front (id: aaa), Back (id: bbb)

columnToFieldId: [aaa, bbb, null]  ←── "Notes" không match → bỏ qua
```

System sẽ bỏ qua cột không khớp với template, cho phép import CSV từ nhiều nguồn khác nhau.

### 10.2 JSON Export

Export toàn bộ deck (metadata + cards + field values) thành 1 JSON object, tiện cho backup và import lại sau.

---

## Phần 11: Notifications

System kiểm tra định kỳ (frontend poll mỗi `NOTIFICATIONS_POLL_MS` ms) xem deck nào có thẻ đến hạn ôn tập. User thấy badge đỏ ở chuông với số lượng thẻ cần ôn.

Backend query:

```sql
SELECT d.id, d.name, COUNT(sp.id) as due_count
FROM decks d
INNER JOIN cards c ON c.deck_id = d.id
LEFT JOIN study_progress sp ON sp.card_id = c.id AND sp.user_id = $userId
WHERE d.user_id = $userId
  AND (sp.id IS NULL OR sp.next_review_at <= NOW())
GROUP BY d.id
HAVING COUNT(sp.id) > 0
ORDER BY due_count DESC
LIMIT 50;
```

---

## Phần 12: Browser Extension

### 12.1 Architecture (Chrome Manifest V3)

```
manifest.json (Permissions: activeTab, contextMenus, storage, cookies)
├── background.ts (Service Worker)
│   └── Context menu handler + API calls
├── content.ts (Injected scripts)
│   └── Text selection detection
└── popup.html + popup.ts
    └── Login UI + deck selector
```

### 12.2 Flow tạo thẻ từ web

```
User bôi đen text trên web
    │
    ↓
Chrome context menu: "Add to Engram Spira"
    │
    ↓
background.ts: gọi API POST /cards/by-deck/:deckId
    │ (dùng cookie session, same-origin không work
    │  → extension dùng fetch với credentials)
    ↓
Card được tạo trong deck đã chọn
```

---

## Phần 13: Frontend Architecture (SolidJS)

### 13.1 Tại sao SolidJS thay vì React?

SolidJS dùng **fine-grained reactivity** — khi 1 signal thay đổi, chỉ đúng DOM nodes có dùng signal đó được re-render. React re-render toàn bộ component tree (dù có Virtual DOM diffing).

```typescript
// SolidJS signal
const [count, setCount] = createSignal(0);
return <div>{count()}</div>;
// Khi setCount(1): chỉ text node này cập nhật

// React state
const [count, setCount] = useState(0);
return <div>{count}</div>;
// Khi setCount(1): toàn bộ component re-render
```

### 13.2 State Management

Không dùng Redux/Zustand — dùng **module-level signals** (singleton pattern):

```typescript
// stores/auth.store.ts
const [currentUser, setCurrentUser] = createSignal<User | null>(null);
export { currentUser, setCurrentUser };

// Bất kỳ component nào cũng import trực tiếp:
import { currentUser } from '@/stores/auth.store';
```

Các store chính:

- `auth.store.ts` — user hiện tại
- `theme.store.ts` — dark/light/system mode
- `sidebar.store.ts` — sidebar open/close
- `focus.store.ts` — Pomodoro timer state
- `toast.store.ts` — Toast notifications queue

### 13.3 API Client (Eden Treaty)

```typescript
// api/client.ts
import { treaty } from '@elysiajs/eden';
import type { App } from '../../api/src/index';

export const api = treaty<App>('http://localhost:4000', {
  fetch: { credentials: 'include' }, // Cookie tự động đi kèm
});

// Dùng:
const { data, error } = await api.study.deck[deckId].get();
//                              ^^^^^^^^^^^^^^^^^^^^^^^^^^^^
//                              Fully type-safe! IDE auto-complete
//                              Compiler báo lỗi nếu sai kiểu
```

### 13.4 Study Mode UX Flow

```
1. Load due cards từ API (GET /study/deck/:deckId)
2. Hiển thị mặt TRƯỚC của card đầu tiên
3. User nghĩ câu trả lời → Space/Click → Lật sang mặt SAU
4. User chọn 1 trong 4 nút: AGAIN / HARD / GOOD / EASY
5. API call POST /study/review { cardId, action }
6. Chuyển sang card tiếp theo (setCurrentIndex(i + 1))
7. Khi hết cards → Màn hình tóm tắt (stats: again/hard/good/easy count)
```

**Keyboard Shortcuts**:

```typescript
// Space: lật card
// 1: Again, 2: Hard, 3: Good, 4: Easy
const KEYBOARD_SHORTCUTS = {
  FLIP: ' ',
  AGAIN: '1',
  HARD: '2',
  GOOD: '3',
  EASY: '4',
};
```

---

## Phần 14: Security Overview

### 14.1 Các biện pháp bảo mật đã implement

| Mối đe dọa            | Biện pháp                                                                |
| --------------------- | ------------------------------------------------------------------------ |
| **Brute force login** | Rate limit 5 req/phút/IP                                                 |
| **Weak passwords**    | Min 8, max 128 chars                                                     |
| **Password storage**  | Argon2 (memory-hard, không crack được bằng GPU)                          |
| **Session hijacking** | httpOnly cookie (JS không đọc được), SHA-256 hashed session              |
| **Session fixation**  | New token mỗi lần login                                                  |
| **XSS**               | httpOnly cookie + SolidJS JSX auto-escapes                               |
| **CORS**              | Chỉ allow localhost:\* trong dev, disable trong prod                     |
| **SQL Injection**     | Drizzle ORM dùng parameterized queries hoàn toàn                         |
| **User enumeration**  | Forgot-password luôn trả 200 dù email không tồn tại                      |
| **IDOR**              | Mọi query đều JOIN với `userId` — không thể truy cập data của người khác |
| **AI Rate abuse**     | 30 AI requests/hour/user (in-memory)                                     |

### 14.2 Authorization Pattern

**IDOR** (Insecure Direct Object Reference) là lỗ hổng phổ biến: user A gửi request với ID của user B để get/modify data của B.

Engram Spira ngăn chặn bằng cách **luôn filter theo userId**:

```typescript
// Sai (dễ bị IDOR):
const deck = await db.select().from(decks).where(eq(decks.id, deckId));

// Đúng (Engram Spira làm):
const deck = await db
  .select()
  .from(decks)
  .where(
    and(
      eq(decks.id, deckId),
      eq(decks.userId, currentUser.id), // ← LUÔN có điều kiện này
    ),
  );
// Nếu deckId thuộc user khác → trả về empty → NotFoundError
```

---

## Phần 15: Performance Optimizations

### 15.1 Parallel Database Queries

Thay vì sequential (chờ query 1 xong rồi mới chạy query 2):

```typescript
// Parallel — chạy đồng thời, nhanh hơn
const [cards, progress, fieldValues] = await Promise.all([
  db.select().from(cards).where(...),
  db.select().from(studyProgress).where(...),
  db.select().from(cardFieldValues).where(...),
]);
```

### 15.2 Database Indexes

```sql
-- Các index quan trọng nhất:
idx_cards_deck_id              -- cards.deck_id (query all cards of deck)
idx_sp_user_next_review        -- study_progress(user_id, next_review_at)
                               --   ← Critical cho query "thẻ nào đến hạn?"
idx_rl_user_card               -- review_logs(user_id, card_id) ← Analytics
idx_rl_user_reviewed_at        -- review_logs(user_id, reviewed_at) ← Heatmap
idx_ai_jobs_status_created     -- Cleanup expired jobs hiệu quả
```

### 15.3 Denormalized userId trên decks

```sql
-- decks.user_id được lưu trực tiếp (denormalized từ folder → class → user)
-- Tại sao? Để ownership check chỉ cần 1 index lookup:
WHERE decks.id = $deckId AND decks.user_id = $userId
-- Thay vì JOIN chain: deck → folder → class → user (3 JOINs)
```

### 15.4 Batch Upsert

Khi ôn nhiều thẻ cùng lúc (`review-batch`), thay vì N queries riêng lẻ:

```typescript
// N separate INSERTs → chậm
for (const item of items) {
  await db.insert(studyProgress).values(item);
}

// 1 batch INSERT với ON CONFLICT → nhanh
await db
  .insert(studyProgress)
  .values(allItems) // Array of all items
  .onConflictDoUpdate({ set: conflictSet });
```

---

## Phần 16: Error Handling

### 16.1 Custom Error Classes

```typescript
// shared/errors.ts
export class AppError extends Error {
  constructor(
    message: string,
    public statusCode: number,
  ) {
    super(message);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(`${resource} not found`, 404);
  }
}

export class ConflictError extends AppError {
  constructor(msg: string) {
    super(msg, 409);
  }
}

export class UnauthorizedError extends AppError {
  constructor(msg: string) {
    super(msg, 401);
  }
}
```

### 16.2 Global Error Handler

```typescript
// index.ts
app.onError(({ error, set }) => {
  if (error instanceof AppError) {
    set.status = error.statusCode; // 404, 409, 401...
    return { error: error.message };
  }

  console.error('Unhandled error:', error);
  set.status = 500;
  return { error: 'Internal server error' }; // Không lộ stack trace ra ngoài
});
```

### 16.3 Frontend Error Boundary

```tsx
// app.tsx
<ErrorBoundary
  fallback={(err, reset) => <AppErrorBoundary error={err} onReset={reset} />}
>
  <Router>...</Router>
</ErrorBoundary>
```

Ngăn toàn bộ app crash khi một component throw error.

---

## Phần 17: Database Migrations Timeline

| Migration                       | Mô tả                                                                                           |
| ------------------------------- | ----------------------------------------------------------------------------------------------- |
| `0000_sweet_goliath.sql`        | Initial schema: users, sessions, classes, folders, decks, card_templates, cards, study_progress |
| `0001_perf_indexes.sql`         | Thêm performance indexes                                                                        |
| `0002_denorm_deck_user_id.sql`  | Thêm `decks.user_id` (denormalization)                                                          |
| `0003_sm2_progress_columns.sql` | SM-2 columns: boxLevel, easeFactor, intervalDays                                                |
| `0004_daily_study_logs.sql`     | Bảng `study_daily_logs` cho streak/heatmap                                                      |
| `0005_polite_hedge_knight.sql`  | Cleanup & fixes                                                                                 |
| `0006_user_profile_fields.sql`  | `users.displayName`, `users.avatarUrl`                                                          |
| `0007_colorful_maddog.sql`      | Bảng `password_reset_tokens`                                                                    |
| `0008_brief_epoch.sql`          | Bảng `notifications`                                                                            |
| `0009_light_paibok.sql`         | Bảng `feedback`                                                                                 |
| `0010_nebulous_zombie.sql`      | Bảng `ai_generation_jobs`                                                                       |
| `0011_pgvector_embeddings.sql`  | pgvector extension + `card_field_values.embedding vector(768)`                                  |
| `0012_small_scream.sql`         | Bảng `review_logs`                                                                              |
| `0013_flowery_blue_marvel.sql`  | **FSRS Cleanup**: Xóa toàn bộ FSRS columns/tables (đã thử rồi bỏ)                               |
| `0014_gifted_callisto.sql`      | Bảng `card_links` + `card_concepts` (Knowledge Graph schema)                                    |

---

## Phần 18: Shared Package (@engram/shared)

Package `packages/shared/src/index.ts` export các constants/types dùng chung giữa API và Web:

```typescript
export const REVIEW_ACTIONS = { AGAIN: 'again', HARD: 'hard', GOOD: 'good', EASY: 'easy' };
export const FIELD_TYPES = { TEXT: 'text', TEXTAREA: 'textarea', IMAGE_URL: 'image_url', ... };
export const SYSTEM_TEMPLATES = { VOCABULARY: 'Vocabulary', BASIC_QA: 'Basic Q&A' };
export const PASSWORD = { MIN_LENGTH: 8, MAX_LENGTH: 128 };
export const NOTIFICATIONS = { MAX_DUE_DECKS: 50 };
```

**Ý nghĩa**: Nếu bạn đổi `MIN_LENGTH` ở đây, cả backend validation lẫn frontend hint đều tự động cập nhật.

---

## Phần 19: API Endpoints Summary

### Auth (`/auth`)

| Method | Endpoint                | Mô tả             |
| ------ | ----------------------- | ----------------- |
| POST   | `/auth/register`        | Đăng ký           |
| POST   | `/auth/login`           | Đăng nhập         |
| POST   | `/auth/logout`          | Đăng xuất         |
| GET    | `/auth/me`              | Lấy user hiện tại |
| POST   | `/auth/change-password` | Đổi mật khẩu      |
| POST   | `/auth/forgot-password` | Gửi email reset   |
| POST   | `/auth/reset-password`  | Đặt mật khẩu mới  |

### Content Management (`/classes`, `/folders`, `/decks`, `/cards`)

| Method                        | Endpoint                         | Mô tả                           |
| ----------------------------- | -------------------------------- | ------------------------------- |
| GET/POST                      | `/classes`                       | List/Create                     |
| PATCH/DELETE                  | `/classes/:id`                   | Update/Delete                   |
| PATCH                         | `/classes/reorder`               | Sắp xếp lại                     |
| (tương tự cho folders, decks) |                                  |                                 |
| POST                          | `/cards/by-deck/:deckId/batch`   | Tạo nhiều thẻ cùng lúc          |
| PATCH                         | `/cards/by-deck/:deckId/reorder` | Sắp xếp lại thẻ                 |
| PATCH                         | `/decks/:id/move`                | Di chuyển deck sang folder khác |

### Study (`/study`)

| Method | Endpoint                       | Mô tả                               |
| ------ | ------------------------------ | ----------------------------------- |
| GET    | `/study/deck/:deckId`          | Lấy thẻ cần ôn                      |
| GET    | `/study/deck/:deckId/schedule` | Lịch ôn tập tương lai               |
| POST   | `/study/review`                | Ghi kết quả 1 thẻ                   |
| POST   | `/study/review-batch`          | Ghi kết quả nhiều thẻ               |
| GET    | `/study/streak`                | Current/longest streak              |
| GET    | `/study/activity`              | Heatmap data                        |
| GET    | `/study/stats`                 | Tổng thống kê                       |
| POST   | `/study/interleaved`           | Interleaved practice (custom decks) |
| GET    | `/study/interleaved/auto`      | Interleaved practice (auto-select)  |

### AI (`/ai`)

| Method | Endpoint                     | Mô tả                           |
| ------ | ---------------------------- | ------------------------------- |
| POST   | `/ai/generate-cards/preview` | Generate + preview (không save) |
| POST   | `/ai/generate-cards/save`    | Save job cards vào deck         |
| POST   | `/ai/improve-card`           | AI cải thiện 1 card             |
| GET    | `/ai/jobs`                   | Lịch sử generate                |
| GET    | `/ai/jobs/:jobId`            | Chi tiết 1 job                  |
| POST   | `/ai/check-duplicates`       | Phát hiện thẻ trùng lặp         |
| POST   | `/ai/quality-score`          | Chấm điểm chất lượng thẻ        |

### Import/Export (`/import`, `/export`)

| Method | Endpoint              | Mô tả                                 |
| ------ | --------------------- | ------------------------------------- |
| POST   | `/import/csv/:deckId` | Import CSV                            |
| GET    | `/export/:deckId`     | Export CSV/JSON (`?format=csv\|json`) |

---

## Phần 20: Những gì CHƯA implement (Roadmap)

### Sprint 3.1 — Knowledge Graph Service (Ưu tiên cao)

- `card-links.service.ts`: createLink (với cycle detection), getCardLinks, getDeckGraph
- `getPrerequisiteStatus()`: Check xem prerequisite cards có được mastered chưa
- Sửa `getDueCards()`: Filter blocked cards theo prerequisite chains
- Routes: POST/GET/DELETE `/cards/:id/links`, GET `/decks/:id/graph`

### Sprint 3.2 — Knowledge Graph Frontend

- D3-force graph visualization
- Card editor: "Link Cards" UI

### Sprint 3.3 — Forgetting Forecast

- `getForecast()`: Dự đoán thẻ nào sẽ quên trong 7/14/30 ngày
- `getRetentionHeatmap()`: Xác suất nhớ từng thẻ
- Dashboard widget

### Sprint 3.4 — AI Tutor

- `explainCard()`: Giải thích, tạo mnemonic, micro-quiz
- Slide-out panel khi bấm "Again"

### Sprint 3.5 — Shared Deck Marketplace

- Publish deck (snapshot — không FK reference)
- Search, clone, rate

---

## Tổng kết: Những điểm cần nhớ khi onboard

1. **Mọi data đều có `userId` check** — không bao giờ query mà không verify ownership
2. **SM-2 là thuật toán cốt lõi** — 4 action buttons → tính `nextReviewAt` dựa trên ease factor
3. **EAV pattern** cho cards — nội dung không trong `cards` mà trong `card_field_values`
4. **study_progress = current state** (UPSERT) ↔ **review_logs = history** (append-only)
5. **Promise.all ở khắp nơi** — parallel queries để giảm latency
6. **Eden Treaty** cho type-safe API calls — lỗi type được bắt ở compile time
7. **Fire-and-forget** cho embeddings — không blocking user flow
8. **Rate limiting** tất cả auth endpoints và AI endpoints

---

_Nếu có bất kỳ câu hỏi nào, hãy đọc code trực tiếp trong `apps/api/src/modules/` hoặc hỏi team!_
