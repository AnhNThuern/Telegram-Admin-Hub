import {
  db,
  customersTable,
  productsTable,
  ordersTable,
  orderItemsTable,
  productStocksTable,
  botLogsTable,
  systemSettingsTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

export interface TestFixture {
  customerId: number;
  productId: number;
  orderId: number;
  orderCode: string;
  marker: string;
}

let counter = 0;

/**
 * Build a uniquely-tagged customer + product + order so each test operates
 * on data it owns, even when the dev DB has unrelated rows.
 */
export async function createOrderFixture(opts: {
  status: string;
  retryCount?: number;
  withStock?: boolean;
}): Promise<TestFixture> {
  counter += 1;
  const marker = `retrytest_${Date.now()}_${counter}_${Math.random().toString(36).slice(2, 8)}`;

  const [customer] = await db
    .insert(customersTable)
    .values({
      chatId: `9${Date.now()}${counter}`,
      firstName: marker,
    })
    .returning();

  const [product] = await db
    .insert(productsTable)
    .values({
      name: marker,
      price: "1000",
      productType: "digital",
    })
    .returning();

  const orderCode = `T${marker.slice(-12).toUpperCase()}`;
  const [order] = await db
    .insert(ordersTable)
    .values({
      orderCode,
      customerId: customer.id,
      totalAmount: "1000",
      status: opts.status,
      retryCount: opts.retryCount ?? 0,
    })
    .returning();

  await db.insert(orderItemsTable).values({
    orderId: order.id,
    productId: product.id,
    productName: product.name,
    quantity: 1,
    unitPrice: "1000",
    totalPrice: "1000",
  });

  if (opts.withStock) {
    await db.insert(productStocksTable).values({
      productId: product.id,
      content: `${marker}_stock`,
      status: "available",
    });
  }

  return {
    customerId: customer.id,
    productId: product.id,
    orderId: order.id,
    orderCode,
    marker,
  };
}

export async function getOrderRetryCount(orderId: number): Promise<number> {
  const [row] = await db
    .select({ retryCount: ordersTable.retryCount })
    .from(ordersTable)
    .where(eq(ordersTable.id, orderId));
  return row?.retryCount ?? -1;
}

export async function getOrderStatus(orderId: number): Promise<string | null> {
  const [row] = await db
    .select({ status: ordersTable.status })
    .from(ordersTable)
    .where(eq(ordersTable.id, orderId));
  return row?.status ?? null;
}

export async function cleanupFixture(fx: TestFixture): Promise<void> {
  // Order matters: delete child rows before parents.
  await db.delete(productStocksTable).where(eq(productStocksTable.productId, fx.productId));
  await db.delete(orderItemsTable).where(eq(orderItemsTable.orderId, fx.orderId));
  await db.delete(ordersTable).where(eq(ordersTable.id, fx.orderId));
  await db.delete(productsTable).where(eq(productsTable.id, fx.productId));
  await db.delete(customersTable).where(eq(customersTable.id, fx.customerId));
}

export async function cleanupBotLogsForCustomer(customerId: number): Promise<void> {
  await db.delete(botLogsTable).where(eq(botLogsTable.customerId, customerId));
}

/**
 * Ensure a system_settings row exists with predictable retry limits so the
 * sweep doesn't accidentally exhaust the test order before it gets a chance
 * to retry.
 */
export async function ensureSystemSettings(maxRetryCount = 10, maxOrderAgeDays = 365): Promise<void> {
  const existing = await db.select().from(systemSettingsTable).limit(1);
  if (existing.length === 0) {
    await db.insert(systemSettingsTable).values({ maxRetryCount, maxOrderAgeDays });
  } else {
    await db
      .update(systemSettingsTable)
      .set({ maxRetryCount, maxOrderAgeDays })
      .where(eq(systemSettingsTable.id, existing[0].id));
  }
}

/**
 * Quiet stub for `fetch` so deliverOrder's Telegram calls don't hit the
 * network during tests. Returns ok=false, which sendMessage / sendPhoto
 * already tolerate gracefully.
 */
export function stubFetch(): void {
  const stub = async () =>
    new Response(JSON.stringify({ ok: false, description: "stubbed" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  (globalThis as { fetch: unknown }).fetch = stub;
}

export { db, ordersTable, productStocksTable, inArray };
