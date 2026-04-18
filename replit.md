# Workspace

## Overview

Vietnamese-language Telegram commerce admin system. Dark-themed admin web UI + REST API backend + Telegram bot customer flow + SePay payment integration + automated digital-goods delivery.

**Core flow:** Admin adds products → Bot shows them to customers → User orders → SePay processes payment → Bot auto-delivers stock content.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (ESM bundle via `build.mjs`)
- **Auth**: express-session + bcrypt (7-day cookies)
- **Logging**: pino

## Packages

| Package | Path | Purpose |
|---|---|---|
| `@workspace/db` | `lib/db` | Drizzle schema + DB client |
| `@workspace/api-spec` | `lib/api-spec` | OpenAPI spec + Orval codegen |
| `@workspace/api-zod` | `lib/api-zod` | Zod schemas generated from OpenAPI |
| `@workspace/api-server` | `artifacts/api-server` | Express API server |
| `@workspace/mockup-sandbox` | `artifacts/mockup-sandbox` | Vite component preview server |

## Database Schema (12 tables)

- `admins` — admin accounts (username + bcrypt hash)
- `categories` — product categories with icon + sort
- `products` — digital goods with price, stock type, metadata
- `product_stocks` — individual stock lines (content delivered to buyer)
- `customers` — Telegram users (chatId, balance, stats)
- `orders` — orders with status machine (pending→paid→delivering→delivered)
- `order_items` — line items per order
- `transactions` — payment ledger (SePay webhooks + manual)
- `promotions` — discount codes (percent/fixed, usage limits)
- `bot_configs` — Telegram bot token + webhook state
- `payment_configs` — SePay credentials
- `bot_logs` — Telegram update audit log

## API Routes (all under `/api/`)

- `GET /healthz` — health check (no auth)
- `POST /auth/login`, `GET /auth/me`, `POST /auth/logout`, `PUT /auth/password`
- `GET /dashboard/stats`
- `GET/POST/PUT/DELETE /categories`
- `GET/POST/PUT/DELETE /products` + `GET/POST /products/:id/stocks`
- `GET/PUT/DELETE /customers`
- `GET/PUT/POST /orders` + `/orders/:id/deliver`
- `GET /transactions` + `/transactions/:id`
- `GET/POST/PUT/DELETE /promotions`
- `GET/POST /bot/config` + `/bot/test-token`, `/bot/set-webhook`, `/bot/disconnect`, `/bot/webhook`
- `GET/POST /payments/config` + `/payments/webhook` (SePay)

## Default Credentials

- **Admin login:** `admin` / `admin123`
- Seeded on first startup automatically

## Demo Data (seeded on first run)

- 2 categories (Game Accounts, Software Keys)
- 3 products (PUBG Mobile, Genshin Impact, Windows 11)
- 20 stock lines across 3 products
- 2 customers
- 3 orders (1 delivered, 1 paid, 1 pending)
- 3 transactions

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

## Project Status

- [x] Task #1: Foundation (DB schema, OpenAPI spec, Express API server, auth, all routes, seeding)
- [ ] Task #2: Admin Web UI (dark-themed React frontend)
- [ ] Task #3: Telegram Bot Commerce Flow
- [ ] Task #4: SePay Payment Integration

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
