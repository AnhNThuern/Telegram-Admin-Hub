import { pgTable, serial, text, timestamp, boolean, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const paymentConfigsTable = pgTable("payment_configs", {
  id: serial("id").primaryKey(),
  provider: text("provider").notNull().default("sepay"),
  bankName: text("bank_name"),
  bankCode: text("bank_code"),
  accountNumber: text("account_number"),
  accountHolder: text("account_holder"),
  webhookSecret: text("webhook_secret"),
  apiKey: text("api_key"),
  isActive: boolean("is_active").notNull().default(false),
  binanceApiKey: text("binance_api_key"),
  binanceApiSecret: text("binance_api_secret"),
  binanceMerchantTradeNoPrefix: text("binance_merchant_trade_no_prefix").default("SHOP"),
  binanceIsActive: boolean("binance_is_active").notNull().default(false),
  usdtRate: numeric("usdt_rate", { precision: 12, scale: 4 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertPaymentConfigSchema = createInsertSchema(paymentConfigsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPaymentConfig = z.infer<typeof insertPaymentConfigSchema>;
export type PaymentConfig = typeof paymentConfigsTable.$inferSelect;
