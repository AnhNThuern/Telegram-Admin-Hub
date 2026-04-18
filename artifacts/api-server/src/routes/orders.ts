import { Router, type IRouter } from "express";
import { eq, and, desc, count } from "drizzle-orm";
import { db, ordersTable, orderItemsTable, customersTable, transactionsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { validateParams, validateQuery } from "../middlewares/validate";
import {
  ListOrdersQueryParams,
  GetOrderParams,
} from "@workspace/api-zod";
import type z from "zod";

const router: IRouter = Router();

router.get("/orders", requireAuth, validateQuery(ListOrdersQueryParams), async (req, res): Promise<void> => {
  const { page, limit, status, customerId } = req.query as unknown as z.infer<typeof ListOrdersQueryParams>;
  const offset = (page - 1) * limit;

  const conditions = [];
  if (status) conditions.push(eq(ordersTable.status, status));
  if (customerId) conditions.push(eq(ordersTable.customerId, customerId));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [totalRow] = await db.select({ count: count() }).from(ordersTable).where(where);
  const data = await db.select().from(ordersTable).where(where).orderBy(desc(ordersTable.createdAt)).limit(limit).offset(offset);

  res.json({ data, total: totalRow?.count ?? 0, page, limit });
});

router.get("/orders/:id", requireAuth, validateParams(GetOrderParams), async (req, res): Promise<void> => {
  const { id } = req.params as unknown as z.infer<typeof GetOrderParams>;
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, id));
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  const items = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, id));
  const [customer] = order.customerId
    ? await db.select().from(customersTable).where(eq(customersTable.id, order.customerId))
    : [null];
  const [transaction] = await db.select().from(transactionsTable).where(eq(transactionsTable.orderId, id));

  res.json({ ...order, items, customer: customer ?? null, transaction: transaction ?? null });
});

export default router;
