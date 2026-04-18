import { Router, type IRouter } from "express";
import { eq, asc } from "drizzle-orm";
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

  const data = await Promise.all(orders.map(async (o) => {
    const items = await db.select({
      id: orderItemsTable.id,
      productId: orderItemsTable.productId,
      quantity: orderItemsTable.quantity,
      productName: productsTable.name,
    })
      .from(orderItemsTable)
      .leftJoin(productsTable, eq(orderItemsTable.productId, productsTable.id))
      .where(eq(orderItemsTable.orderId, o.id));

    const [customer] = o.customerId
      ? await db.select({
          id: customersTable.id,
          firstName: customersTable.firstName,
          lastName: customersTable.lastName,
          username: customersTable.username,
          chatId: customersTable.chatId,
        }).from(customersTable).where(eq(customersTable.id, o.customerId))
      : [null];

    return {
      id: o.id,
      orderCode: o.orderCode,
      status: o.status,
      totalAmount: o.totalAmount,
      retryCount: o.retryCount,
      createdAt: o.createdAt,
      customer: customer ?? null,
      items,
    };
  }));

  res.json({ data });
});

export default router;
