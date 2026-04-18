import { describe, it, expect, beforeAll, afterEach, beforeEach } from "vitest";
import { deliverOrder } from "../lib/bot";
import { retryStuckOrdersForProduct } from "../routes/products";
import {
  createOrderFixture,
  cleanupFixture,
  cleanupBotLogsForCustomer,
  ensureSystemSettings,
  stubFetch,
  getOrderRetryCount,
  getOrderStatus,
} from "./helpers";
import { db, ordersTable, productStocksTable } from "@workspace/db";
import { eq } from "drizzle-orm";

describe("retry_count behavior in deliverOrder + restock retry", () => {
  beforeAll(async () => {
    await ensureSystemSettings();
  });

  beforeEach(() => {
    stubFetch();
  });

  const fixtures: Awaited<ReturnType<typeof createOrderFixture>>[] = [];
  afterEach(async () => {
    while (fixtures.length) {
      const fx = fixtures.pop()!;
      await cleanupBotLogsForCustomer(fx.customerId);
      await cleanupFixture(fx);
    }
  });

  it("normal payment delivery (isRetry=false): retry_count stays at 0", async () => {
    const fx = await createOrderFixture({ status: "paid", withStock: true });
    fixtures.push(fx);

    const ok = await deliverOrder(fx.orderId);
    expect(ok).toBe(true);
    expect(await getOrderStatus(fx.orderId)).toBe("delivered");
    expect(await getOrderRetryCount(fx.orderId)).toBe(0);
  });

  it("retry delivery success (isRetry=true): retry_count increments by exactly 1", async () => {
    const fx = await createOrderFixture({ status: "needs_manual_action", withStock: true });
    fixtures.push(fx);

    // Bring it back to 'paid' the way the sweep would, so deliverOrder will run.
    await db.update(ordersTable).set({ status: "paid" }).where(eq(ordersTable.id, fx.orderId));

    const ok = await deliverOrder(fx.orderId, { isRetry: true });
    expect(ok).toBe(true);
    expect(await getOrderRetryCount(fx.orderId)).toBe(1);
  });

  it("retry delivery failure (isRetry=true, no stock): retry_count still increments by exactly 1", async () => {
    const fx = await createOrderFixture({ status: "paid", withStock: false });
    fixtures.push(fx);

    const ok = await deliverOrder(fx.orderId, { isRetry: true });
    expect(ok).toBe(false);
    // deliverOrder marks it back as needs_manual_action when stock is short
    expect(await getOrderStatus(fx.orderId)).toBe("needs_manual_action");
    expect(await getOrderRetryCount(fx.orderId)).toBe(1);
  });

  it("retry delivery is idempotent per call: two calls => exactly +2, not +4", async () => {
    const fx = await createOrderFixture({ status: "paid", withStock: false });
    fixtures.push(fx);

    await deliverOrder(fx.orderId, { isRetry: true });
    expect(await getOrderRetryCount(fx.orderId)).toBe(1);

    // Second attempt: still no stock, status auto-resets to needs_manual_action.
    await deliverOrder(fx.orderId, { isRetry: true });
    expect(await getOrderRetryCount(fx.orderId)).toBe(2);
  });

  it("restock retry path: retry_count goes up by exactly 1 per attempt", async () => {
    const fx = await createOrderFixture({ status: "needs_manual_action", withStock: false });
    fixtures.push(fx);

    // Add stock and trigger the same path the products route uses.
    await db.insert(productStocksTable).values({
      productId: fx.productId,
      content: `${fx.marker}_restock`,
      status: "available",
    });

    await retryStuckOrdersForProduct(fx.productId);

    expect(await getOrderRetryCount(fx.orderId)).toBe(1);
    expect(await getOrderStatus(fx.orderId)).toBe("delivered");
  });
});
