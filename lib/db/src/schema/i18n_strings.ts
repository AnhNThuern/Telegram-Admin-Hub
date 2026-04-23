import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const i18nStringsTable = pgTable("i18n_strings", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  vi: text("vi").notNull().default(""),
  en: text("en").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertI18nStringSchema = createInsertSchema(i18nStringsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertI18nString = z.infer<typeof insertI18nStringSchema>;
export type I18nString = typeof i18nStringsTable.$inferSelect;
