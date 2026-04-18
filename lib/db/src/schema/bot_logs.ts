import { pgTable, serial, text, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { customersTable } from "./customers";

export const botLogsTable = pgTable("bot_logs", {
  id: serial("id").primaryKey(),
  action: text("action").notNull(),
  customerId: integer("customer_id").references(() => customersTable.id),
  chatId: text("chat_id"),
  content: text("content"),
  metadata: jsonb("metadata"),
  level: text("level").notNull().default("info"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertBotLogSchema = createInsertSchema(botLogsTable).omit({ id: true, createdAt: true });
export type InsertBotLog = z.infer<typeof insertBotLogSchema>;
export type BotLog = typeof botLogsTable.$inferSelect;
