import { Router, type IRouter } from "express";
import { eq, and, desc, count, sql, or, inArray, gt } from "drizzle-orm";
import { db, ordersTable, orderItemsTable, customersTable, transactionsTable, botLogsTable, promotionsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { validateParams, validateQuery } from "../middlewares/validate";
import {
  ListOrdersQueryParams,
  GetOrderParams,
} from "@workspace/api-zod";
import type z from "zod";

const router: IRouter = Router();

router.get("/orders", requireAuth, validateQuery(ListOrdersQueryParams), async (req, res): Promise<void> => {
  const { page, limit, status, customerId, hasRetries } = res.locals["query"] as z.infer<typeof ListOrdersQueryParams>;
  const offset = (page - 1) * limit;

  const conditions = [];
  if (status) conditions.push(eq(ordersTable.status, status));
  if (customerId) conditions.push(eq(ordersTable.customerId, customerId));
  if (hasRetries) conditions.push(gt(ordersTable.retryCount, 0));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [totalRow] = await db.select({ count: count() }).from(ordersTable).where(where);
  const rows = await db
    .select({
      order: ordersTable,
      promotionCode: promotionsTable.code,
    })
    .from(ordersTable)
    .leftJoin(promotionsTable, eq(promotionsTable.id, ordersTable.promotionId))
    .where(where)
    .orderBy(desc(ordersTable.createdAt))
    .limit(limit)
    .offset(offset);

  const data = rows.map((r) => ({ ...r.order, promotionCode: r.promotionCode ?? null }));

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
  const [promotion] = order.promotionId
    ? await db
        .select({ id: promotionsTable.id, code: promotionsTable.code, name: promotionsTable.name })
        .from(promotionsTable)
        .where(eq(promotionsTable.id, order.promotionId))
    : [null];

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

  // retryCount is now persisted on the order itself (incremented inside deliverOrder
  // for each isRetry attempt). bot_logs are still returned for the detailed history view.
  res.json({
    ...order,
    items,
    customer: customer ?? null,
    transaction: transaction ?? null,
    promotion: promotion ?? null,
    retryCount: order.retryCount,
    retryLogs,
  });
});

export default router;
