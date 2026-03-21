# Engram-Spira: Ứng dụng Flashcard thông minh với Lặp lại Ngắt quãng (SRS)

> **Sinh viên thực hiện:** Phi Long (IamTPL)
> **Loại dự án:** Ứng dụng web fullstack — Quản lý Flashcard & Hỗ trợ học tập

---

## 1. Giới thiệu Dự án

### 1.1. Vấn đề cần giải quyết

Sinh viên thường gặp khó khăn trong việc ghi nhớ kiến thức lâu dài. Các ứng dụng flashcard phổ biến như Quizlet hay Anki có những hạn chế:

- **Quizlet:** Giao diện dễ dùng nhưng thuật toán ghi nhớ đơn giản, không có AI hỗ trợ tạo thẻ, không có đồ thị tri thức.
- **Anki:** Thuật toán mạnh nhưng giao diện cũ, khó sử dụng, không có tính năng AI.

### 1.2. Engram-Spira là gì?

Engram-Spira là ứng dụng web flashcard thế hệ mới, kết hợp:
- **Thuật toán ghi nhớ khoa học** (SM-2 & FSRS) giúp ôn tập đúng thời điểm
- **AI tạo thẻ tự động** bằng Google Gemini
- **Đồ thị tri thức** (Knowledge Graph) giúp nhìn thấy mối liên hệ giữa các kiến thức
- **Tìm kiếm ngữ nghĩa** (Semantic Search) bằng vector embedding

### 1.3. Ý nghĩa tên gọi

- **Engram:** Thuật ngữ tâm lý học chỉ dấu vết trí nhớ được hình thành trong não
- **Spira:** (Latin: "xoắn ốc") — mô phỏng việc ôn tập lặp đi lặp lại theo chu kỳ mở rộng

---

## 2. Công nghệ sử dụng

| Thành phần | Công nghệ | Vai trò |
|---|---|---|
| **Runtime** | Bun (>= 1.3) | JavaScript runtime nhanh hơn Node.js, dùng cho cả backend lẫn quản lý package |
| **Backend** | ElysiaJS + Drizzle ORM | Framework web type-safe, ORM hiện đại cho TypeScript |
| **Database** | PostgreSQL 15 + pgvector | CSDL quan hệ + extension hỗ trợ tìm kiếm vector (cho semantic search) |
| **Frontend** | SolidJS + TanStack Query | UI framework hiệu suất cao (fine-grained reactivity) + quản lý cache/fetch dữ liệu |
| **Styling** | TailwindCSS v4 | Utility-first CSS framework |
| **API Client** | Elysia Eden Treaty | Type-safe API client — frontend và backend chia sẻ kiểu dữ liệu tự động |
| **Auth** | Custom (argon2 + oslo) | Xác thực bằng session, mật khẩu hash bằng argon2 |
| **AI** | Google Gemini API | Tạo flashcard tự động, trích xuất concepts, tạo embedding |
| **Graph** | Cytoscape.js | Thư viện vẽ đồ thị tương tác cho Knowledge Graph |
| **Container** | Docker Compose | Chạy PostgreSQL trong container |

### Tại sao chọn stack này?

- **Bun** nhanh hơn Node.js ~3 lần, giảm thời gian cài đặt và chạy ứng dụng.
- **ElysiaJS + Eden Treaty** cho phép frontend gọi API backend với đầy đủ type checking — nếu thay đổi API ở backend, frontend sẽ báo lỗi ngay lúc code (end-to-end type safety).
- **SolidJS** có hiệu suất render nhanh hơn React nhờ cơ chế fine-grained reactivity — chỉ cập nhật đúng phần DOM thay đổi, không re-render toàn bộ component.
- **pgvector** cho phép lưu trữ và tìm kiếm vector embedding ngay trong PostgreSQL, không cần database riêng (như Pinecone, Weaviate).

---

## 3. Kiến trúc hệ thống

### 3.1. Tổng quan kiến trúc

```
┌─────────────────┐       REST API        ┌──────────────────────┐
│   Frontend      │ ◄──── (Eden Treaty) ── │    Backend           │
│   SolidJS       │       Type-safe        │    ElysiaJS          │
│   Port 3002     │                        │    Port 3001         │
└─────────────────┘                        └──────────┬───────────┘
                                                      │
                                           ┌──────────▼───────────┐
                                           │   PostgreSQL 15      │
                                           │   + pgvector         │
                                           │   (Docker)           │
                                           └──────────────────────┘
                                                      │
                                           ┌──────────▼───────────┐
                                           │   Google Gemini API  │
                                           │   (AI + Embedding)   │
                                           └──────────────────────┘
```

### 3.2. Cấu trúc Monorepo

```
engram-spira/
├── apps/
│   ├── api/          # Backend — ElysiaJS
│   │   └── src/
│   │       ├── modules/    # 15 module nghiệp vụ
│   │       │   ├── auth/            # Đăng nhập, đăng ký, session
│   │       │   ├── classes/         # Quản lý Lớp học (môn học)
│   │       │   ├── folders/         # Quản lý Thư mục (chương)
│   │       │   ├── decks/           # Quản lý Bộ thẻ
│   │       │   ├── cards/           # CRUD thẻ flashcard
│   │       │   ├── card-templates/  # Hệ thống template tùy chỉnh
│   │       │   ├── study/           # SRS engine (SM-2 + FSRS)
│   │       │   ├── ai/             # AI tạo thẻ + phát hiện trùng lặp
│   │       │   ├── embedding/       # Vector embedding (Gemini)
│   │       │   ├── search/          # Tìm kiếm ngữ nghĩa + text
│   │       │   ├── knowledge-graph/ # Đồ thị tri thức
│   │       │   ├── import-export/   # Import/Export CSV, JSON
│   │       │   ├── notifications/   # Thông báo
│   │       │   ├── feedback/        # Góp ý
│   │       │   └── users/           # Quản lý người dùng
│   │       └── db/         # Schema, migration, seed
│   └── web/          # Frontend — SolidJS + Vite
│       └── src/
│           ├── pages/       # Các trang (dashboard, study, settings...)
│           ├── components/  # UI components
│           └── stores/      # State management (auth, theme, focus...)
├── packages/
│   └── shared/       # Types dùng chung
└── docker-compose.yml
```

### 3.3. Phân cấp dữ liệu

```
Class (Lớp/Môn học)
  └── Folder (Thư mục/Chương)
       └── Deck (Bộ thẻ)
            └── Card (Thẻ flashcard)
                 ├── Card Field Values (Nội dung theo template)
                 ├── Study Progress (Tiến độ học)
                 ├── Card Links (Liên kết giữa các thẻ)
                 └── Card Concepts (Khái niệm được AI trích xuất)
```

---

## 4. Các tính năng chính

### 4.1. Hệ thống Lặp lại Ngắt quãng (SRS) — Tính năng cốt lõi

**Vấn đề:** Con người quên thông tin theo đường cong Ebbinghaus — quên nhanh trong vài giờ đầu, sau đó chậm dần. Muốn nhớ lâu phải ôn tập đúng thời điểm.

**Giải pháp:** Engram-Spira hỗ trợ **2 thuật toán ghi nhớ**, người dùng chọn theo sở thích:

#### Thuật toán SM-2 (SuperMemo 2)

Công thức cốt lõi: `interval(n+1) = interval(n) × easeFactor`

- Mỗi thẻ có một **Ease Factor** (mức độ dễ) riêng, điều chỉnh theo từng lần ôn tập.
- Nếu trả lời đúng liên tục → khoảng cách ôn tập **tăng theo cấp số nhân** (1 ngày → 6 ngày → 15 ngày → 37 ngày...).
- Nếu quên → Ease Factor giảm, khoảng cách bị rút ngắn.
- Mỗi người có Ease Factor khác nhau cho cùng một thẻ → **cá nhân hóa**.

#### Thuật toán FSRS (Free Spaced Repetition Scheduler)

- Thuật toán mới hơn, sử dụng thư viện `ts-fsrs`.
- Tính toán dựa trên **stability** (độ ổn định trí nhớ) và **difficulty** (độ khó), cho kết quả chính xác hơn SM-2.
- Hỗ trợ trạng thái: New → Learning → Review → Relearning.

#### Bảng so sánh hành động ôn tập

| Hành động | SM-2 | FSRS |
|-----------|------|------|
| **Again** (Quên) | Reset về 0, ôn lại sau 10 phút | Chuyển về Relearning |
| **Hard** (Khó) | Ease Factor giảm nhẹ, interval tăng chậm | Difficulty tăng |
| **Good** (Tốt) | Interval nhân với Ease Factor | Stability cập nhật |
| **Easy** (Dễ) | Ease Factor tăng + bonus interval | Interval tăng mạnh |

**Phím tắt:** `Space` (lật thẻ), `1` (Again), `2` (Hard), `3` (Good), `4` (Easy)

### 4.2. AI tạo Flashcard tự động

- Người dùng nhập **đoạn văn bản hoặc chủ đề** → AI (Google Gemini) tự động tạo flashcard.
- Hỗ trợ 2 chế độ:
  - **Vocabulary:** Tạo thẻ từ vựng với IPA, loại từ, ví dụ
  - **Q&A:** Tạo thẻ hỏi-đáp từ nội dung bài học
- Quy trình: Nhập text → AI xử lý (streaming) → Preview thẻ → Chỉnh sửa → Lưu.
- Sử dụng **background job** — không block giao diện người dùng khi AI đang xử lý.

### 4.3. Tìm kiếm Ngữ nghĩa (Semantic Search)

- Mỗi thẻ được tạo **vector embedding** (768 chiều) bằng Gemini Embedding API.
- Vector được lưu trong PostgreSQL qua extension **pgvector**.
- Khi tìm kiếm: truy vấn → tạo embedding → so sánh cosine similarity → trả về kết quả gần nghĩa nhất.
- **Fallback:** Nếu semantic search lỗi → tự động chuyển sang tìm kiếm text (ILIKE).

### 4.4. Đồ thị Tri thức (Knowledge Graph)

- Mỗi thẻ là một **node**, mỗi mối liên hệ là một **edge** (prerequisite hoặc related).
- Hiển thị bằng **Cytoscape.js** — đồ thị tương tác, có thể kéo thả, zoom.
- **AI phát hiện mối liên hệ:** Sử dụng embedding similarity để gợi ý liên kết giữa các thẻ tương tự.
- **Chuỗi tiên quyết (Prerequisite Chain):** Khi quên 1 thẻ → hệ thống gợi ý ôn lại các thẻ tiên quyết trước.

### 4.5. Phát hiện thẻ trùng lặp (Duplicate Detection)

- Sử dụng **cosine similarity** trên vector embedding để phát hiện thẻ có nội dung tương tự (ngưỡng 85%).
- Hỗ trợ: kiểm tra khi tạo thẻ mới, quét toàn bộ deck.
- Giúp tránh tạo thẻ trùng, tối ưu bộ thẻ.

### 4.6. Phân tích học tập (Analytics)

- **Dự báo ôn tập (Forecast):** Dự đoán số thẻ sắp quên trong 7–90 ngày tới bằng công thức R(t) = e^(-t/S).
- **Heatmap độ nhớ:** Hiển thị mức độ nhớ từng thẻ bằng màu (xanh = nhớ tốt, đỏ = sắp quên).
- **Thẻ nguy cơ (At-risk cards):** Phát hiện thẻ đang "rơi rụng âm thầm" — chưa đến hạn nhưng dự đoán đã quên.
- **Smart Groups:** Nhóm thẻ theo concept do AI trích xuất tự động.

### 4.7. Các tính năng khác

| Tính năng | Mô tả |
|-----------|-------|
| **Card Templates** | Tùy chỉnh cấu trúc thẻ (VD: thẻ từ vựng có IPA, type, examples) |
| **Import/Export** | Nhập từ CSV, xuất CSV/JSON |
| **Focus Mode** | Chế độ tập trung học, có hiệu ứng 3D và âm thanh |
| **Interleaved Study** | Ôn tập xen kẽ giữa nhiều bộ thẻ |
| **Email Verification** | Xác minh email khi đăng ký |
| **Reset Password** | Quên mật khẩu — gửi email reset |
| **Dark/Light Theme** | Giao diện sáng/tối |
| **Keyboard Shortcuts** | Phím tắt trong chế độ học |

---

## 5. Điểm khác biệt so với đối thủ

| Tiêu chí | Quizlet | Anki | **Engram-Spira** |
|----------|---------|------|-------------------|
| Thuật toán SRS | Đơn giản, cố định | SM-2 | **SM-2 + FSRS** (chọn được) |
| AI tạo thẻ | Có (trả phí) | Không | **Có** (Gemini, miễn phí API key) |
| Knowledge Graph | Không | Không | **Có** (Cytoscape.js) |
| Semantic Search | Không | Không | **Có** (pgvector) |
| Phát hiện trùng lặp | Không | Không | **Có** (embedding similarity) |
| Dự báo ôn tập | Cơ bản | Plugin | **Có** (Forecast + At-risk) |
| Type Safety (E2E) | Không | Không | **Có** (Eden Treaty) |
| Mã nguồn mở | Không | Có | **Có** |

---

## 6. Sơ đồ luồng hoạt động chính

### Luồng học tập (Study Flow)

```
Chọn Deck → Bắt đầu học → Hiện mặt trước thẻ
                                ↓
                         Lật thẻ (Space)
                                ↓
                         Hiện mặt sau
                                ↓
                   Đánh giá: Again | Hard | Good | Easy
                                ↓
                   SRS Engine tính nextReviewAt
                                ↓
                   Lưu StudyProgress → Thẻ tiếp theo
```

### Luồng AI tạo thẻ

```
Nhập text/topic → Gửi request → Tạo Background Job
                                        ↓
                              Gemini streaming xử lý
                                        ↓
                              Job status: pending
                                        ↓
                              Preview danh sách thẻ
                                        ↓
                              Chỉnh sửa (tùy chọn)
                                        ↓
                              Lưu thẻ + Tạo Embedding
```

---

## 7. Kết luận

Engram-Spira là ứng dụng web flashcard fullstack, kết hợp **thuật toán ghi nhớ khoa học + AI + đồ thị tri thức** trong một nền tảng duy nhất. Dự án sử dụng công nghệ hiện đại (Bun, ElysiaJS, SolidJS), tập trung vào **hiệu suất** (fine-grained reactivity, type-safe E2E) và **trải nghiệm người dùng** (AI tạo thẻ, semantic search, study analytics).

Điểm khác biệt chính so với Quizlet và Anki là sự **tích hợp AI sâu** (tạo thẻ, phát hiện liên kết, trích xuất concept) và **đồ thị tri thức** giúp người dùng hiểu được mối liên hệ giữa các kiến thức — chứ không chỉ ghi nhớ từng thẻ riêng lẻ.
