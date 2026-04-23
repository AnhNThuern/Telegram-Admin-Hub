import { Router, type IRouter } from "express";
import { count, desc, eq } from "drizzle-orm";
import { db, productsTable, ordersTable, customersTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

router.get("/dashboard/stats", requireAuth, async (_req, res): Promise<void> => {
  const [productCount] = await db.select({ count: count() }).from(productsTable);
  const [orderCount] = await db.select({ count: count() }).from(ordersTable);
  const [customerCount] = await db.select({ count: count() }).from(customersTable);

  const allOrders = await db.select({ totalAmount: ordersTable.totalAmount, status: ordersTable.status }).from(ordersTable);
  const totalRevenue = allOrders
    .filter(o => o.status === "paid" || o.status === "delivered")
    .reduce((sum, o) => sum + parseFloat(o.totalAmount ?? "0"), 0)
    .toFixed(2);

  const recentOrderRows = await db
    .select({
      id: ordersTable.id,
      orderCode: ordersTable.orderCode,
      totalAmount: ordersTable.totalAmount,
      status: ordersTable.status,
      createdAt: ordersTable.createdAt,
      customerFirstName: customersTable.firstName,
      customerUsername: customersTable.username,
    })
    .from(ordersTable)
    .leftJoin(customersTable, eq(ordersTable.customerId, customersTable.id))
    .orderBy(desc(ordersTable.createdAt))
    .limit(5);

  const recentOrders = recentOrderRows.map(o => ({
    id: o.id,
    orderCode: o.orderCode,
    totalAmount: o.totalAmount,
    status: o.status,
    customerName: o.customerFirstName ?? o.customerUsername ?? null,
    createdAt: o.createdAt,
  }));

  const newCustomers = await db
    .select()
    .from(customersTable)
    .orderBy(desc(customersTable.createdAt))
    .limit(5);

  res.json({
    totalProducts: productCount?.count ?? 0,
    totalOrders: orderCount?.count ?? 0,
    totalCustomers: customerCount?.count ?? 0,
    totalRevenue,
    recentOrders,
    newCustomers,
  });
});

export default router;
