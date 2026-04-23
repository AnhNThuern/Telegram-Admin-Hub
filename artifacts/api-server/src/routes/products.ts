import { Router, type IRouter } from "express";
import { eq, ilike, and, sql, count, or, lt } from "drizzle-orm";
import { db, productsTable, productStocksTable, categoriesTable, ordersTable, orderItemsTable, botLogsTable, customersTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { validateBody, validateParams, validateQuery } from "../middlewares/validate";
import { deliverOrder, sendAdminNotification, sendMessageToCustomer, broadcastProductNotification } from "../lib/bot";
import { logger } from "../lib/logger";
import {
  ListProductsQueryParams,
  CreateProductBody,
  GetProductParams,
  UpdateProductParams,
  UpdateProductBody,
  DeleteProductParams,
  ListProductStocksParams,
  ListProductStocksQueryParams,
  AddProductStocksParams,
  AddProductStocksBody,
  DeleteStockParams,
  NotifyProductRestockedParams,
  ListProductStockRequestsParams,
} from "@workspace/api-zod";
import type z from "zod";

const router: IRouter = Router();

router.get("/products", requireAuth, validateQuery(ListProductsQueryParams), async (req, res): Promise<void> => {
  const { page, limit, search, categoryId, isActive } = res.locals["query"] as z.infer<typeof ListProductsQueryParams>;
  const offset = (page - 1) * limit;

  const conditions = [];
  if (search) conditions.push(ilike(productsTable.name, `%${search}%`));
  if (categoryId !== undefined) conditions.push(eq(productsTable.categoryId, categoryId));
  if (isActive !== undefined) conditions.push(eq(productsTable.isActive, isActive));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [totalRow] = await db.select({ count: count() }).from(productsTable).where(where);
  const products = await db.select({
    id: productsTable.id,
    name: productsTable.name,
    description: productsTable.description,
    categoryId: productsTable.categoryId,
    categoryIcon: productsTable.categoryIcon,
    productIcon: productsTable.productIcon,
    price: productsTable.price,
    originalPrice: productsTable.originalPrice,
    productType: productsTable.productType,
    minQuantity: productsTable.minQuantity,
    maxQuantity: productsTable.maxQuantity,
    isActive: productsTable.isActive,
    createdAt: productsTable.createdAt,
    updatedAt: productsTable.updatedAt,
    stockCount: sql<number>`COALESCE(SUM(CASE WHEN ${productStocksTable.status} = 'available' THEN 1 ELSE 0 END), 0)::int`,
    stockRequestCount: sql<number>`(SELECT COUNT(DISTINCT bl.customer_id) FROM bot_logs bl WHERE bl.action = 'stock_request' AND (bl.metadata->>'productId')::int = ${productsTable.id})::int`,
  })
    .from(productsTable)
    .leftJoin(productStocksTable, eq(productStocksTable.productId, productsTable.id))
    .where(where)
    .groupBy(productsTable.id)
    .orderBy(productsTable.createdAt)
    .limit(limit)
    .offset(offset);

  res.json({ data: products, total: totalRow?.count ?? 0, page, limit });
});

router.post("/products", requireAuth, validateBody(CreateProductBody), async (req, res): Promise<void> => {
  const { name, description, categoryId, categoryIcon, productIcon, price, originalPrice, productType, minQuantity, maxQuantity, isActive } = req.body as z.infer<typeof CreateProductBody>;
  const [product] = await db.insert(productsTable).values({
    name,
    description,
    categoryId,
    categoryIcon,
    productIcon,
    price: String(price),
    originalPrice: originalPrice ? String(originalPrice) : undefined,
    productType: productType ?? "digital",
    minQuantity: minQuantity ?? 1,
    maxQuantity: maxQuantity ?? 100,
    isActive: isActive ?? true,
  }).returning();
  res.status(201).json({ ...product, stockCount: 0, stockRequestCount: 0 });
});

router.get("/products/:id", requireAuth, validateParams(GetProductParams), async (req, res): Promise<void> => {
  const { id } = req.params as unknown as z.infer<typeof GetProductParams>;
  const [product] = await db.select({
    id: productsTable.id,
    name: productsTable.name,
    description: productsTable.description,
    categoryId: productsTable.categoryId,
    categoryIcon: productsTable.categoryIcon,
    productIcon: productsTable.productIcon,
    price: productsTable.price,
    originalPrice: productsTable.originalPrice,
    productType: productsTable.productType,
    minQuantity: productsTable.minQuantity,
    maxQuantity: productsTable.maxQuantity,
    isActive: productsTable.isActive,
    createdAt: productsTable.createdAt,
    updatedAt: productsTable.updatedAt,
    stockCount: sql<number>`COALESCE(SUM(CASE WHEN ${productStocksTable.status} = 'available' THEN 1 ELSE 0 END), 0)::int`,
    stockRequestCount: sql<number>`(SELECT COUNT(DISTINCT bl.customer_id) FROM bot_logs bl WHERE bl.action = 'stock_request' AND (bl.metadata->>'productId')::int = ${productsTable.id})::int`,
  })
    .from(productsTable)
    .leftJoin(productStocksTable, eq(productStocksTable.productId, productsTable.id))
    .where(eq(productsTable.id, id))
    .groupBy(productsTable.id);

  if (!product) {
    res.status(404).json({ error: "Product not found" });
    return;
  }

  const category = product.categoryId
    ? (await db.select().from(categoriesTable).where(eq(categoriesTable.id, product.categoryId)))[0] ?? null
    : null;

  res.json({ ...product, category });
});

router.patch("/products/:id", requireAuth, validateParams(UpdateProductParams), validateBody(UpdateProductBody), async (req, res): Promise<void> => {
  const { id } = req.params as unknown as z.infer<typeof UpdateProductParams>;
  const { name, description, categoryId, categoryIcon, productIcon, price, originalPrice, productType, minQuantity, maxQuantity, isActive } = req.body as z.infer<typeof UpdateProductBody>;

  const updateData: Record<string, unknown> = {};
  if (name !== undefined) updateData.name = name;
  if (description !== undefined) updateData.description = description;
  if (categoryId !== undefined) updateData.categoryId = categoryId;
  if (categoryIcon !== undefined) updateData.categoryIcon = categoryIcon;
  if (productIcon !== undefined) updateData.productIcon = productIcon;
  if (price !== undefined) updateData.price = String(price);
  if (originalPrice !== undefined) updateData.originalPrice = String(originalPrice);
  if (productType !== undefined) updateData.productType = productType;
  if (minQuantity !== undefined) updateData.minQuantity = minQuantity;
  if (maxQuantity !== undefined) updateData.maxQuantity = maxQuantity;
  if (isActive !== undefined) updateData.isActive = isActive;

  const [product] = await db.update(productsTable).set(updateData).where(eq(productsTable.id, id)).returning();
  if (!product) {
    res.status(404).json({ error: "Product not found" });
    return;
  }
  const [stockRow] = await db.select({ count: count() }).from(productStocksTable).where(and(eq(productStocksTable.productId, id), eq(productStocksTable.status, "available")));
  const [requestRow] = await db.select({ count: sql<number>`COUNT(DISTINCT customer_id)::int` }).from(botLogsTable).where(and(eq(botLogsTable.action, "stock_request"), sql`(${botLogsTable.metadata}->>'productId')::int = ${id}`));
  res.json({ ...product, stockCount: stockRow?.count ?? 0, stockRequestCount: requestRow?.count ?? 0 });
});

router.delete("/products/:id", requireAuth, validateParams(DeleteProductParams), async (req, res): Promise<void> => {
  const { id } = req.params as unknown as z.infer<typeof DeleteProductParams>;
  const [product] = await db.delete(productsTable).where(eq(productsTable.id, id)).returning();
  if (!product) {
    res.status(404).json({ error: "Product not found" });
    return;
  }
  res.sendStatus(204);
});

router.get("/products/:id/stocks", requireAuth, validateParams(ListProductStocksParams), validateQuery(ListProductStocksQueryParams), async (req, res): Promise<void> => {
  const { id: productId } = req.params as unknown as z.infer<typeof ListProductStocksParams>;
  const { status } = res.locals["query"] as z.infer<typeof ListProductStocksQueryParams>;

  const conditions = [eq(productStocksTable.productId, productId)];
  if (status) conditions.push(eq(productStocksTable.status, status));

  const data = await db.select().from(productStocksTable).where(and(...conditions)).orderBy(productStocksTable.createdAt);
  const [availableCount] = await db.select({ count: count() }).from(productStocksTable).where(and(eq(productStocksTable.productId, productId), eq(productStocksTable.status, "available")));

  res.json({ data, availableCount: availableCount?.count ?? 0, totalCount: data.length });
});

const RESTOCK_MAX_RETRY_COUNT = 10;
const RESTOCK_MAX_ORDER_AGE_DAYS = 7;

export async function retryStuckOrdersForProduct(productId: number): Promise<void> {
  try {
    const stuckStatuses = ["needs_manual_action", "confirmed_not_delivered"];
    const ageThreshold = new Date(Date.now() - RESTOCK_MAX_ORDER_AGE_DAYS * 24 * 60 * 60 * 1000);

    const stuckOrders = await db
      .selectDistinct({ orderId: ordersTable.id, orderCode: ordersTable.orderCode, status: ordersTable.status })
      .from(ordersTable)
      .innerJoin(orderItemsTable, eq(orderItemsTable.orderId, ordersTable.id))
      .where(
        and(
          or(...stuckStatuses.map(s => eq(ordersTable.status, s))),
          eq(orderItemsTable.productId, productId),
          sql`${ordersTable.retryCount} < ${RESTOCK_MAX_RETRY_COUNT}`,
          sql`${ordersTable.createdAt} >= ${ageThreshold.toISOString()}`
        )
      );

    if (stuckOrders.length === 0) return;

    await db.insert(botLogsTable).values({
      action: "restock_retry_triggered",
      content: `Restock for product ${productId} triggered retry for ${stuckOrders.length} stuck order(s)`,
      metadata: { productId, orderIds: stuckOrders.map(o => o.orderId) },
      level: "info",
    });

    for (const { orderId, orderCode, status } of stuckOrders) {
      const [updated] = await db
        .update(ordersTable)
        .set({ status: "paid" })
        .where(and(eq(ordersTable.id, orderId), or(...stuckStatuses.map(s => eq(ordersTable.status, s)))))
        .returning({ id: ordersTable.id, customerId: ordersTable.customerId });

      if (!updated) continue;

      const success = await deliverOrder(orderId, { isRetry: true });

      if (success) {
        try {
          const [customer] = await db.select({ chatId: customersTable.chatId }).from(customersTable).where(eq(customersTable.id, updated.customerId));
          if (customer?.chatId) {
            await sendMessageToCustomer(
              customer.chatId,
              `🎉 <b>Tin vui!</b> Đơn hàng <code>${orderCode}</code> trước đây đang chờ nhập kho đã được giao tự động sau khi shop nhập thêm hàng. Vui lòng kiểm tra tin nhắn giao hàng phía trên. Cảm ơn bạn đã kiên nhẫn chờ đợi! 💚`
            );
          }
        } catch (notifyErr) {
          logger.error({ notifyErr, orderId, orderCode }, "Failed to send restock-fulfilled notification to customer");
        }
      }
      // Note: retryCount is incremented inside deliverOrder() when isRetry=true,
      // regardless of whether the attempt succeeded or failed.

      await db.insert(botLogsTable).values({
        action: success ? "restock_retry_delivered" : "restock_retry_failed",
        content: `Restock retry for order ${orderCode} (id=${orderId}): ${success ? "delivered" : "failed"}`,
        metadata: { productId, orderId },
        level: success ? "info" : "error",
      });

      if (success) {
        await sendAdminNotification(
          `✅ <b>Tự động giao hàng thành công sau khi nhập kho</b>\n\n` +
          `📦 Đơn hàng: <code>${orderCode}</code>\n` +
          `🔄 Trạng thái trước: ${status}\n` +
          `🛍️ Sản phẩm ID: ${productId}\n\n` +
          `Đơn hàng đã được giao tự động khi hàng được nhập lại.`,
          { productId, orderId, previousStatus: status }
        );
      }
    }
  } catch (err) {
    logger.error({ err }, "Error retrying stuck orders after restock");
  }
}

router.post("/products/:id/stocks", requireAuth, validateParams(AddProductStocksParams), validateBody(AddProductStocksBody), async (req, res): Promise<void> => {
  const { id: productId } = req.params as unknown as z.infer<typeof AddProductStocksParams>;
  const { lines } = req.body as z.infer<typeof AddProductStocksBody>;
  const validLines = lines.map((l: string) => l.trim()).filter((l: string) => l.length > 0);
  if (validLines.length === 0) {
    res.status(400).json({ error: "No valid stock lines provided" });
    return;
  }
  await db.insert(productStocksTable).values(validLines.map((content: string) => ({ productId, content, status: "available" })));
  res.status(201).json({ added: validLines.length, message: `Added ${validLines.length} stock lines` });
  retryStuckOrdersForProduct(productId).catch(err => logger.error({ err }, "retryStuckOrdersForProduct failed"));
});

router.delete("/stocks/:id", requireAuth, validateParams(DeleteStockParams), async (req, res): Promise<void> => {
  const { id } = req.params as unknown as z.infer<typeof DeleteStockParams>;
  const [stock] = await db.delete(productStocksTable).where(eq(productStocksTable.id, id)).returning();
  if (!stock) {
    res.status(404).json({ error: "Stock not found" });
    return;
  }
  res.sendStatus(204);
});

router.get("/products/:id/stock-requests", requireAuth, validateParams(ListProductStockRequestsParams), async (req, res): Promise<void> => {
  const { id: productId } = req.params as unknown as z.infer<typeof ListProductStockRequestsParams>;

  const [product] = await db.select({ id: productsTable.id }).from(productsTable).where(eq(productsTable.id, productId));
  if (!product) {
    res.status(404).json({ error: "Product not found" });
    return;
  }

  const rows = await db
    .selectDistinctOn([botLogsTable.customerId], {
      customerId: botLogsTable.customerId,
      firstName: customersTable.firstName,
      lastName: customersTable.lastName,
      username: customersTable.username,
      chatId: botLogsTable.chatId,
      requestedAt: botLogsTable.createdAt,
    })
    .from(botLogsTable)
    .leftJoin(customersTable, eq(customersTable.id, botLogsTable.customerId))
    .where(
      and(
        eq(botLogsTable.action, "stock_request"),
        sql`(${botLogsTable.metadata}->>'productId')::int = ${productId}`
      )
    )
    .orderBy(botLogsTable.customerId, botLogsTable.createdAt);

  res.json({ data: rows, total: rows.length });
});

router.post("/products/:id/notify", requireAuth, validateParams(NotifyProductRestockedParams), async (req, res): Promise<void> => {
  const { id: productId } = req.params as unknown as z.infer<typeof NotifyProductRestockedParams>;

  const [product] = await db.select({
    id: productsTable.id,
    name: productsTable.name,
    price: productsTable.price,
  }).from(productsTable).where(eq(productsTable.id, productId));

  if (!product) {
    res.status(404).json({ error: "Product not found" });
    return;
  }

  const { sent, total, botConfigured } = await broadcastProductNotification(productId, product.name, product.price);

  if (!botConfigured) {
    res.status(503).json({ error: "Bot token chưa được cấu hình. Vui lòng cấu hình Telegram bot trước khi gửi thông báo." });
    return;
  }

  res.json({
    sent,
    total,
    message: `Đã gửi thông báo đến ${sent}/${total} người dùng`,
  });
});

export default router;
