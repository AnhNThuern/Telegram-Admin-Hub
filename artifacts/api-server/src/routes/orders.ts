import { Router, type IRouter } from "express";
import { eq, and, desc, count, sql, or, inArray } from "drizzle-orm";
import { db, ordersTable, orderItemsTable, customersTable, transactionsTable, botLogsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { validateParams, validateQuery } from "../middlewares/validate";
import {
  ListOrdersQueryParams,
  GetOrderParams,
} from "@workspace/api-zod";
import type z from "zod";

const router: IRouter = Router();

router.get("/orders", requireAuth, validateQuery(ListOrdersQueryParams), async (req, res): Promise<void> => {
  const { page, limit, status, customerId } = res.locals["query"] as z.infer<typeof ListOrdersQueryParams>;
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

  // Actions that store orderId directly in metadata (single-order logs)
  const DIRECT_RETRY_ACTIONS = [
    "delivery_failed",
    "retry_delivery_sent",
    "restock_retry_delivered",
    "restock_retry_failed",
    "scheduled_retry_delivered",
    "scheduled_retry_failed",
    "scheduled_retry_exception",
  ];

  // Fetch direct per-order retry logs
  const directRetryLogs = await db.select().from(botLogsTable).where(
    and(
      sql`${botLogsTable.metadata}->>'orderId' = ${id.toString()}`,
      inArray(botLogsTable.action, DIRECT_RETRY_ACTIONS)
    )
  ).orderBy(botLogsTable.createdAt);

  // Fetch restock_retry_triggered logs whose orderIds array contains this order id
  const restockTriggerLogs = await db.select().from(botLogsTable).where(
    and(
      eq(botLogsTable.action, "restock_retry_triggered"),
      sql`${botLogsTable.metadata}->'orderIds' @> ${JSON.stringify([id])}::jsonb`
    )
  ).orderBy(botLogsTable.createdAt);

  // Merge and sort chronologically
  const retryLogs = [...directRetryLogs, ...restockTriggerLogs].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  // Retry count = number of actual RETRY attempts (excludes the initial delivery_failed;
  // only counts results from subsequent retry flows)
  const RETRY_RESULT_ACTIONS = [
    "retry_delivery_sent",
    "restock_retry_delivered",
    "restock_retry_failed",
    "scheduled_retry_delivered",
    "scheduled_retry_failed",
    "scheduled_retry_exception",
  ];
  const retryCount = directRetryLogs.filter(log => RETRY_RESULT_ACTIONS.includes(log.action)).length;

  res.json({ ...order, items, customer: customer ?? null, transaction: transaction ?? null, retryCount, retryLogs });
});

export default router;
