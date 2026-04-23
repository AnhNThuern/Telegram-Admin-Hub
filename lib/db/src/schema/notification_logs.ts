import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { productsTable } from "./products";

export const notificationLogsTable = pgTable("notification_logs", {
  id: serial("id").primaryKey(),
  productId: integer("product_id").notNull().references(() => productsTable.id, { onDelete: "cascade" }),
  audience: text("audience").notNull(),
  sent: integer("sent").notNull().default(0),
  total: integer("total").notNull().default(0),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
});

export type NotificationLog = typeof notificationLogsTable.$inferSelect;
export type InsertNotificationLog = typeof notificationLogsTable.$inferInsert;
