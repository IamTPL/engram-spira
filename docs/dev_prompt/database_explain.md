# Database Schema — Giải thích chi tiết

> Tài liệu này giải thích toàn bộ cấu trúc database của **Engram Spira** dành cho người mới.
> Đọc từ trên xuống dưới theo thứ tự — mỗi bảng xây trên nền bảng trước đó.

---

## Tổng quan kiến trúc

Trước khi đi vào từng bảng, hãy hình dung cấu trúc dữ liệu như một cái cây:

```
users (người dùng)
└── classes (lớp học / chủ đề lớn, ví dụ: "Tiếng Anh B2")
    └── folders (thư mục con, ví dụ: "Unit 1 - Greetings")
        └── decks (bộ thẻ flash card, ví dụ: "Từ vựng tuần 1")
            └── cards (từng thẻ flash card)
                └── card_field_values (nội dung thực sự của thẻ)

card_templates (khuôn mẫu cho thẻ, ví dụ: "Vocabulary", "Basic Q&A")
└── template_fields (các trường trong khuôn mẫu đó)

study_progress (tiến độ học của mỗi user với từng card)
sessions (phiên đăng nhập)
```

---

## Bảng 1: `users` — Người dùng

```
users
├── id           UUID, khóa chính
├── email        VARCHAR(255), duy nhất
├── password_hash TEXT
└── created_at   TIMESTAMP WITH TIMEZONE
```

### Giải thích từng cột

| Cột             | Kiểu           | Ý nghĩa                                                                                                                              |
| --------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `id`            | `uuid`         | Mã định danh duy nhất của user. Tự động sinh ngẫu nhiên (UUID v4). Không bao giờ trùng, không thể đoán được. Ví dụ: `a1b2c3d4-...`   |
| `email`         | `varchar(255)` | Email đăng nhập. Phải unique — không thể có 2 user cùng email. Tối đa 255 ký tự.                                                     |
| `password_hash` | `text`         | **Không lưu mật khẩu gốc.** Mật khẩu được hash bằng thuật toán Argon2. Nếu database bị lộ, hacker cũng không đọc được mật khẩu thật. |
| `created_at`    | `timestamp`    | Thời điểm tạo tài khoản. `WITH TIMEZONE` = lưu kèm múi giờ UTC để không bị nhầm giờ.                                                 |

### Liên kết

Một `user` có thể có nhiều: `sessions`, `classes`, `card_templates`, `study_progress`.

---

## Bảng 2: `sessions` — Phiên đăng nhập

```
sessions
├── id         TEXT, khóa chính
├── user_id    UUID → tham chiếu users.id
└── expires_at TIMESTAMP WITH TIMEZONE
```

### Giải thích từng cột

| Cột          | Kiểu        | Ý nghĩa                                                                                                                                      |
| ------------ | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`         | `text`      | Token phiên đăng nhập — chuỗi ngẫu nhiên dài (32 bytes, encode hex = 64 ký tự). Cái này được lưu trong **httpOnly cookie** trên trình duyệt. |
| `user_id`    | `uuid`      | User nào đang đăng nhập. Nếu user bị xóa → `CASCADE` xóa hết sessions của họ.                                                                |
| `expires_at` | `timestamp` | Hạn của phiên. Sau thời điểm này, session tự hết hiệu lực (30 ngày).                                                                         |

### Hoạt động như thế nào?

1. User đăng nhập → server tạo 1 row mới trong `sessions`, trả `id` về dưới dạng cookie.
2. Mỗi request tiếp theo, browser gửi cookie → server kiểm tra `sessions` xem `id` có tồn tại và chưa hết hạn không.
3. Nếu hợp lệ → cho qua. Nếu không → báo 401 Unauthorized.

> **Index:** `idx_sessions_user_id` trên cột `user_id` — giúp query "tất cả sessions của user X" nhanh hơn (dùng khi logout tất cả thiết bị).

---

## Bảng 3: `classes` — Lớp học / Chủ đề

```
classes
├── id          UUID, khóa chính
├── user_id     UUID → tham chiếu users.id
├── name        VARCHAR(255)
├── description TEXT
└── created_at  TIMESTAMP WITH TIMEZONE
```

### Giải thích từng cột

| Cột           | Kiểu           | Ý nghĩa                                                                         |
| ------------- | -------------- | ------------------------------------------------------------------------------- |
| `id`          | `uuid`         | ID duy nhất của class                                                           |
| `user_id`     | `uuid`         | Class này thuộc về user nào. Xóa user → xóa toàn bộ classes của họ (`CASCADE`). |
| `name`        | `varchar(255)` | Tên class, ví dụ: `"IELTS Vocabulary"`, `"Medical Terms"`                       |
| `description` | `text`         | Mô tả dài hơn, có thể để null (không bắt buộc nhập).                            |
| `created_at`  | `timestamp`    | Thời điểm tạo.                                                                  |

### Ví dụ thực tế

Một user học tiếng Anh có thể có các classes:

- `"IELTS Preparation"`
- `"Business English"`
- `"Medical Terminology"`

Mỗi class là một "thùng chứa lớn" để nhóm các folder lại.

> **Index:** `idx_classes_user_id` — khi sidebar load danh sách classes của user, query dùng index này để tìm nhanh.

---

## Bảng 4: `folders` — Thư mục

```
folders
├── id         UUID, khóa chính
├── class_id   UUID → tham chiếu classes.id
├── name       VARCHAR(255)
└── created_at TIMESTAMP WITH TIMEZONE
```

### Giải thích từng cột

| Cột          | Kiểu           | Ý nghĩa                                                                            |
| ------------ | -------------- | ---------------------------------------------------------------------------------- |
| `id`         | `uuid`         | ID duy nhất của folder                                                             |
| `class_id`   | `uuid`         | Folder này nằm trong class nào. Xóa class → xóa hết folders bên trong (`CASCADE`). |
| `name`       | `varchar(255)` | Tên folder, ví dụ: `"Week 1"`, `"Animals"`, `"Phrasal Verbs"`                      |
| `created_at` | `timestamp`    | Thời điểm tạo.                                                                     |

### Ví dụ thực tế

Class `"IELTS Preparation"` có các folders:

- `"Reading Vocabulary"`
- `"Writing Collocations"`
- `"Speaking Phrases"`

> **Index:** `idx_folders_class_id` — khi click vào class trong sidebar, query tìm tất cả folders của class đó dùng index này.

---

## Bảng 5: `decks` — Bộ thẻ flash card

```
decks
├── id               UUID, khóa chính
├── folder_id        UUID → tham chiếu folders.id
├── card_template_id UUID → tham chiếu card_templates.id
├── name             VARCHAR(255)
└── created_at       TIMESTAMP WITH TIMEZONE
```

### Giải thích từng cột

| Cột                | Kiểu           | Ý nghĩa                                                                                                                                            |
| ------------------ | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`               | `uuid`         | ID duy nhất của deck                                                                                                                               |
| `folder_id`        | `uuid`         | Deck nằm trong folder nào. Xóa folder → xóa hết decks (`CASCADE`).                                                                                 |
| `card_template_id` | `uuid`         | Deck dùng khuôn mẫu thẻ nào (xem bảng `card_templates` bên dưới). Đây **không** có CASCADE — bạn không thể xóa template nếu còn deck đang dùng nó. |
| `name`             | `varchar(255)` | Tên deck, ví dụ: `"IELTS Academic Word List Part 1"`                                                                                               |
| `created_at`       | `timestamp`    | Thời điểm tạo.                                                                                                                                     |

### Tại sao deck cần biết `card_template_id`?

Mỗi deck phải chọn **1 template** trước khi tạo card. Template quy định thẻ có những field gì (ví dụ: Word, Definition, IPA...). Tất cả card trong cùng 1 deck phải có cùng cấu trúc field.

---

## Bảng 6: `card_templates` — Khuôn mẫu thẻ

```
card_templates
├── id          UUID, khóa chính
├── user_id     UUID → tham chiếu users.id (nullable)
├── name        VARCHAR(255)
├── description TEXT
├── is_system   BOOLEAN
└── created_at  TIMESTAMP WITH TIMEZONE
```

### Giải thích từng cột

| Cột           | Kiểu           | Ý nghĩa                                                                                                                                            |
| ------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`          | `uuid`         | ID duy nhất                                                                                                                                        |
| `user_id`     | `uuid`         | **Nullable.** Nếu `NULL` → đây là template hệ thống (system template), dùng chung cho tất cả user. Nếu có giá trị → template do user đó tạo riêng. |
| `name`        | `varchar(255)` | Tên template, ví dụ: `"Vocabulary"`, `"Basic Q&A"`                                                                                                 |
| `description` | `text`         | Mô tả template.                                                                                                                                    |
| `is_system`   | `boolean`      | `true` = template được seed sẵn khi khởi động app, ai cũng dùng được. `false` = template do user tự tạo.                                           |
| `created_at`  | `timestamp`    | Thời điểm tạo.                                                                                                                                     |

### Templates hệ thống hiện có

Khi chạy `bun run db:seed`, 2 templates được tạo sẵn:

**1. "Vocabulary"** — Dùng cho học từ vựng tiếng Anh:

- Word (front), Type (front), IPA (front), Definition (back), Examples (back)

**2. "Basic Q&A"** — Dùng cho hỏi-đáp đơn giản:

- Question (front), Answer (back)

---

## Bảng 7: `template_fields` — Các trường trong khuôn mẫu

Đây là bảng quan trọng nhất để hiểu hệ thống template linh hoạt.

```
template_fields
├── id          UUID, khóa chính
├── template_id UUID → tham chiếu card_templates.id
├── name        VARCHAR(100)
├── field_type  VARCHAR(50)
├── side        VARCHAR(10)
├── sort_order  INTEGER
├── is_required BOOLEAN
└── config      JSONB
```

### Giải thích từng cột

| Cột           | Kiểu           | Ý nghĩa                                                                        |
| ------------- | -------------- | ------------------------------------------------------------------------------ |
| `id`          | `uuid`         | ID duy nhất của field                                                          |
| `template_id` | `uuid`         | Field này thuộc template nào. Xóa template → xóa hết fields (`CASCADE`).       |
| `name`        | `varchar(100)` | Tên field, ví dụ: `"word"`, `"definition"`, `"ipa"`, `"examples"`              |
| `field_type`  | `varchar(50)`  | Kiểu dữ liệu của field (xem bảng bên dưới)                                     |
| `side`        | `varchar(10)`  | `"front"` hoặc `"back"` — field này hiện ở mặt trước hay mặt sau của thẻ       |
| `sort_order`  | `integer`      | Thứ tự hiển thị. Field có `sort_order = 1` hiện trước field `sort_order = 2`   |
| `is_required` | `boolean`      | `true` = bắt buộc nhập khi tạo card. `false` = có thể bỏ trống.                |
| `config`      | `jsonb`        | Cấu hình thêm, linh hoạt. Ví dụ: `{ "placeholder": "/wɜːrd/", "maxItems": 5 }` |

### Giá trị `field_type` có thể có

| Giá trị      | Ý nghĩa                   | Ví dụ                  |
| ------------ | ------------------------- | ---------------------- |
| `text`       | Văn bản ngắn, 1 dòng      | Từ vựng, IPA, loại từ  |
| `textarea`   | Văn bản dài, nhiều dòng   | Định nghĩa, giải thích |
| `json_array` | Mảng chuỗi, nhiều giá trị | Danh sách câu ví dụ    |
| `image_url`  | URL hình ảnh              | Link ảnh minh họa      |
| `audio_url`  | URL âm thanh              | Link file phát âm      |

### Ràng buộc Unique

`(template_id, name)` phải **unique** — không thể có 2 field cùng tên trong 1 template.
Ví dụ: Template "Vocabulary" không thể có 2 field tên `"word"`.

### Ví dụ thực tế — Template "Vocabulary" có 5 fields:

```
template_fields cho template "Vocabulary":
┌────────────┬────────────┬──────────┬──────────────┬────────┬────────────┐
│ name       │ field_type │ side     │ sort_order   │ req    │ config     │
├────────────┼────────────┼──────────┼──────────────┼────────┼────────────┤
│ word       │ text       │ front    │ 1            │ true   │ {placeholder: "Enter the word"} │
│ type       │ text       │ front    │ 2            │ false  │ {placeholder: "noun, verb..."} │
│ ipa        │ text       │ front    │ 3            │ false  │ {placeholder: "/wɜːrd/"} │
│ definition │ textarea   │ back     │ 1            │ true   │ {placeholder: "Enter the definition"} │
│ examples   │ json_array │ back     │ 2            │ false  │ {maxItems: 5, placeholder: "..."} │
└────────────┴────────────┴──────────┴──────────────┴────────┴────────────┘
```

---

## Bảng 8: `cards` — Thẻ flash card

```
cards
├── id         UUID, khóa chính
├── deck_id    UUID → tham chiếu decks.id
├── sort_order INTEGER
└── created_at TIMESTAMP WITH TIMEZONE
```

### Giải thích từng cột

| Cột          | Kiểu        | Ý nghĩa                                                                                      |
| ------------ | ----------- | -------------------------------------------------------------------------------------------- |
| `id`         | `uuid`      | ID duy nhất của card                                                                         |
| `deck_id`    | `uuid`      | Card này thuộc deck nào. Xóa deck → xóa hết cards (`CASCADE`).                               |
| `sort_order` | `integer`   | Thứ tự hiển thị trong deck. Card mới nhất có `sort_order` cao nhất (auto-increment khi tạo). |
| `created_at` | `timestamp` | Thời điểm tạo.                                                                               |

### Tại sao `cards` không có field `word`, `definition`... ở đây?

Vì nội dung thực sự được lưu **tách biệt** trong bảng `card_field_values`. Lý do: mỗi deck có template khác nhau, số lượng field khác nhau. Nếu lưu tất cả vào `cards` thì phải có hàng chục cột `field1`, `field2`... rất cứng nhắc và lãng phí.

---

## Bảng 9: `card_field_values` — Nội dung của thẻ

Đây là nơi lưu **dữ liệu thực sự** của mỗi thẻ flash card.

```
card_field_values
├── id                UUID, khóa chính
├── card_id           UUID → tham chiếu cards.id
├── template_field_id UUID → tham chiếu template_fields.id
└── value             JSONB
```

### Giải thích từng cột

| Cột                 | Kiểu    | Ý nghĩa                                                                                                                                                         |
| ------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                | `uuid`  | ID duy nhất                                                                                                                                                     |
| `card_id`           | `uuid`  | Giá trị này thuộc card nào. Xóa card → xóa hết field values (`CASCADE`).                                                                                        |
| `template_field_id` | `uuid`  | Giá trị này điền vào field nào của template. Xóa template field → xóa hết values của field đó (`CASCADE`).                                                      |
| `value`             | `jsonb` | Giá trị thực sự. Dùng `jsonb` vì linh hoạt: có thể là `"hello"` (text), `"a greeting"` (textarea), hoặc `["I have a hot day", "It is hot today"]` (json_array). |

### Ràng buộc Unique

`(card_id, template_field_id)` phải **unique** — mỗi card chỉ có 1 giá trị cho mỗi field. Không thể có 2 row cùng là giá trị của field `"word"` cho cùng 1 card.

### Ví dụ thực tế

Card từ "Hot" trong deck "Vocabulary" sẽ có các rows:

```
card_field_values:
┌──────────────┬──────────────────────┬──────────────────────────────────┐
│ card_id      │ template_field_id    │ value                            │
├──────────────┼──────────────────────┼──────────────────────────────────┤
│ card-uuid-1  │ field-word-uuid      │ "Hot"                            │
│ card-uuid-1  │ field-type-uuid      │ "adj"                            │
│ card-uuid-1  │ field-ipa-uuid       │ "/hɒt/"                          │
│ card-uuid-1  │ field-definition-uuid│ "Having a high temperature"      │
│ card-uuid-1  │ field-examples-uuid  │ ["It is a hot day", "Hot coffee"] │
└──────────────┴──────────────────────┴──────────────────────────────────┘
```

### Chuỗi JOIN để lấy 1 card đầy đủ

```sql
SELECT
  c.id as card_id,
  tf.name as field_name,
  tf.field_type,
  tf.side,
  cfv.value
FROM cards c
JOIN card_field_values cfv ON cfv.card_id = c.id
JOIN template_fields tf ON cfv.template_field_id = tf.id
WHERE c.id = 'card-uuid-1'
ORDER BY tf.sort_order;
```

---

## Bảng 10: `study_progress` — Tiến độ học SRS

Đây là "trái tim" của hệ thống học thẻ thông minh (Spaced Repetition System).

```
study_progress
├── id              UUID, khóa chính
├── user_id         UUID → tham chiếu users.id
├── card_id         UUID → tham chiếu cards.id
├── box_level       INTEGER
├── next_review_at  TIMESTAMP WITH TIMEZONE
└── last_reviewed_at TIMESTAMP WITH TIMEZONE (nullable)
```

### Giải thích từng cột

| Cột                | Kiểu        | Ý nghĩa                                                                                                                      |
| ------------------ | ----------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `id`               | `uuid`      | ID duy nhất                                                                                                                  |
| `user_id`          | `uuid`      | Tiến độ của user nào. Xóa user → xóa hết (`CASCADE`).                                                                        |
| `card_id`          | `uuid`      | Tiến độ với card nào. Xóa card → xóa hết (`CASCADE`).                                                                        |
| `box_level`        | `integer`   | Mức thuộc bài hiện tại (0 → 5+). Càng cao = càng thuộc, ôn lại càng thưa.                                                    |
| `next_review_at`   | `timestamp` | **Thời điểm tiếp theo cần ôn card này.** Đây là cột quan trọng nhất — server query cột này để biết hôm nay cần học card nào. |
| `last_reviewed_at` | `timestamp` | Lần cuối xem card này. Nullable vì card mới chưa học lần nào.                                                                |

### Ràng buộc Unique và Index

- `(user_id, card_id)` phải **unique** — mỗi cặp (user, card) chỉ có 1 row tiến độ. Dùng `INSERT ... ON CONFLICT DO UPDATE` để upsert.
- `idx_sp_user_next_review` trên `(user_id, next_review_at)` — **index quan trọng nhất**. Mỗi lần mở Study, server query: _"Tất cả cards của user X có `next_review_at <= NOW()`"_ — index này làm query này cực kỳ nhanh, dù có hàng triệu rows.

### Hệ thống SRS — box_level hoạt động thế nào?

Khi user đánh giá 1 card, `box_level` và `next_review_at` được tính lại:

| Hành động        | Kết quả `box_level` | Ôn lại sau     |
| ---------------- | ------------------- | -------------- |
| **Again** (quên) | Reset về 0          | 10 phút        |
| **Hard** (khó)   | Giữ nguyên          | 1 ngày         |
| **Good** (thuộc) | +1                  | Theo bảng dưới |

**Lịch ôn theo `box_level` sau khi nhấn Good:**

| `box_level` mới | Ôn lại sau        |
| --------------- | ----------------- |
| 1               | 1 ngày            |
| 2               | 3 ngày            |
| 3               | 7 ngày (1 tuần)   |
| 4               | 14 ngày (2 tuần)  |
| 5+              | 30 ngày (1 tháng) |

### Ví dụ timeline học từ "Hot"

```
Ngày 1  → Học lần đầu (chưa có row trong study_progress)
         → Nhấn Good → box_level=1, next_review_at = Ngày 2

Ngày 2  → Ôn lại → Nhấn Good → box_level=2, next_review_at = Ngày 5

Ngày 5  → Ôn lại → Nhấn Hard → box_level=2 (giữ), next_review_at = Ngày 6

Ngày 6  → Ôn lại → Nhấn Good → box_level=3, next_review_at = Ngày 13

Ngày 13 → Ôn lại → Nhấn Good → box_level=4, next_review_at = Ngày 27
...
```

---

## Sơ đồ quan hệ tổng quát (ERD)

```
users ──────────────────────────────────────────────────────────────┐
  │                                                                  │
  ├──< sessions                                                     │
  │                                                                  │
  ├──< classes                                                       │
  │       └──< folders                                               │
  │               └──< decks ──────────────── card_templates         │
  │                       └──< cards               └──< template_fields
  │                               ├──< card_field_values ─────────────┘
  │                               │
  └──< study_progress ────────────┘
```

**Chú thích:** `──<` nghĩa là "một-nhiều" (one-to-many)

---

## Tóm tắt: Luồng tạo 1 thẻ flash card mới

1. **User đăng nhập** → server tạo row trong `sessions`
2. **User tạo class** "IELTS" → row mới trong `classes`
3. **User tạo folder** "Week 1" trong class → row mới trong `folders`
4. **User tạo deck** "Vocabulary Week 1", chọn template "Vocabulary" → row mới trong `decks`
5. **User thêm card** "Hot":
   - Tạo row trong `cards` (chỉ có `deck_id`, `sort_order`)
   - Tạo 5 rows trong `card_field_values` (word="Hot", type="adj", ipa="/hɒt/", definition="...", examples=[...])
6. **User học** card "Hot" lần đầu → server tạo/update row trong `study_progress` với `next_review_at` = ngày mai
7. **Ngày mai**, khi user mở Study → server query `study_progress` tìm cards có `next_review_at <= NOW()` → trả về card "Hot" để ôn lại

---

## Câu hỏi thường gặp

**Q: Tại sao dùng UUID thay vì số nguyên tự tăng (1, 2, 3...)?**

> UUID được tạo ngẫu nhiên → không thể đoán được ID tiếp theo → an toàn hơn khi expose ra API. Với số nguyên, hacker có thể thử `/api/cards/1`, `/api/cards/2`... Với UUID, không thể đoán.

**Q: `jsonb` trong `card_field_values.value` là gì?**

> `jsonb` = JSON Binary — PostgreSQL lưu JSON dưới dạng nhị phân, tối ưu để query và index. Khác với `json` (lưu text thuần), `jsonb` nhanh hơn khi đọc và cho phép index trên các key bên trong.

**Q: Tại sao `study_progress` không nằm trong `cards` luôn?**

> Vì tiến độ phụ thuộc vào **cả user lẫn card**. 2 user khác nhau học cùng 1 card sẽ có tiến độ khác nhau. Nếu lưu trong `cards`, không thể phân biệt được.

**Q: CASCADE là gì?**

> Khi xóa 1 row, database tự động xóa tất cả rows con phụ thuộc vào nó. Ví dụ: xóa `class` → tự xóa tất cả `folders` → tự xóa tất cả `decks` → tự xóa tất cả `cards` → tự xóa tất cả `card_field_values` và `study_progress`. Không cần viết code xóa thủ công từng bảng.
