# Engram-Spira — Giải thích chi tiết & Chuẩn bị Câu hỏi Bảo vệ Đồ án

> Tài liệu này giải thích chi tiết từng phần trong project để bạn hiểu sâu, đồng thời chuẩn bị các câu hỏi mà thầy/cô có thể hỏi khi bảo vệ đồ án.

---

## Phần A: Giải thích chi tiết các khái niệm và công nghệ

### A1. Tại sao dùng Bun thay vì Node.js?

**Bun** là JavaScript runtime mới, viết bằng Zig (ngôn ngữ hệ thống). So với Node.js:

| Tiêu chí | Node.js | Bun |
|----------|---------|-----|
| Engine | V8 (Google) | JavaScriptCore (Apple/WebKit) |
| Package manager | npm (chậm) | Bun install (nhanh 10-30x) |
| Bundler | Cần thêm webpack/esbuild | Tích hợp sẵn |
| TypeScript | Cần ts-node hoặc build | Chạy trực tiếp .ts |

**Trong project:** `bun run --watch src/index.ts` — chạy TypeScript trực tiếp, tự restart khi code thay đổi.

### A2. ElysiaJS là gì? Khác Express thế nào?

**ElysiaJS** là web framework cho Bun, tập trung vào **type safety** và **hiệu suất**.

```typescript
// Express: không có type-safe
app.get('/users/:id', (req, res) => {
  const id = req.params.id; // string, không biết kiểu
  res.json({ user: ... });
});

// ElysiaJS: type-safe, tự validate
app.get('/users/:id', ({ params }) => {
  return { user: ... }; // TypeScript biết params.id là string
}, {
  params: t.Object({ id: t.String() }) // tự validate + tự tạo type
});
```

**Lợi ích chính:** Kết hợp với Eden Treaty, frontend gọi API mà TypeScript tự biết kiểu trả về — thay đổi API ở backend, frontend báo lỗi ngay khi code.

### A3. SolidJS khác React thế nào?

**React:** Virtual DOM — mỗi lần state thay đổi → render lại toàn bộ component → so sánh virtual DOM → cập nhật DOM thật.

**SolidJS:** Fine-grained reactivity — mỗi signal (biến reactive) theo dõi chính xác phần DOM nào sử dụng nó → chỉ cập nhật **đúng text node** thay đổi, không re-render toàn bộ.

```jsx
// React: cả component re-render khi count thay đổi
function Counter() {
  const [count, setCount] = useState(0);
  return <p>Count: {count}</p>; // render lại toàn bộ <p>
}

// SolidJS: chỉ text node "{count()}" được cập nhật
function Counter() {
  const [count, setCount] = createSignal(0);
  return <p>Count: {count()}</p>; // chỉ update số, <p> không bị đụng
}
```

**Kết quả:** SolidJS nhanh hơn React trong các benchmark UI, đặc biệt với danh sách lớn.

### A4. Thuật toán SM-2 hoạt động thế nào?

SM-2 (SuperMemo 2) là thuật toán lặp lại ngắt quãng kinh điển, phát minh bởi Piotr Wozniak (1987).

**Nguyên lý:** Mỗi thẻ có 3 biến trạng thái:
- `boxLevel` (lần ôn tập thứ mấy, bắt đầu từ 0)
- `easeFactor` (hệ số dễ, mặc định 2.5, tối thiểu 1.3)
- `intervalDays` (khoảng cách ôn tập hiện tại, tính bằng ngày)

**Công thức cốt lõi:**
```
interval(n+1) = interval(n) × easeFactor
```

**Ví dụ thực tế:** Thẻ có easeFactor = 2.5, trả lời _Good_ mỗi lần:
- Lần 1: interval = 1 ngày
- Lần 2: interval = 6 ngày
- Lần 3: interval = 6 × 2.5 = 15 ngày
- Lần 4: interval = 15 × 2.5 = 37 ngày

Nếu trả lời _Again_ (quên): `boxLevel = 0`, `easeFactor -= 0.2`, ôn lại sau 10 phút.

**Điểm mạnh:** Cá nhân hóa — easeFactor điều chỉnh theo từng thẻ, từng người.

### A5. FSRS khác SM-2 thế nào?

**FSRS** (Free Spaced Repetition Scheduler) là thuật toán mới (2022) bởi open-source community.

| Tiêu chí | SM-2 | FSRS |
|----------|------|------|
| Tham số chính | easeFactor | stability + difficulty |
| Trạng thái thẻ | boxLevel đơn giản | New/Learning/Review/Relearning |
| Độ chính xác | Tốt | Tốt hơn (nhiều tham số hơn) |
| Learning steps | Không có | Có (1 phút → 15 phút → tốt nghiệp) |

**Trong project:** Người dùng chọn thuật toán trong Settings. File `srs.engine.ts` có hàm `dispatchReview()` điều hướng sang thuật toán tương ứng.

### A6. Embedding và Semantic Search là gì?

**Embedding:** Biến đổi text thành vector số (mảng 768 số thực).

```
"machine learning" → [0.12, -0.45, 0.89, ..., 0.03]  (768 số)
"deep learning"    → [0.11, -0.43, 0.87, ..., 0.05]  (gần giống)
"cooking recipe"   → [-0.67, 0.23, -0.11, ..., 0.78] (khác xa)
```

**Cosine Similarity:** Đo "góc" giữa 2 vector:
- 1.0 = hoàn toàn giống nhau
- 0.0 = không liên quan
- -1.0 = hoàn toàn ngược nghĩa

**Quy trình trong project:**
1. Tạo thẻ mới → gọi Gemini API tạo embedding 768 chiều → lưu vào PostgreSQL (cột `embedding` kiểu `vector`)
2. Tìm kiếm → text query → tạo embedding → pgvector tìm vector gần nhất bằng cosine distance (`<=>` operator)

**pgvector:** Extension của PostgreSQL, cho phép lưu và tìm kiếm vector ngay trong database, hỗ trợ index HNSW cho tìm kiếm nhanh (~5-20ms trên 100K vectors).

### A7. Knowledge Graph trong project hoạt động thế nào?

Knowledge Graph trong Engram-Spira sử dụng **PostgreSQL** (bảng `card_links`) chứ **KHÔNG** dùng Neo4j:

- **Node** = mỗi thẻ flashcard
- **Edge** = mối liên hệ giữa 2 thẻ, có 2 loại:
  - `prerequisite`: kiến thức tiên quyết (VD: "Đạo hàm" → cần biết "Giới hạn" trước)
  - `related`: liên quan (VD: "DNA" liên quan "RNA")

**AI gợi ý liên kết:** Hệ thống so sánh embedding similarity giữa tất cả thẻ trong deck. Nếu similarity > 0.7 → gợi ý cho người dùng tạo liên kết.

**Prerequisite Chain:** Khi quên thẻ C, hệ thống dùng **BFS** (Breadth-First Search) duyệt ngược chuỗi prerequisite: C ← B ← A → gợi ý ôn lại A và B trước.

**Frontend:** Sử dụng Cytoscape.js — thư viện JavaScript vẽ đồ thị tương tác (node-edge), hỗ trợ layout tự động, zoom, kéo thả.

### A8. Card Template System là gì?

Hệ thống cho phép tùy chỉnh cấu trúc thẻ:

- **Template mặc định:** Front (mặt trước) + Back (mặt sau)
- **Template Vocabulary:** Word + Definition + IPA + Type + Examples
- **Template Q&A:** Question + Answer

Mỗi template có nhiều `templateFields`, mỗi field có `name`, `side` (front/back), `fieldType`, `sortOrder`. Thẻ flashcard lưu giá trị qua bảng `card_field_values` — thiết kế **EAV (Entity-Attribute-Value)** cho phép mở rộng không giới hạn kiểu thẻ.

---

## Phần B: Câu hỏi thầy/cô có thể hỏi & Hướng dẫn trả lời

### Câu 1: "Tại sao em chọn SolidJS mà không dùng React? React phổ biến hơn nhiều."

**Trả lời:**
> "Dạ, em chọn SolidJS vì nó có cơ chế **fine-grained reactivity** — khi dữ liệu thay đổi, SolidJS chỉ cập nhật đúng phần DOM bị ảnh hưởng, không render lại toàn bộ component như React. Điều này quan trọng với ứng dụng flashcard vì trong chế độ học, người dùng lật thẻ liên tục — nếu mỗi lần render lại cả component sẽ gây giật. SolidJS cho hiệu suất tốt hơn trong benchmark. Ngoài ra, cú pháp SolidJS rất giống React nên em không mất nhiều thời gian làm quen."

### Câu 2: "Giải thích cách thuật toán SM-2 hoạt động trong project của em."

**Trả lời:**
> "Dạ, SM-2 dựa trên ý tưởng: mỗi thẻ có một **Ease Factor** (hệ số dễ) riêng. Khi trả lời _Good_, khoảng cách ôn tập tiếp theo = khoảng cách hiện tại × Ease Factor. Ví dụ thẻ có EF = 2.5: lần đầu 1 ngày, lần 2 là 6 ngày, lần 3 là 15 ngày. Nếu quên (trả lời _Again_), EF giảm 0.2 và thẻ quay về đầu, ôn lại sau 10 phút. Điểm mạnh là **cá nhân hóa** — thẻ nào khó (EF thấp) sẽ xuất hiện thường xuyên hơn, thẻ dễ (EF cao) xuất hiện ít hơn. Code nằm trong file `srs.engine.ts`."

### Câu 3: "Semantic Search khác tìm kiếm thông thường (LIKE) thế nào?"

**Trả lời:**
> "Dạ, tìm kiếm thông thường bằng LIKE chỉ khớp chính xác chuỗi ký tự. Ví dụ tìm 'dog' sẽ không ra kết quả 'puppy' hay 'canine'. Semantic search biến text thành vector số (embedding) thông qua Gemini API, rồi so sánh **ý nghĩa** thay vì ký tự. Khi tìm 'dog', các thẻ về 'puppy', 'pet', 'canine' cũng sẽ xuất hiện vì vector embedding của chúng gần nhau. Trong project, em dùng **pgvector** extension của PostgreSQL để lưu và tìm kiếm vector, toán tử `<=>` tính cosine distance. Em cũng cài **fallback** — nếu semantic search lỗi (ví dụ Gemini API down) → tự động chuyển sang ILIKE."

### Câu 4: "Tại sao dùng PostgreSQL + pgvector mà không dùng database chuyên biệt (Pinecone, Weaviate)?"

**Trả lời:**
> "Dạ, có 2 lý do. Thứ nhất, project đã dùng PostgreSQL làm database chính — nếu thêm Pinecone hoặc Weaviate sẽ phải maintain 2 database riêng biệt, phức tạp hóa kiến trúc. Thứ hai, pgvector đã đủ mạnh cho quy mô project sinh viên — hỗ trợ index HNSW cho tìm kiếm nhanh (~5-20ms trên 100K vectors). Chỉ khi nào dữ liệu lên hàng triệu vector mới cần database chuyên biệt."

### Câu 5: "End-to-end type safety nghĩa là gì? Tại sao quan trọng?"

**Trả lời:**
> "Dạ, end-to-end type safety nghĩa là kiểu dữ liệu được kiểm tra **từ backend đến frontend**. Trong project, em dùng ElysiaJS ở backend và Eden Treaty ở frontend. Khi backend định nghĩa API trả về `{ name: string, age: number }`, frontend gọi API đó sẽ tự động biết kiểu trả về. Nếu em đổi `age` thành `birthday` ở backend mà quên cập nhật frontend → TypeScript báo lỗi ngay khi code, không cần chạy app mới phát hiện. Điều này giảm bug runtime đáng kể."

### Câu 6: "Knowledge Graph trong project sử dụng thuật toán gì?"

**Trả lời:**
> "Dạ, Knowledge Graph của em sử dụng 2 kỹ thuật chính. Thứ nhất, **AI phát hiện mối liên hệ**: hệ thống tính cosine similarity giữa embedding vector của tất cả thẻ trong deck (so sánh O(n²/2) với giới hạn 500 thẻ). Nếu similarity > 0.7 → gợi ý liên kết cho người dùng duyệt. Thứ hai, **chuỗi tiên quyết**: dùng thuật toán **BFS** (Breadth-First Search) với giới hạn độ sâu 10 để duyệt ngược các link kiểu 'prerequisite'. Dữ liệu lưu trong bảng `card_links` của PostgreSQL, hiển thị bằng Cytoscape.js trên frontend."

### Câu 7: "Giải thích cách AI tạo flashcard hoạt động."

**Trả lời:**
> "Dạ, quy trình gồm 4 bước. Bước 1: Người dùng nhập đoạn text hoặc topic. Bước 2: Backend tạo một **background job** (status = 'processing') và trả về jobId ngay — frontend không bị block. Bước 3: Backend gọi Google Gemini API bằng **streaming** — AI trả về kết quả từng chunk, tránh timeout. Prompt được thiết kế riêng cho 2 mode: vocabulary (tạo thẻ từ vựng với IPA, loại từ, ví dụ) và Q&A (tạo thẻ hỏi-đáp). Bước 4: Frontend poll API để kiểm tra status. Khi job xong (status = 'pending') → hiển thị preview → người dùng chỉnh sửa → lưu. Sau khi lưu, hệ thống tự động tạo embedding cho các thẻ mới."

### Câu 8: "Dự án xử lý lỗi thế nào nếu API Gemini bị down hoặc timeout?"

**Trả lời:**
> "Dạ, project có nhiều lớp xử lý lỗi. Thứ nhất, **timeout**: mỗi lần gọi Gemini có giới hạn 3 phút, nếu quá thời gian → abort request → cập nhật job status = 'failed' với thông báo lỗi. Thứ hai, **orphan recovery**: khi server restart, tất cả job đang ở trạng thái 'processing' sẽ tự động chuyển sang 'failed' vì promise đã bị kill — hàm `recoverOrphanedJobs()`. Thứ ba, **rate limiting**: giới hạn số request AI mỗi user để tránh lạm dụng. Thứ tư, cho semantic search — nếu embedding API lỗi → fallback sang tìm kiếm ILIKE."

### Câu 9: "Drizzle ORM khác TypeORM hay Prisma thế nào?"

**Trả lời:**
> "Dạ, Drizzle ORM là ORM mới, có 2 ưu điểm chính. Thứ nhất, **SQL-like**: query Drizzle gần giống SQL thật, dễ đọc và dễ tối ưu — không có 'magic' hay abstraction phức tạp. Thứ hai, **lightweight**: Drizzle không cần generate code riêng (Prisma cần `prisma generate`) và bundle size nhỏ hơn nhiều. Drizzle cũng tích hợp tốt với Bun và có Drizzle Kit hỗ trợ migration, seed."

### Câu 10: "Retention (mức độ nhớ) trong Analytics được tính thế nào?"

**Trả lời:**
> "Dạ, em dùng công thức **R(t) = e^(-t/S)** — đây là mô hình hàm mũ cho đường cong quên lãng. Trong đó: t = số ngày kể từ lần ôn tập cuối, S = stability (độ ổn định trí nhớ). Nếu dùng FSRS thì S lấy trực tiếp từ thuật toán. Nếu dùng SM-2 thì S được ước lượng: `S = intervalDays × (easeFactor / 2.5)`. Ví dụ: thẻ ôn cách đây 5 ngày, S = 10 → R = e^(-5/10) = 0.607 = 60.7%. Thẻ nào R < 80% được đánh dấu 'at-risk'."

### Câu 11: "Tại sao em dùng monorepo? Monorepo là gì?"

**Trả lời:**
> "Dạ, monorepo nghĩa là toàn bộ code (backend, frontend, shared types) nằm trong **1 repository** duy nhất, thay vì tách thành 2-3 repo riêng. Lợi ích: thứ nhất, chia sẻ code dễ dàng — package `shared` chứa types dùng chung. Thứ hai, 1 lần `bun install` cho tất cả. Thứ ba, dùng `bun run dev` để chạy đồng thời cả backend lẫn frontend. Trong project, em dùng Bun Workspaces — khai báo trong `package.json` gốc: `workspaces: ['apps/*', 'packages/*']`."

### Câu 12: "Em bảo mật thế nào? Mật khẩu lưu ra sao?"

**Trả lời:**
> "Dạ, mật khẩu được hash bằng **argon2** — thuật toán hash hiện đại nhất hiện nay, khuyến nghị bởi OWASP. Argon2 chống lại tấn công brute-force tốt hơn bcrypt vì sử dụng nhiều memory. Token session dùng thư viện **oslo/crypto** — tạo token ngẫu nhiên an toàn dùng CSPRNG. Backend cũng có **rate limiting** (`elysia-rate-limit`) để chống brute-force login, và **CORS** (`@elysiajs/cors`) chỉ cho phép frontend domain gọi API."

### Câu 13: "Duplicate Detection hoạt động thế nào?"

**Trả lời:**
> "Dạ, hệ thống phát hiện thẻ trùng lặp bằng **embedding similarity**. Khi tạo thẻ mới, hệ thống lấy embedding vector của thẻ đó, rồi dùng pgvector tìm các thẻ có cosine similarity > 85% trong toàn bộ bộ sưu tập của người dùng. Ngoài ra có chức năng **quét toàn deck** — so sánh từng cặp thẻ trong deck (O(n²/2), giới hạn 500 thẻ) để phát hiện trùng lặp. Tất cả dựa trên **ý nghĩa** chứ không phải so khớp text — nên 'dog' và 'puppy' có thể bị đánh dấu trùng."

### Câu 14: "Dự báo ôn tập (Forecast) tính thế nào?"

**Trả lời:**
> "Dạ, hệ thống dự đoán cho mỗi ngày trong tương lai (tối đa 90 ngày): có bao nhiêu thẻ sẽ rơi xuống dưới ngưỡng 80% retention. Cách tính: lấy tất cả studyProgress của user, với mỗi ngày d, tính R(t) = e^(-t/S) cho từng thẻ, đếm số thẻ R < 0.8. Performance rất nhanh vì chỉ 1 lần query DB + tính Math.exp() trong memory — 1000 thẻ × 30 ngày = 30K phép tính ≈ vài ms."

---

## Phần C: Câu hỏi nâng cao (nếu thầy/cô hỏi sâu)

### Câu 15: "Tại sao dùng pgvector mà không dùng GIN index cho full-text search?"

**Trả lời:**
> "Dạ, full-text search (GIN + tsvector) tìm theo từ khóa — phải khớp đúng từ. Semantic search bằng pgvector tìm theo **ý nghĩa** — 'machine learning' sẽ tìm được thẻ về 'AI', 'neural network'. Tuy nhiên em vẫn có fallback dùng ILIKE (tìm text thông thường) khi semantic search không khả dụng."

### Câu 16: "EAV pattern cho card_field_values có nhược điểm gì?"

**Trả lời:**
> "Dạ, EAV (Entity-Attribute-Value) có nhược điểm là **query phức tạp** hơn — muốn lấy nội dung 1 thẻ phải JOIN qua bảng template_fields, và không thể đặt ràng buộc kiểu dữ liệu trên từng field. Tuy nhiên lợi ích là **linh hoạt** — người dùng có thể tạo template tùy ý (thêm field IPA, examples...) mà không cần migrate database. Đó là tradeoff em chấp nhận."

### Câu 17: "Background job xử lý AI tạo thẻ — tại sao không dùng queue (Bull, RabbitMQ)?"

**Trả lời:**
> "Dạ, với quy mô project sinh viên, fire-and-forget pattern (void promise) đã đủ đơn giản và hiệu quả. Nếu scale lên nhiều user đồng thời thì cần message queue để điều phối. Tuy nhiên em đã xử lý edge case quan trọng: khi server restart → hàm `recoverOrphanedJobs()` đánh dấu job đang chạy dở thành 'failed' để frontend không bị treo vô thời hạn."

### Câu 18: "Cosine similarity tính thế nào? Tại sao dùng cosine mà không dùng Euclidean distance?"

**Trả lời:**
> "Dạ, cosine similarity = (A·B) / (|A| × |B|) — tính cos góc giữa 2 vector. Giá trị từ -1 đến 1. Em dùng cosine vì nó **không phụ thuộc độ dài vector** — 2 đoạn text dài ngắn khác nhau nhưng cùng ý nghĩa sẽ có cosine cao. Euclidean distance bị ảnh hưởng bởi magnitude — 2 vector cùng hướng nhưng khác độ dài sẽ có Euclidean lớn. Trong NLP, cosine similarity là chuẩn mực."

---

## Phần D: Checklist trước khi bảo vệ

- [ ] Đọc hiểu toàn bộ file presentation
- [ ] Nhớ tech stack: Bun, ElysiaJS, Drizzle, PostgreSQL, pgvector, SolidJS, TanStack Query, TailwindCSS, Eden Treaty, Cytoscape.js
- [ ] Giải thích được SM-2 với ví dụ số cụ thể
- [ ] Giải thích được semantic search vs text search
- [ ] Biết đường cong quên lãng R(t) = e^(-t/S) nghĩa là gì
- [ ] Demo: tạo thẻ bằng AI → xem knowledge graph → chế độ học → xem analytics
- [ ] Biết trả lời "tại sao chọn _X_ mà không dùng _Y_" cho mỗi công nghệ
