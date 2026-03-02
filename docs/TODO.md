# Engram Spira — Project TODO & Planning

> **Cập nhật:** 02 March 2026  
> **Trạng thái tổng quan:** Backend hoàn chỉnh ~100%. Frontend ~65%.

---

## Tổng quan trạng thái hiện tại

### ✅ ĐÃ HOÀN THÀNH

#### Backend (`apps/api`) — 100%

- [x] Database schema đầy đủ (10 bảng): `users`, `sessions`, `classes`, `folders`, `decks`, `card_templates`, `template_fields`, `cards`, `card_field_values`, `study_progress`
- [x] Migrations SQL (`0000_sweet_goliath.sql`)
- [x] Auth: `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`
- [x] `requireAuth` middleware (session cookie validation)
- [x] CRUD Classes: GET list, POST create, GET by id, PATCH update, DELETE
- [x] CRUD Folders: GET by-class, POST create, GET by id, PATCH, DELETE
- [x] CRUD Decks: GET by-folder, POST create, GET by id, PATCH, DELETE
- [x] CRUD Card Templates: GET list (system + user), GET by id (with fields), POST create
- [x] CRUD Cards: GET by-deck (with field values), POST create, PATCH update, DELETE
- [x] SRS Engine (`srs.engine.ts`): Leitner system — Again/Hard/Good với intervals đúng spec
- [x] Study routes: `GET /study/deck/:deckId`, `POST /study/review`
- [x] Error handling toàn app (`AppError` hierarchy: 401/403/404/409/422)
- [x] ENV validation (`DATABASE_URL` required)
- [x] DB connection pooling (`postgres.js`)
- [x] AOT enabled cho Elysia
- [x] Seed script: system templates (Vocabulary, Basic Q&A) + test user
- [x] File `.env` với `DATABASE_URL` đúng

#### Frontend (`apps/web`) — Routing & Auth

- [x] App routing (`@solidjs/router`) với `ProtectedRoute` và `GuestRoute`
- [x] Auth store (`currentUser`, `isLoading`, `login`, `register`, `logout`, `fetchCurrentUser`)
- [x] Eden Treaty client (`api = treaty<App>('http://localhost:3001')`)
- [x] Login page: form email/password, error display, redirect sau login
- [x] Register page: form email/password/confirmPassword, validation, redirect

#### Frontend — UI Components

- [x] `Button` (multiple variants: default, destructive, outline, ghost, icon sizes)
- [x] `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter`
- [x] `Input`
- [x] `Textarea`

#### Frontend — Study Feature (hoàn chỉnh)

- [x] Study Mode page (`/study/:deckId`)
- [x] `Flashcard` component: 3D CSS flip animation (`rotateY(180deg)`, `preserve-3d`, `backface-visibility`)
- [x] Front fields render: word (large bold), type (italic), ipa (muted), generic fields
- [x] Back fields render: định nghĩa, `json_array` render as bulleted list
- [x] `StudyControls` component: Again / Hard / Good buttons có keyboard hint
- [x] Keyboard shortcuts: `Space` (flip), `1` (Again), `2` (Hard), `3` (Good)
- [x] Progress bar (currentIndex / due)
- [x] Session Complete screen (CheckCircle icon + Back button)
- [x] Loading state

#### Frontend — Deck View (một phần)

- [x] Fetch deck info + template + cards
- [x] Hiển thị danh sách cards với field values
- [x] Add card form: dynamic fields theo template (text/textarea)
- [x] Delete card
- [x] Navigate to study mode

#### Frontend — Dashboard & Layout (một phần)

- [x] Dashboard layout: Header + Sidebar + main area
- [x] Sidebar: lazy-load folders khi expand class
- [x] Sidebar: lazy-load decks khi expand folder
- [x] Sidebar: Class creation (inline input form)
- [x] Header component

#### DevOps & Config

- [x] Monorepo Bun Workspaces (root `package.json`)
- [x] Root scripts: `dev`, `dev:api`, `dev:web`, `db:generate`, `db:migrate`, `db:seed`, `db:studio`
- [x] `docker-compose.yml` với PostgreSQL 15-alpine
- [x] `.gitignore` (node_modules, dist, .env, logs)
- [x] TailwindCSS v4 + `@theme` design tokens

---

## ❌ CÒN THIẾU — DANH SÁCH VIỆC CẦN LÀM

---

## PHASE 1 — Sửa lỗi Critical (Blocking)

> Những lỗi này đang chặn việc sử dụng app bình thường.

### 1.1 · CORS — Xác nhận fix hoạt động

- [ ] **1.1.1** Restart backend và test login từ browser tại `localhost:3002`  
      _Verify:_ Response header có `Access-Control-Allow-Origin: http://localhost:3002`
- [ ] **1.1.2** Nếu regex CORS vẫn lỗi, fallback sang `origin: true` cho development
  ```ts
  // apps/api/src/index.ts
  origin: ENV.NODE_ENV === 'production' ? false : true,
  ```

### 1.2 · Sidebar — Tạo Folder (THIẾU HOÀN TOÀN)

> Hiện tại sidebar chỉ có class creation. Không có cách nào tạo folder hay deck.

- [ ] **1.2.1** Thêm nút "+ Folder" khi class đang expanded trong sidebar
- [ ] **1.2.2** Inline input form để nhập tên folder (giống class creation)
- [ ] **1.2.3** Gọi `POST /folders/by-class/:classId` khi submit
- [ ] **1.2.4** Refetch folders sau khi tạo thành công
- [ ] **1.2.5** Xử lý lỗi (tên trống, API lỗi)

### 1.3 · Sidebar — Tạo Deck (THIẾU HOÀN TOÀN)

- [ ] **1.3.1** Thêm nút "+ Deck" khi folder đang expanded
- [ ] **1.3.2** Inline form nhập tên deck + chọn card template
- [ ] **1.3.3** Fetch danh sách templates (`GET /card-templates`) để hiện dropdown
- [ ] **1.3.4** Gọi `POST /decks/by-folder/:folderId` khi submit
- [ ] **1.3.5** Refetch decks sau khi tạo
- [ ] **1.3.6** Xử lý lỗi

### 1.4 · Dashboard — Navigate tới Deck View

> Hiện tại khi click deck trong sidebar chỉ chọn deck, không có link tới `/deck/:id`

- [ ] **1.4.1** Thêm nút "View Deck" (bên cạnh "Start Study Session") trong dashboard khi `selectedDeckId` có giá trị
  ```tsx
  <Button
    variant="outline"
    onClick={() => navigate(`/deck/${selectedDeckId()}`)}
  >
    View & Edit Cards
  </Button>
  ```
- [ ] **1.4.2** Hoặc làm deck item trong sidebar vừa có thể click chọn vừa có icon link `→` để navigate thẳng tới `/deck/:id`

---

## PHASE 2 — Tính năng còn thiếu (Core)

### 2.1 · Deck View — Edit Card

- [ ] **2.1.1** Thêm nút "Edit" (bút chì icon) trên mỗi card item trong danh sách
- [ ] **2.1.2** Khi click Edit, hiển thị form inline edit với giá trị hiện tại đã điền sẵn
- [ ] **2.1.3** Gọi `PATCH /cards/:id` với `fieldValues` mới khi submit
- [ ] **2.1.4** Refetch cards sau khi update
- [ ] **2.1.5** Cancel chỉnh sửa không lưu

### 2.2 · Deck View — `json_array` Field Type

> Hiện tại field `examples` (json_array) hiển thị input text thông thường — sai UX.

- [ ] **2.2.1** Tạo component `ArrayInput` cho phép thêm/xóa từng item trong array
- [ ] **2.2.2** Render `ArrayInput` trong add card form khi `fieldType === 'json_array'`
- [ ] **2.2.3** Hiển thị current value đúng (array of strings) khi edit card
- [ ] **2.2.4** Validate `maxItems` từ `field.config.maxItems` (e.g., max 5 examples)
- [ ] **2.2.5** Submit giá trị đúng kiểu `string[]` lên API

### 2.3 · Sidebar — CRUD đầy đủ (Rename/Delete)

- [ ] **2.3.1** Rename class: right-click menu hoặc context menu icon `⋯`
- [ ] **2.3.2** Delete class: confirm dialog trước khi xóa (cascade)
- [ ] **2.3.3** Rename folder
- [ ] **2.3.4** Delete folder
- [ ] **2.3.5** Rename deck
- [ ] **2.3.6** Delete deck (từ sidebar)

### 2.4 · Dashboard — Cải thiện UX khi chưa có dữ liệu

- [ ] **2.4.1** Khi chưa có class nào: hiển thị "empty state" hướng dẫn bắt đầu  
      _Ví dụ:_ "Create your first class to start organizing your flashcards →"
- [ ] **2.4.2** Link/button tạo class trực tiếp từ main area (không chỉ qua sidebar)

---

## PHASE 3 — UX & Polish

### 3.1 · Toast / Notification System

> Hiện tại không có feedback thành công, chỉ có lỗi inline. UX kém.

- [ ] **3.1.1** Tạo `Toast` / `Notification` component (đơn giản, không dùng lib ngoài)
- [ ] **3.1.2** Tạo store/signal `toasts` để quản lý notifications
- [ ] **3.1.3** Auto-dismiss sau 3 giây
- [ ] **3.1.4** Hiển thị toast sau các action thành công:
  - Card thêm thành công
  - Class/Folder/Deck tạo thành công
  - Card xóa
  - Logout

### 3.2 · Loading & Error States

- [ ] **3.2.1** Thêm skeleton loader cho sidebar khi đang load classes
- [ ] **3.2.2** Thêm loading spinner khi load cards trong deck-view
- [ ] **3.2.3** Error boundary để catch lỗi runtime không xử lý được
- [ ] **3.2.4** `404 Not Found` page cho routes không tồn tại
- [ ] **3.2.5** Hiển thị error message khi API call thất bại trong card list / deck list

### 3.3 · Deck View — UX Improvements

- [ ] **3.3.1** Hiển thị tên template đang dùng trong deck (badge/label)
- [ ] **3.3.2** Sort cards theo `sortOrder`
- [ ] **3.3.3** Confirm dialog khi xóa card ("Bạn có chắc muốn xóa card này?")
- [ ] **3.3.4** Hiển thị trạng thái SRS của từng card (box level, next review date) nếu có

### 3.4 · Study Mode — UX Improvements

- [ ] **3.4.1** Hiển thị tên deck ở top bar của study mode
- [ ] **3.4.2** Tổng kết cuối session: số lượng Again/Hard/Good
- [ ] **3.4.3** Animation mượt hơn khi chuyển card (fade hoặc slide)

### 3.5 · Header

- [ ] **3.5.1** Xác nhận nút Logout trong Header hoạt động đúng
- [ ] **3.5.2** Hiển thị email user đang login
- [ ] **3.5.3** Link về dashboard từ logo/app name

---

## PHASE 4 — Dev Experience & Infra

### 4.1 · Scripts & Developer Workflow

- [ ] **4.1.1** Test `bun run dev` từ root workspace chạy cả api và web song song
- [ ] **4.1.2** Nếu lỗi concurrent, xem xét dùng `concurrently` hoặc `bun run --parallel`
- [ ] **4.1.3** Thêm script `setup` vào root `package.json`:
  ```json
  "setup": "docker-compose up -d && bun run db:migrate && bun run db:seed"
  ```
- [ ] **4.1.4** Thêm script `reset-db` để drop và recreate database cho dev

### 4.2 · .env Management

- [ ] **4.2.1** Tạo `.env.example` trong `apps/api/` (không có giá trị thật):
  ```
  DATABASE_URL=postgresql://USER:PASSWORD@localhost:5435/DB_NAME
  PORT=3001
  NODE_ENV=development
  ```
- [ ] **4.2.2** Thêm chú thích trong README về cách setup `.env`

### 4.3 · README

- [ ] **4.3.1** Tạo `README.md` ở root với hướng dẫn setup đầy đủ:
  - Prerequisites (Docker, Bun)
  - Quickstart (clone → `bun install` → `docker-compose up -d` → `bun run db:migrate` → `bun run db:seed` → `bun run dev`)
  - Thông tin env variables
  - Cấu trúc project
  - Tech stack

---

## PHASE 5 — Tính năng nâng cao (Optional / Future)

### 5.1 · Card Templates — Custom Templates

- [ ] **5.1.1** UI tạo custom template trong frontend
- [ ] **5.1.2** Form thêm/xóa/sắp xếp fields
- [ ] **5.1.3** Chọn field type, side (front/back), required

### 5.2 · Search & Filter

- [ ] **5.2.1** Tìm kiếm class/folder/deck trong sidebar
- [ ] **5.2.2** Filter cards trong deck-view theo từ khóa

### 5.3 · Statistics Dashboard

- [ ] **5.3.1** Hiển thị thống kê học tập: tổng cards, cards due today, streak
- [ ] **5.3.2** Chart lịch sử review theo ngày

### 5.4 · Import/Export

- [ ] **5.4.1** Export deck ra CSV
- [ ] **5.4.2** Import cards từ CSV

---

## Thứ tự ưu tiên thực hiện

```
PHASE 1 (Critical) → PHASE 2 (Core) → PHASE 3 (Polish) → PHASE 4 (DevEx) → PHASE 5 (Future)
```

| Priority | Task                             | Effort  | Impact                  |
| -------- | -------------------------------- | ------- | ----------------------- |
| 🔴 P0    | 1.1 CORS fix verify              | 15 min  | Blocking login          |
| 🔴 P0    | 1.2 Sidebar tạo Folder           | 1h      | Blocking tạo nội dung   |
| 🔴 P0    | 1.3 Sidebar tạo Deck             | 1h      | Blocking tạo nội dung   |
| 🔴 P0    | 1.4 Dashboard link tới Deck View | 15 min  | Blocking quản lý cards  |
| 🟠 P1    | 2.1 Edit Card                    | 1h      | Core feature            |
| 🟠 P1    | 2.2 json_array UI                | 2h      | Core vocabulary feature |
| 🟡 P2    | 2.3 Sidebar Delete/Rename        | 2h      | CRUD complete           |
| 🟡 P2    | 3.1 Toast system                 | 1.5h    | UX                      |
| 🟡 P2    | 3.2 Loading/Error states         | 1.5h    | UX                      |
| 🟢 P3    | 4.3 README                       | 30 min  | DevEx                   |
| 🟢 P3    | 4.2 .env.example                 | 10 min  | DevEx                   |
| 🔵 P4    | 5.x Advanced features            | 1+ week | Future                  |
