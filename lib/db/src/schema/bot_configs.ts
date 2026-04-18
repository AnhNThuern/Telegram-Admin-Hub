import { pgTable, serial, text, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const botConfigsTable = pgTable("bot_configs", {
  id: serial("id").primaryKey(),
  botToken: text("bot_token"),
  botUsername: text("bot_username"),
  webhookUrl: text("webhook_url"),
  webhookSecretToken: text("webhook_secret_token"),
  isConnected: boolean("is_connected").notNull().default(false),
  webhookStatus: text("webhook_status").default("not_set"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertBotConfigSchema = createInsertSchema(botConfigsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertBotConfig = z.infer<typeof insertBotConfigSchema>;
export type BotConfig = typeof botConfigsTable.$inferSelect;
