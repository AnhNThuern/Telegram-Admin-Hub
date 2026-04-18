import { pgTable, serial, text, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { productsTable } from "./products";

export const productStocksTable = pgTable("product_stocks", {
  id: serial("id").primaryKey(),
  productId: integer("product_id").notNull().references(() => productsTable.id),
  content: text("content").notNull(),
  status: text("status").notNull().default("available"),
  orderId: integer("order_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertProductStockSchema = createInsertSchema(productStocksTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProductStock = z.infer<typeof insertProductStockSchema>;
export type ProductStock = typeof productStocksTable.$inferSelect;
