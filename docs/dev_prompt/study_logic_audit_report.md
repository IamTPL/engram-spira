# BÁO CÁO AUDIT: Study Logic & SRS Algorithm

**Phiên bản:** 1.0  
**Ngày:** 2025-01-XX  
**Phạm vi:** Toàn bộ luồng study — từ tạo card → API → SRS engine → frontend hiển thị

---

## MỤC LỤC

1. [Tổng quan luồng Study hiện tại](#1-tổng-quan-luồng-study-hiện-tại)
2. [Chi tiết thuật toán SM-2](#2-chi-tiết-thuật-toán-sm-2)
3. [Chi tiết thuật toán FSRS](#3-chi-tiết-thuật-toán-fsrs)
4. [Bug phát hiện: Card mới không hiển thị](#4-bug-phát-hiện-card-mới-không-hiển-thị)
5. [Bug: Không thể reset thời gian due](#5-bug-không-thể-reset-thời-gian-due)
6. [Các bug khác trong thuật toán](#6-các-bug-khác-trong-thuật-toán)
7. [Tóm tắt & Khuyến nghị sửa lỗi](#7-tóm-tắt--khuyến-nghị-sửa-lỗi)

---

## 1. Tổng quan luồng Study hiện tại

### 1.1. Data Flow — Từ tạo card đến hiển thị study

```text
[User tạo card]
      │
      ▼
cards.service.ts → create()
  ├── INSERT INTO cards (deckId, sortOrder)
  ├── INSERT INTO card_field_values (cardId, templateFieldId, value)
  └── Fire-and-forget: embedCardFields(card.id)   ← AI embedding (không ảnh hưởng study)
  ⚠️  KHÔNG tạo study_progress row → Card là "new card"
      │
      ▼
[User vào Study Mode]
      │
      ▼
study-mode.tsx → createResource()
  └── api.study.deck[deckId].get({ query: {} })
      │
      ▼
study.routes.ts → GET /study/deck/:deckId
  └── studyService.getDueCards(deckId, userId, false)
      │
      ▼
study.service.ts → getDueCards()
  ├── verifyDeckOwnership(deckId, userId)
  ├── COUNT(*) FROM cards WHERE deck_id = deckId            → total
  ├── SELECT cards.id FROM cards
  │     LEFT JOIN study_progress
  │       ON (card_id = cards.id AND user_id = userId)
  │     WHERE deck_id = deckId
  │       AND (study_progress.id IS NULL                     ← Card mới (chưa review)
  │            OR next_review_at <= NOW())                   ← Card đã due
  │   → dueRows
  └── enrichCards(dueRows.ids, userId)                      → Kèm field values + progress
      │
      ▼
[Frontend hiển thị Flashcard]
  - currentCard() = studyData().cards[currentIndex]
  - Flip card → show answer → chọn rating (Again/Hard/Good/Easy)
      │
      ▼
[User review card]
      │
      ▼
study.service.ts → reviewCard()
  ├── Verify card ownership
  ├── Fetch existing study_progress (if any)
  ├── Check if user uses SM-2 or FSRS
  ├── SM-2: calculateNextReview(action, currentState) → nextReviewAt, boxLevel, easeFactor
  │   FSRS: calculateNextReviewFsrs(action, progress, scheduler) → nextReviewAt, stability, difficulty
  ├── UPSERT study_progress (INSERT or UPDATE on conflict)
  ├── INSERT review_logs (for analytics)
  └── upsertDailyLog (streak tracking)
```

### 1.2. Card States

| State       | Điều kiện                                | Hiển thị trong Study?   |
| ----------- | ---------------------------------------- | ----------------------- |
| **New**     | Không có `study_progress` row            | ✅ Có (isNull check)    |
| **Due**     | `study_progress.next_review_at <= NOW()` | ✅ Có                   |
| **Not Due** | `study_progress.next_review_at > NOW()`  | ❌ Không (chưa đến lúc) |

### 1.3. Hai chế độ Study

- **`mode = 'due'`** (mặc định): Chỉ hiện card new + card đã due
- **`mode = 'all'`** (Review All): Hiện TẤT CẢ card trong deck, bất kể schedule

---

## 2. Chi tiết thuật toán SM-2

**File:** `apps/api/src/modules/study/srs.engine.ts`

SM-2 (SuperMemo 2) là thuật toán spaced repetition thích ứng. Khác với Leitner Box (interval cố định), SM-2 tính interval dựa trên **ease factor** riêng cho từng card.

### 2.1. Công thức core

```text
interval(n+1) = interval(n) × easeFactor
```

### 2.2. Hành vi theo từng action

| Action    | boxLevel          | easeFactor          | intervalDays                                   | nextReviewAt               |
| --------- | ----------------- | ------------------- | ---------------------------------------------- | -------------------------- |
| **Again** | Reset → 0         | ef - 0.2 (min 1.3)  | 1                                              | **NOW** (due ngay lập tức) |
| **Hard**  | **Giữ nguyên** ⚠️ | ef - 0.15 (min 1.3) | reps≤1 ? 1d : max(interval+1, interval×1.2)    | now + interval             |
| **Good**  | reps + 1          | Không đổi           | reps=1→1d, reps=2→6d, else→interval×ef         | now + interval             |
| **Easy**  | reps + 1          | ef + 0.15           | reps=1→1d, reps=2→6d×1.3, else→interval×ef×1.3 | now + interval             |

### 2.3. Ví dụ progression cho card "Good" liên tục (ef = 2.5)

| Lần review | boxLevel | intervalDays | nextReviewAt |
| ---------- | -------- | ------------ | ------------ |
| 1st Good   | 1        | 1 day        | Ngày mai     |
| 2nd Good   | 2        | 6 days       | +6 ngày      |
| 3rd Good   | 3        | 15 days      | +15 ngày     |
| 4th Good   | 4        | 38 days      | +38 ngày     |
| 5th Good   | 5        | 94 days      | +94 ngày     |

### 2.4. Constants (từ `shared/constants.ts`)

```text
DEFAULT_EASE_FACTOR: 2.5    // Starting multiplier
MIN_EASE_FACTOR: 1.3        // Floor cho card khó nhất
AGAIN_EF_DELTA: -0.2        // Penalty khi quên
HARD_EF_DELTA: -0.15        // Penalty khi khó
EASY_EF_DELTA: +0.15        // Bonus khi dễ
EASY_INTERVAL_BONUS: 1.3    // Extra multiplier cho Easy
FIRST_INTERVAL_DAYS: 1      // Interval cho lần review 1
SECOND_INTERVAL_DAYS: 6     // Interval cho lần review 2
AGAIN_RELEARN_MINUTES: 10   // ⚠️ KHÔNG ĐƯỢC SỬ DỤNG
```

---

## 3. Chi tiết thuật toán FSRS

**File:** `apps/api/src/modules/study/fsrs.engine.ts`

FSRS (Free Spaced Repetition Scheduler) là thuật toán thế hệ mới, dùng mô hình toán học phức tạp hơn SM-2. User opt-in bằng cách enable qua settings.

### 3.1. Khác biệt so với SM-2

| Tiêu chí          | SM-2                | FSRS                                      |
| ----------------- | ------------------- | ----------------------------------------- |
| Cá nhân hóa       | easeFactor per card | stability + difficulty + weights per user |
| Dự đoán retention | Không               | R = (1 + t/(9×S))^(-1)                    |
| Training          | Không               | Có thể train weights từ review history    |
| State machine     | boxLevel/interval   | New → Learning → Review → Relearning      |
| Library           | Custom code         | ts-fsrs (battle-tested)                   |

### 3.2. Flow

1. Nếu user có row trong `fsrs_user_params` → dùng FSRS
2. Nếu không → dùng SM-2 (mặc định)
3. FSRS tính toán thông qua `ts-fsrs` library, map:
   - `again → Rating.Again`, `hard → Rating.Hard`, `good → Rating.Good`, `easy → Rating.Easy`
4. Kết quả lưu vào `study_progress` FSRS columns: `stability`, `difficulty`, `fsrs_state`, `last_elapsed_days`

---

## 4. Bug phát hiện: Card mới không hiển thị

### 4.1. Phân tích gốc rễ

Sau khi audit toàn bộ code, **SQL query cho getDueCards() là ĐÚNG**:

```sql
SELECT cards.id FROM cards
LEFT JOIN study_progress
  ON (study_progress.card_id = cards.id AND study_progress.user_id = $userId)
WHERE cards.deck_id = $deckId
  AND (study_progress.id IS NULL        -- ← Bắt card mới (không có study_progress)
       OR study_progress.next_review_at <= NOW())  -- ← Bắt card đã due
ORDER BY cards.sort_order
```

**Logic này chính xác.** Card mới (không có `study_progress` row) → LEFT JOIN trả NULL cho tất cả cột study_progress → `study_progress.id IS NULL` = true → card PHẢI xuất hiện.

### 4.2. Nguyên nhân có thể (theo thứ tự khả năng cao nhất)

#### Khả năng 1: 🔴 Eden Treaty trả `data: null` khi có lỗi (KHẢ NĂNG CAO NHẤT)

Trong `study-mode.tsx`:

```ts
const { data } = await (api.study.deck as any)[deckId].get({ query: {} });
return data as { cards: [...], total: number, due: number };
```

Eden Treaty trả về `{ data, error, status }`. Nếu API trả lỗi (401, 404, 500), thì `data = null`. Frontend KHÔNG kiểm tra `error` → `studyData()` = `null` → hiện "All caught up!".

**Cách xác nhận:** Mở DevTools (F12) → Network tab → check response từ `GET /study/deck/:deckId`. Nếu status ≠ 200 hoặc response body có error → đây là nguyên nhân.

#### Khả năng 2: 🟡 `embedCardFields()` throw crash ảnh hưởng response

Trong `cards.service.ts`:

```ts
embedCardFields(card.id).catch(() => {}); // Fire-and-forget
return card;
```

Đây là fire-and-forget, nên KHÔNG ảnh hưởng card creation response. **Nhưng** nếu `embedCardFields` gọi API Gemini mà Gemini key không hợp lệ → nó fail silently, embedding không được tạo. Card vẫn tồn tại. **Không phải nguyên nhân.**

#### Khả năng 3: 🟡 Card được tạo ở deck khác

Nếu user tạo card rồi navigate sang study mode của deck khác → card mới không xuất hiện. **Ít khả năng** vì UX flow: deck-view → add card → click Study → cùng deckId.

#### Khả năng 4: 🟢 Timing/caching issue trong SolidJS

SolidJS `createResource` chạy 1 lần dựa trên signal source. Nếu user navigate đến study mode, quay lại thêm card, rồi bấm forward → resource KHÔNG refetch vì deckId không đổi. **Ít khả năng** nếu user navigate fresh.

### 4.3. Fix đề xuất

```ts
// study-mode.tsx — Thêm error handling cho API call
const [studyData, { refetch }] = createResource(
  () => ({ deckId: params.deckId, mode: studyMode() }),
  async ({ deckId, mode }) => {
    const { data, error } = await (api.study.deck as any)[deckId].get({
      query: mode === 'all' ? { mode: 'all' } : {},
    });
    if (error) {
      console.error('Study API error:', error);
      // Optionally show toast
    }
    return data as { cards: [...], total: number, due: number } | null;
  },
);
```

**Và thêm error state trong UI:**

```tsx
<Show when={studyData.error}>
  <p class="text-destructive">Failed to load cards. Please try again.</p>
</Show>
```

---

## 5. Bug: Không thể reset thời gian due

### 5.1. Hiện trạng

**Không có chức năng reset.** Một khi card đã được review, `study_progress` row tồn tại vĩnh viễn với `nextReviewAt` được tính bởi SM-2/FSRS. Không có API endpoint nào cho phép:

- Reset `study_progress` về trạng thái ban đầu
- Xóa `study_progress` row (biến card thành "new" lại)
- Thay đổi `nextReviewAt` thủ công

### 5.2. Hệ quả

Nếu user vô tình bấm "Easy" cho card khó → interval tăng rất nhanh → card không xuất hiện trong nhiều ngày. User không có cách nào sửa lại.

### 5.3. Fix đề xuất

Thêm endpoint `POST /study/deck/:deckId/reset`:

```ts
// study.service.ts
export async function resetDeckProgress(deckId: string, userId: string) {
  await verifyDeckOwnership(deckId, userId);
  const cardIds = await db
    .select({ id: cards.id })
    .from(cards)
    .where(eq(cards.deckId, deckId));
  if (cardIds.length === 0) return { reset: 0 };

  const result = await db.delete(studyProgress).where(
    and(
      eq(studyProgress.userId, userId),
      inArray(
        studyProgress.cardId,
        cardIds.map((c) => c.id),
      ),
    ),
  );
  return { reset: cardIds.length };
}
```

Và endpoint reset single card: `POST /study/card/:cardId/reset`

---

## 6. Các bug khác trong thuật toán

### 🔴 Bug 1: SM-2 "Hard" giữ boxLevel = 0 → card stuck ở 1-day interval

**File:** `srs.engine.ts`, case `'hard'`

```ts
case 'hard': {
  return {
    boxLevel: reps,          // ← Giữ nguyên! Nếu reps=0, mãi mãi = 0
    intervalDays: reps <= 1
      ? SM2.FIRST_INTERVAL_DAYS   // = 1 day
      : Math.max(interval + 1, Math.round(interval * 1.2)),
  };
}
```

**Vấn đề:** Nếu card mới (reps=0) bị đánh "Hard" nhiều lần:

- Lần 1: boxLevel=0, interval=1d
- Lần 2: boxLevel=0, interval=1d (vì reps=0 ≤ 1 → FIRST_INTERVAL_DAYS)
- Lần 3: boxLevel=0, interval=1d
- **Lặp vô hạn!**

**Fix:** boxLevel nên tăng lên ít nhất 1 khi "Hard":

```ts
case 'hard': {
  const newReps = reps <= 0 ? 1 : reps;  // Ít nhất tốt nghiệp khỏi "new"
  const newInterval = newReps <= 1
    ? SM2.FIRST_INTERVAL_DAYS
    : Math.max(interval + 1, Math.round(interval * 1.2));
  return {
    boxLevel: newReps,
    ...
  };
}
```

### 🟡 Bug 2: `AGAIN_RELEARN_MINUTES: 10` không được sử dụng

**File:** `shared/constants.ts` (dòng 30) vs `srs.engine.ts` (case 'again')

```ts
// constants.ts
AGAIN_RELEARN_MINUTES: 10,  // Định nghĩa: đợi 10 phút

// srs.engine.ts
case 'again': {
  return {
    intervalDays: 1,
    nextReviewAt: now,  // ← Due NGAY LẬP TỨC, không phải 10 phút
  };
}
```

**Hệ quả:** Card bấm "Again" xuất hiện ngay trong session, không có khoảng nghỉ. Điều này có thể chấp nhận được (Anki cũng cho option "again = show immediately"), nhưng constant bị bỏ phí.

### 🟡 Bug 3: intervalDays: 1 mâu thuẫn với nextReviewAt: now (case 'again')

```ts
intervalDays: 1,       // ← Nói "1 ngày"
nextReviewAt: now,     // ← Nhưng due "ngay lập tức"
```

`intervalDays` được dùng để hiển thị schedule info. Giá trị `1` gây hiểu nhầm khi card thực ra due ngay lập tức.

**Fix:**

```ts
intervalDays: 0,       // Hoặc dùng AGAIN_RELEARN_MINUTES
nextReviewAt: now,
```

### 🟢 Bug 4: getDeckSchedule "learnedCards" đếm cả card "Again" (boxLevel=0)

**File:** `study.service.ts`, `getDeckSchedule()`

```ts
const learnedCards = progress.length; // Bất kỳ card nào có study_progress row
```

Card bị đánh "Again" (boxLevel=0) vẫn được coi là "learned". Khái niệm "learned" nên chỉ tính card đã tốt nghiệp (boxLevel ≥ 1).

**Fix:**

```ts
const learnedCards = progress.filter((p) => p.boxLevel > 0).length;
```

### 🟢 Bug 5: Không có "Easy" button trong UI

**File:** `study-mode.tsx`, `StudyControls` component

Frontend chỉ hiện 3 button: Again, Hard, Good. SM-2 hỗ trợ 4 actions (thêm Easy). User không thể chọn "Easy" → không bao giờ nhận bonus ef + interval.

**Fix:** Thêm Easy button vào StudyControls component.

---

## 7. Tóm tắt & Khuyến nghị sửa lỗi

### Bảng tổng hợp bugs

| #   | Mức độ      | Mô tả                                                                          | File                              | Fix complexity |
| --- | ----------- | ------------------------------------------------------------------------------ | --------------------------------- | -------------- |
| 1   | 🔴 Critical | Card mới có thể không hiển thị (trả null khi API lỗi, không có error handling) | study-mode.tsx                    | Thấp           |
| 2   | 🔴 Critical | SM-2 "Hard" giữ boxLevel=0 mãi mãi → card stuck 1-day                          | srs.engine.ts                     | Thấp           |
| 3   | 🔴 Critical | Không có chức năng reset progress                                              | study.service.ts, study.routes.ts | Trung bình     |
| 4   | 🟡 Medium   | AGAIN_RELEARN_MINUTES không được sử dụng                                       | srs.engine.ts                     | Thấp           |
| 5   | 🟡 Medium   | intervalDays: 1 mâu thuẫn nextReviewAt: now                                    | srs.engine.ts                     | Thấp           |
| 6   | 🟢 Low      | "learnedCards" đếm cả card boxLevel=0                                          | study.service.ts                  | Thấp           |
| 7   | 🟢 Low      | Thiếu "Easy" button trong UI                                                   | study-mode.tsx                    | Thấp           |

### Thứ tự ưu tiên sửa

1. **Fix Bug #1**: Thêm error handling cho Eden Treaty response trong study-mode.tsx + log lỗi
2. **Fix Bug #2**: SM-2 "Hard" phải tăng boxLevel ít nhất lên 1
3. **Fix Bug #3**: Thêm reset deck/card progress API endpoint
4. **Fix Bug #4-5**: Sử dụng AGAIN_RELEARN_MINUTES, sửa intervalDays
5. **Fix Bug #6-7**: UI improvements

### Debug Steps nếu bug #1 vẫn xảy ra

1. Mở DevTools → Network tab
2. Navigate to Study mode
3. Check request `GET /study/deck/:deckId` response:
   - Status 200? → Check response body: `{ cards: [...], total: N, due: N }`
   - Status 404/401/500? → API error → check server logs
4. Check response `cards` array có chứa card mới không
5. Nếu response không có card mới → check DB: `SELECT * FROM cards WHERE deck_id = '...'`
6. Nếu DB có card nhưng API không trả → check `study_progress` xem có row với future nextReviewAt không
