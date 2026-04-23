import { Router, type IRouter } from "express";
import { eq, asc, inArray } from "drizzle-orm";
import { db, ordersTable, orderItemsTable, customersTable, productsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

router.get("/admin/restock-queue", requireAuth, async (_req, res): Promise<void> => {
  const orders = await db.select()
    .from(ordersTable)
    .where(eq(ordersTable.status, "needs_manual_action"))
    .orderBy(asc(ordersTable.createdAt));

  if (orders.length === 0) {
    res.json({ data: [] });
    return;
  }

  const orderIds = orders.map(o => o.id);

  const [itemRows, customerRows] = await Promise.all([
    db.select({
      id: orderItemsTable.id,
      orderId: orderItemsTable.orderId,
      productId: orderItemsTable.productId,
      quantity: orderItemsTable.quantity,
      productName: productsTable.name,
    })
      .from(orderItemsTable)
      .leftJoin(productsTable, eq(orderItemsTable.productId, productsTable.id))
      .where(inArray(orderItemsTable.orderId, orderIds)),

    ((): Promise<Array<{ id: number; firstName: string | null; lastName: string | null; username: string | null; chatId: string | null }>> => {
      const customerIds = orders
        .map(o => o.customerId)
        .filter((id): id is number => id !== null && id !== undefined);
      if (customerIds.length === 0) return Promise.resolve([]);
      return db.select({
        id: customersTable.id,
        firstName: customersTable.firstName,
        lastName: customersTable.lastName,
        username: customersTable.username,
        chatId: customersTable.chatId,
      }).from(customersTable).where(inArray(customersTable.id, customerIds));
    })(),
  ]);

  const itemsByOrder = new Map<number, typeof itemRows>();
  for (const item of itemRows) {
    const list = itemsByOrder.get(item.orderId) ?? [];
    list.push(item);
    itemsByOrder.set(item.orderId, list);
  }

  const customerMap = new Map(customerRows.map(c => [c.id, c]));

  const data = orders.map(o => ({
    id: o.id,
    orderCode: o.orderCode,
    status: o.status,
    totalAmount: o.totalAmount,
    retryCount: o.retryCount,
    createdAt: o.createdAt,
    customer: o.customerId != null ? (customerMap.get(o.customerId) ?? null) : null,
    items: (itemsByOrder.get(o.id) ?? []).map(({ id, productId, quantity, productName }) => ({ id, productId, quantity, productName })),
  }));

  res.json({ data });
});

export default router;
