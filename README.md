# Tan Nguyen Bot — Hệ thống bán hàng Telegram tự động

Hệ thống quản trị thương mại điện tử qua Telegram cho thị trường Việt Nam, gồm:

- **Admin Panel** (web, dark theme) — quản lý sản phẩm, kho, đơn hàng, khách hàng, cấu hình bot/SePay.
- **Telegram Bot** — luồng mua hàng cho khách: duyệt sản phẩm → đặt đơn → thanh toán → tự động giao hàng số.
- **API Server** — Express + Drizzle ORM, xử lý webhook SePay, giao hàng tự động, retry sweep.
- **SePay Integration** — sinh QR chuyển khoản, đối soát biến động số dư qua webhook.
- **Ví khách hàng** — nạp tiền qua QR, thanh toán đơn bằng số dư, lịch sử giao dịch.

---

## 1. Kiến trúc tổng quan

```
tannguyen-bot/  (pnpm monorepo)
├── artifacts/
│   ├── admin-web/          # React + Vite admin panel (tiếng Việt, dark theme)
│   ├── api-server/         # Express API + Telegram bot + SePay webhook
│   └── mockup-sandbox/     # Vite component preview (cho design)
├── lib/
│   ├── db/                 # Drizzle schema + migration (PostgreSQL)
│   ├── api-spec/           # OpenAPI 3 spec (nguồn sự thật)
│   ├── api-client-react/   # Generated React Query client
│   └── api-zod/            # Generated Zod validators
├── scripts/                # post-merge, codegen helpers
├── pnpm-workspace.yaml
└── package.json
```

Quy trình code generation: chỉnh sửa `lib/api-spec/openapi.yaml` → chạy `pnpm codegen` → React client + Zod validator được sinh tự động.

---

## 2. Yêu cầu môi trường

- **Node.js** >= 20
- **pnpm** >= 9 (`corepack enable && corepack prepare pnpm@latest --activate`)
- **PostgreSQL** 14+ (khuyến nghị Neon hoặc Postgres cloud)
- **Telegram Bot Token** (tạo qua [@BotFather](https://t.me/BotFather))
- **SePay account** (tuỳ chọn, dùng cho thanh toán tự động — [sepay.vn](https://sepay.vn))
- **Domain HTTPS công khai** để nhận webhook từ Telegram và SePay

---

## 3. Cài đặt nhanh

```bash
# 1. Clone
git clone https://github.com/TanUIUX/tannguyen---bot.git
cd tannguyen---bot

# 2. Cài dependency
pnpm install

# 3. Cấu hình biến môi trường (xem mục 4)
cp .env.example .env   # nếu có; nếu không, tạo mới theo mục 4

# 4. Chạy migration database
pnpm --filter @workspace/db run push

# 5. Build các package shared
pnpm --filter @workspace/db exec tsc --build
pnpm --filter @workspace/api-client-react run build
pnpm --filter @workspace/api-zod run build

# 6. Khởi động đồng thời 3 service
pnpm --filter @workspace/api-server run dev          # API + bot webhook
pnpm --filter @workspace/admin-web run dev           # Admin panel
pnpm --filter @workspace/mockup-sandbox run dev      # (tuỳ chọn) preview UI
```

---

## 4. Biến môi trường

Tạo file `.env` ở thư mục gốc với nội dung tối thiểu:

```env
# === Database ===
DATABASE_URL=postgres://user:pass@host:5432/dbname

# === Admin Panel session ===
SESSION_SECRET=chuỗi-bí-mật-dài-tối-thiểu-32-ký-tự
ADMIN_USERNAME=admin
ADMIN_PASSWORD=mật-khẩu-mạnh

# === Public domain (cho webhook) ===
ADMIN_BASE_URL=https://your-domain.com
# Hoặc trên Replit: REPLIT_DOMAINS được set tự động

# === Retry sweep ===
# Tần suất quét đơn còn tồn (phút). Mặc định 20, tối thiểu 1.
RETRY_SWEEP_INTERVAL_MINUTES=20

# === Telegram bot token ===
# KHÔNG đặt ở đây — admin nhập trực tiếp trong /settings/bot
# và token được lưu vào DB.

# === SePay webhook ===
# Cấu hình trong /settings/payment, không phải biến môi trường.
```

> **Lưu ý**: Telegram bot token và SePay credentials được lưu trong database (table `bot_config` / `payment_config`) chứ không qua biến môi trường — admin nhập trên giao diện.

---

## 5. Cấu hình lần đầu

### 5.1. Đăng nhập Admin Panel

Truy cập `https://your-domain.com` → đăng nhập với `ADMIN_USERNAME` / `ADMIN_PASSWORD`.

### 5.2. Kết nối Telegram Bot

1. Vào [@BotFather](https://t.me/BotFather) → `/newbot` → nhận token dạng `123456789:ABC...`.
2. Vào **Cài đặt → Bot** trong Admin Panel.
3. Dán token → bấm **Test Token** (kiểm tra hợp lệ).
4. Bấm **Set Webhook** — hệ thống tự đăng ký URL `https://your-domain.com/api/bot/webhook` với Telegram.
5. (Tuỳ chọn) Nhập **Admin Chat ID** để nhận thông báo đơn cần xử lý.

### 5.3. Cấu hình SePay (tuỳ chọn)

1. Đăng ký tài khoản SePay, kết nối ngân hàng cần đối soát.
2. Vào **Cài đặt → Thanh toán** trong Admin Panel.
3. Nhập tên ngân hàng, số tài khoản, chủ TK, mã ngân hàng (VD: `MBBank`).
4. Trên trang quản trị SePay, cấu hình webhook:
   - URL: `https://your-domain.com/api/payments/sepay/webhook`
   - Phương thức: POST

### 5.4. Tạo sản phẩm & kho

1. **Danh mục** → tạo các category (vd: Tài khoản, Key bản quyền…).
2. **Sản phẩm** → thêm sản phẩm: tên, giá, danh mục, min/max quantity.
3. **Kho hàng** → upload nội dung số (mỗi dòng = 1 item, có thể paste hàng loạt).
4. Sản phẩm có kho > 0 sẽ tự xuất hiện trong bot.

---

## 6. Luồng khách hàng (Telegram bot)

| Thao tác | Phản hồi của bot |
|---|---|
| `/start` | Menu chính: Xem sản phẩm, Đơn hàng, Lịch sử ví |
| Chọn sản phẩm → số lượng | Hiển thị tổng tiền + 2 lựa chọn: trả bằng số dư hoặc chuyển khoản |
| Chuyển khoản | Bot gửi QR code SePay với mã tham chiếu duy nhất `SHOP{orderId}{ts}` |
| `/naptien 100000` | Bot gửi QR nạp tiền với mã `TOPUP{customerId}{ts}` |
| `/lichsu` | Hiển thị 10 giao dịch ví gần nhất (nạp tiền + thanh toán) |
| Sau khi chuyển khoản | SePay webhook → đối soát mã tham chiếu → đánh dấu đơn `paid` → tự động giao hàng số |

### Trạng thái đơn

`pending` → `paid` → `delivered` (thành công)
`pending` → `expired` / `cancelled` (huỷ)
`paid` → `needs_manual_action` → `confirmed_not_delivered` / `retry_exhausted` (hết kho khi giao)

---

## 7. Tính năng quản trị

- **Dashboard** — doanh thu hôm nay, tuần, tháng + biểu đồ.
- **Đơn hàng** — lọc theo trạng thái, tìm theo mã/SĐT/tên khách, nút **Thử lại ngay** (Retry Now) để chạy sweep ngay.
- **Khách hàng** — quản lý ví, điều chỉnh số dư có ghi chú, xem lịch sử giao dịch.
- **Sản phẩm & Kho** — paste hàng loạt, theo dõi tồn kho, ngừng bán.
- **Cài đặt** — bot, thanh toán, retry sweep, admin password.
- **Auto-retry sweep** — quét định kỳ (mặc định 20 phút) các đơn đã thanh toán nhưng chưa giao do hết kho, tự động giao khi có hàng mới và thông báo cho admin.

---

## 8. Lệnh thường dùng

```bash
# Chạy dev tất cả
pnpm dev

# Chỉ chạy 1 artifact
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/admin-web run dev

# Sinh lại API client từ openapi.yaml
pnpm --filter @workspace/api-spec run codegen

# Đẩy schema thay đổi lên DB
pnpm --filter @workspace/db run push

# Rebuild package db sau khi sửa schema
pnpm --filter @workspace/db exec tsc --build

# Typecheck toàn dự án
pnpm -r exec tsc --noEmit
```

---

## 9. Triển khai (Deployment)

Dự án được tối ưu cho **Replit Deployments**:

1. Bấm **Publish** trên giao diện Replit.
2. Nền tảng tự build và cấp domain `*.replit.app` (hoặc dùng custom domain).
3. Sau khi publish, vào Admin Panel → bấm lại **Set Webhook** để Telegram trỏ về domain production.
4. Cập nhật webhook SePay sang URL production.

Để self-host: build từng artifact (`pnpm -r run build`), serve `admin-web` qua CDN/static, chạy `api-server` bằng `node dist/index.js` với reverse proxy HTTPS (Caddy/Nginx).

---

## 10. Bảo trì & gỡ lỗi

- **Bot không phản hồi** → kiểm tra webhook URL trong `/settings/bot`, bấm Set Webhook lại; xem log API server.
- **Đơn không tự giao sau khi chuyển tiền** → kiểm tra log SePay webhook; mã tham chiếu phải khớp định dạng `SHOP*` hoặc `TOPUP*`.
- **Đơn kẹt ở `paid`** → chạy thủ công nút **Thử lại ngay** trên trang Đơn hàng, hoặc đợi sweep tự động tiếp theo.
- **Reset password admin** → kết nối DB và update column `password_hash` trong table `admin_users` (dùng bcrypt).

---

## 11. Tech stack

| Lớp | Công nghệ |
|---|---|
| Frontend admin | React 18, Vite, TypeScript, TailwindCSS, shadcn/ui, React Query |
| Backend | Node.js 20, Express, TypeScript |
| Database | PostgreSQL + Drizzle ORM |
| API contract | OpenAPI 3 + openapi-typescript-codegen + Zod |
| Bot | Telegram Bot API (HTTP polling/webhook) |
| Thanh toán | SePay webhook + QR VietQR |
| Monorepo | pnpm workspaces + TypeScript project references |

---

## 12. Giấy phép

Mã nguồn nội bộ — vui lòng liên hệ chủ sở hữu trước khi tái sử dụng.

---

> Mọi đóng góp / báo lỗi xin gửi qua Issues hoặc Pull Request trên repository.
