import { pgTable, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const systemSettingsTable = pgTable("system_settings", {
  id: serial("id").primaryKey(),
  maxRetryCount: integer("max_retry_count").notNull().default(10),
  maxOrderAgeDays: integer("max_order_age_days").notNull().default(7),
  stockRequestWindowHours: integer("stock_request_window_hours").notNull().default(24),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type SystemSettings = typeof systemSettingsTable.$inferSelect;

export const updateSystemSettingsSchema = z.object({
  maxRetryCount: z.number().int().min(1).max(1000),
  maxOrderAgeDays: z.number().int().min(1).max(365),
  stockRequestWindowHours: z.number().int().min(1).max(168),
});
export type UpdateSystemSettings = z.infer<typeof updateSystemSettingsSchema>;
