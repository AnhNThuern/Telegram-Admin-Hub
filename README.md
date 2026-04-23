# Telegram Admin Hub — Hệ thống bán hàng Telegram tự động

> Nền tảng thương mại điện tử hàng số hoàn chỉnh cho thị trường Việt Nam: Bot Telegram tích hợp thanh toán SePay/VietQR, Admin Panel dark-theme, giao hàng tự động và quản lý kho thời gian thực.

---

## Tính năng nổi bật

| Nhóm | Tính năng |
|---|---|
| **Bot Telegram** | Duyệt sản phẩm theo danh mục, đặt hàng, chọn số lượng, nhập mã giảm giá, hủy đơn |
| **Thanh toán** | QR chuyển khoản SePay · Ví nội bộ · Thanh toán số dư · Nạp tiền bằng QR |
| **Giao hàng số** | Tự động gửi nội dung sau khi xác nhận thanh toán · Retry sweep định kỳ |
| **Mã giảm giá** | Giảm theo % · Giảm số tiền cố định · Mua X Tặng Y (buy_x_get_y) |
| **Kho hàng** | Theo dõi tồn kho thời gian thực · Giới hạn số lượng mua đúng theo hàng còn lại |
| **Đa ngôn ngữ** | Tiếng Việt & Tiếng Anh · Khách tự chọn ngôn ngữ · Admin chỉnh chuỗi i18n trên UI |
| **Admin Panel** | Dashboard doanh thu · Quản lý đơn/khách/sản phẩm/kho/khuyến mãi · Báo cáo yêu cầu nhập hàng |

---

## Kiến trúc tổng quan

```
telegram-admin-hub/  (pnpm monorepo)
├── artifacts/
│   ├── admin-web/          # React 18 + Vite — Admin Panel (dark theme, tiếng Việt)
│   ├── api-server/         # Express + Telegram Bot + SePay webhook
│   └── mockup-sandbox/     # Vite component preview (dùng khi thiết kế UI)
├── lib/
│   ├── db/                 # Drizzle ORM schema + PostgreSQL migration
│   ├── api-spec/           # OpenAPI 3 spec (nguồn sự thật API)
│   ├── api-client-react/   # React Query client (sinh tự động từ spec)
│   └── api-zod/            # Zod validators (sinh tự động từ spec)
├── scripts/                # post-merge.sh, codegen helpers
├── pnpm-workspace.yaml
└── package.json
```

**Code generation:** Chỉnh `lib/api-spec/openapi.yaml` → chạy `pnpm codegen` → client + validator được cập nhật tự động.

---

## Yêu cầu môi trường

- **Node.js** >= 20
- **pnpm** >= 9 — `corepack enable && corepack prepare pnpm@latest --activate`
- **PostgreSQL** 14+ (Neon, Supabase, hoặc tự host)
- **Telegram Bot Token** — tạo qua [@BotFather](https://t.me/BotFather)
- **SePay account** _(tùy chọn)_ — [sepay.vn](https://sepay.vn), dùng cho đối soát chuyển khoản tự động
- **Domain HTTPS công khai** — để nhận webhook từ Telegram và SePay

---

## Cài đặt nhanh

```bash
# 1. Clone
git clone https://github.com/AnhNThuern/Telegram-Admin-Hub.git
cd Telegram-Admin-Hub

# 2. Cài dependency
pnpm install

# 3. Cấu hình biến môi trường (xem mục tiếp theo)
# Tạo file .env ở thư mục gốc

# 4. Đẩy schema lên database
pnpm --filter @workspace/db run push

# 5. Build các package dùng chung
pnpm --filter @workspace/db exec tsc --build
pnpm --filter @workspace/api-client-react run build
pnpm --filter @workspace/api-zod run build

# 6. Khởi động
pnpm --filter @workspace/api-server run dev     # API + Bot (cổng 8000)
pnpm --filter @workspace/admin-web run dev      # Admin Panel
```

---

## Biến môi trường

Tạo file `.env` ở thư mục gốc:

```env
# === Database ===
DATABASE_URL=postgres://user:pass@host:5432/dbname

# === Admin Panel ===
SESSION_SECRET=chuỗi-bí-mật-ít-nhất-32-ký-tự
ADMIN_USERNAME=admin
ADMIN_PASSWORD=mật-khẩu-mạnh

# === Domain công khai (cho webhook) ===
ADMIN_BASE_URL=https://your-domain.com
# Trên Replit: REPLIT_DOMAINS được set tự động, không cần khai báo.

# === Retry sweep (tùy chọn) ===
# Tần suất quét đơn tồn đọng (phút). Mặc định: 20, tối thiểu: 1.
RETRY_SWEEP_INTERVAL_MINUTES=20
```

> **Lưu ý:** Token Telegram và thông tin SePay được admin nhập trực tiếp trên giao diện (lưu vào DB), **không** khai báo trong `.env`.

---

## Cấu hình lần đầu

### 1. Đăng nhập Admin Panel

Truy cập `https://your-domain.com` → đăng nhập bằng `ADMIN_USERNAME` / `ADMIN_PASSWORD`.

### 2. Kết nối Telegram Bot

1. Vào [@BotFather](https://t.me/BotFather) → `/newbot` → nhận token dạng `123456789:ABC...`
2. Admin Panel → **Cài đặt → Bot** → dán token → bấm **Test Token**
3. Bấm **Set Webhook** — hệ thống tự đăng ký URL `https://your-domain.com/api/bot/webhook` với Telegram
4. _(Tùy chọn)_ Nhập **Admin Chat ID** để nhận thông báo đơn cần xử lý

### 3. Cấu hình SePay _(tùy chọn)_

1. Đăng ký SePay, kết nối tài khoản ngân hàng cần đối soát
2. Admin Panel → **Cài đặt → Thanh toán** → nhập: tên ngân hàng, số tài khoản, chủ TK, mã ngân hàng (VD: `MBBank`)
3. Trên dashboard SePay, thêm webhook:
   - URL: `https://your-domain.com/api/payments/sepay/webhook`
   - Phương thức: **POST**

### 4. Tạo sản phẩm & nhập kho

1. **Danh mục** → Tạo category (VD: Tài khoản Premium, Key bản quyền…)
2. **Sản phẩm** → Thêm sản phẩm: tên, icon, giá, danh mục, số lượng min/max, mô tả
3. **Kho hàng** → Paste hàng loạt nội dung số (mỗi dòng = 1 item)
4. Sản phẩm có tồn kho > 0 tự xuất hiện trong bot; hết hàng tự ẩn nút mua

---

## Luồng khách hàng (Telegram Bot)

```
/start
  └─► Menu chính
        ├─► 🛍️ Xem sản phẩm
        │     └─► Chọn danh mục → Chọn sản phẩm → Chọn số lượng
        │               └─► Màn xác nhận đơn
        │                     ├─► [Nhập mã giảm giá] → Cập nhật tổng tiền
        │                     ├─► Thanh toán bằng số dư ví
        │                     ├─► Chuyển khoản → QR VietQR
        │                     │     └─► SePay webhook → Giao hàng tự động
        │                     └─► ❌ Hủy đơn
        ├─► 📋 Đơn hàng của tôi
        ├─► 💰 Ví & nạp tiền  (/naptien [số tiền])
        ├─► 📜 Lịch sử giao dịch  (/lichsu)
        └─► ⚙️ Cài đặt
              └─► 🌐 Chọn ngôn ngữ  (/language  hoặc  /lang)
```

### Danh sách lệnh bot

| Lệnh | Chức năng |
|---|---|
| `/start` | Mở menu chính |
| `/naptien [số tiền]` | Sinh QR nạp tiền ví (VD: `/naptien 100000`) |
| `/lichsu` | Xem 10 giao dịch ví gần nhất |
| `/cancel` | Hủy đơn hàng đang chờ thanh toán |
| `/language` hoặc `/lang` | Chuyển ngôn ngữ (Tiếng Việt / English) |

### Trạng thái đơn hàng

```
pending ──► paid ──► delivered          ✅ Thành công
        └──► expired / cancelled        ❌ Hết hạn / Khách hủy
paid ──► needs_manual_action            ⚠️ Hết kho khi giao
       └──► retry_exhausted             ❌ Hết lần thử lại
```

### Mã giảm giá

| Loại | Mô tả | Ví dụ |
|---|---|---|
| `percentage` | Giảm theo % trên tổng đơn | Mã SALE10 → giảm 10% |
| `fixed` | Giảm số tiền cố định | Mã GIAM20K → giảm 20.000đ |
| `buy_x_get_y` | Mua X tặng Y — tính theo bộ | Mã 1TANG1 → mua 2 trả tiền 1 |

---

## Tính năng Admin Panel

### Dashboard
- Doanh thu hôm nay, 7 ngày, 30 ngày kèm biểu đồ
- Số đơn theo từng trạng thái

### Đơn hàng
- Lọc theo trạng thái, tìm theo mã đơn / SĐT / tên khách
- Nút **Thử lại ngay** — chạy delivery sweep ngay lập tức
- Xem chi tiết nội dung số đã giao từng đơn

### Khách hàng
- Quản lý ví: điều chỉnh số dư thủ công (có ghi chú lý do)
- Xem lịch sử giao dịch từng khách
- Theo dõi ngôn ngữ khách đã chọn

### Sản phẩm & Kho
- Icon riêng cho từng sản phẩm (hiển thị ở cột danh sách)
- Paste hàng loạt nội dung số vào kho
- Theo dõi tồn kho thời gian thực
- Xem số lượt **yêu cầu nhập hàng** từ khách khi sản phẩm hết

### Khuyến mãi
- Tạo / sửa / xóa mã giảm giá với đầy đủ 3 loại: `percentage`, `fixed`, `buy_x_get_y`
- Thiết lập ngày bắt đầu/kết thúc, giới hạn tổng lượt dùng

### Cài đặt ngôn ngữ (i18n)
- Chỉnh toàn bộ chuỗi thông báo bot trực tiếp trên Admin Panel (không cần sửa code)
- Song ngữ Việt / Anh cho từng key
- Thay đổi có hiệu lực ngay, không cần restart server

### Cài đặt khác
- **Bot:** token Telegram, webhook URL, admin chat ID
- **Thanh toán:** thông tin SePay và ngân hàng
- **Bảo mật:** đổi mật khẩu admin

---

## Auto-retry Sweep

Cơ chế tự động phát hiện và giao lại đơn bị kẹt (`paid` nhưng chưa giao do hết kho tại thời điểm thanh toán):

- Chạy định kỳ theo `RETRY_SWEEP_INTERVAL_MINUTES` (mặc định 20 phút)
- Khi nhập thêm kho → tự giao và thông báo khách qua Telegram
- Sau khi hết số lần thử → chuyển sang `retry_exhausted`, thông báo admin xử lý thủ công
- Admin có thể kích hoạt sweep ngay từ trang Đơn hàng

---

## Lệnh phát triển thường dùng

```bash
# Chạy (cần 2 terminal riêng)
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/admin-web run dev

# Sinh lại API client sau khi sửa openapi.yaml
pnpm --filter @workspace/api-spec run codegen

# Đẩy thay đổi schema lên DB
pnpm --filter @workspace/db run push

# Rebuild package db sau khi sửa Drizzle schema
pnpm --filter @workspace/db exec tsc --build

# Typecheck
cd artifacts/api-server && pnpm exec tsc --noEmit
cd artifacts/admin-web  && pnpm exec tsc --noEmit
```

---

## Triển khai

### Replit _(khuyến nghị)_

1. Bấm **Publish** → Replit cấp domain `*.replit.app`
2. Admin Panel → **Cài đặt → Bot** → bấm **Set Webhook** để cập nhật URL production
3. Cập nhật webhook SePay sang URL production

### Self-host

```bash
# Build tất cả artifacts
pnpm -r run build

# Chạy API server
cd artifacts/api-server && node dist/index.js
```

Cần reverse proxy HTTPS (Caddy hoặc Nginx) trước API server. Serve `admin-web/dist` qua CDN hoặc Nginx static.

---

## Bảo trì & Gỡ lỗi

| Triệu chứng | Cách xử lý |
|---|---|
| Bot không phản hồi | Cài đặt → Bot → bấm **Set Webhook** lại; kiểm tra log API server |
| Đơn không tự giao sau chuyển tiền | Kiểm tra log SePay webhook; nội dung chuyển khoản phải chứa mã `SHOP{id}` hoặc `TOPUP{id}` |
| Đơn kẹt ở trạng thái `paid` | Bấm **Thử lại ngay** trên trang Đơn hàng, hoặc nhập thêm kho rồi đợi sweep tiếp theo |
| Quên mật khẩu admin | Kết nối DB trực tiếp, cập nhật `password_hash` trong bảng `admin_users` bằng bcrypt hash mới |
| Thông báo bot sai ngôn ngữ hoặc nội dung | Admin Panel → **Cài đặt → Ngôn ngữ** → sửa trực tiếp chuỗi i18n |

---

## Tech Stack

| Lớp | Công nghệ |
|---|---|
| **Admin UI** | React 18, Vite, TypeScript, TailwindCSS, shadcn/ui, TanStack Query |
| **Backend** | Node.js 20, Express, TypeScript |
| **Database** | PostgreSQL + Drizzle ORM |
| **API contract** | OpenAPI 3 → openapi-typescript-codegen + Zod (tự động sinh) |
| **Bot** | Telegram Bot API (webhook) |
| **Thanh toán** | SePay webhook + VietQR |
| **Monorepo** | pnpm workspaces + TypeScript project references |

---

## Giấy phép

Mã nguồn nội bộ — vui lòng liên hệ chủ sở hữu trước khi tái sử dụng hoặc phân phối lại.

---

> Báo lỗi hoặc đề xuất tính năng: mở **Issue** hoặc **Pull Request** trên repository.
