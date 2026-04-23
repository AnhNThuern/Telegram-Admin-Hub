import { pgTable, serial, text, timestamp, boolean, numeric, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const customersTable = pgTable("customers", {
  id: serial("id").primaryKey(),
  chatId: text("chat_id").notNull().unique(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  username: text("username"),
  balance: numeric("balance", { precision: 12, scale: 2 }).notNull().default("0"),
  totalSpent: numeric("total_spent", { precision: 12, scale: 2 }).notNull().default("0"),
  totalOrders: integer("total_orders").notNull().default(0),
  language: text("language").notNull().default("vi"),
  lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertCustomerSchema = createInsertSchema(customersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCustomer = z.infer<typeof insertCustomerSchema>;
export type Customer = typeof customersTable.$inferSelect;
