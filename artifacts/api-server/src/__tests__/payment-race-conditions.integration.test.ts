import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { createOrderFromBot, deliverOrder, type ValidPromotion } from "../lib/bot";
import {
  createOrderFixture,
  cleanupFixture,
  cleanupBotLogsForCustomer,
  stubFetch,
  getOrderStatus,
  db,
  ordersTable,
  productStocksTable,
} from "./helpers";
import {
  botConfigsTable,
  botLogsTable,
  botPendingActionsTable,
  categoriesTable,
  customersTable,
  orderItemsTable,
  promotionsTable,
  productsTable,
  transactionsTable,
} from "@workspace/db";
import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Shared bot-token setup (mirrors bot-conversation-flow.integration.test.ts)
// Needed so createOrderFromBot's sendMessage calls have a token to use.
// ---------------------------------------------------------------------------

const TEST_BOT_TOKEN = "test_bot_token_race_cond_99999";
let savedBotToken: string | null = null;
let botConfigRowId: number | null = null;

async function ensureBotToken(): Promise<void> {
  const [cfg] = await db
    .select()
    .from(botConfigsTable)
    .orderBy(desc(botConfigsTable.id))
    .limit(1);
  if (cfg) {
    savedBotToken = cfg.botToken ?? null;
    botConfigRowId = cfg.id;
    await db
      .update(botConfigsTable)
      .set({ botToken: TEST_BOT_TOKEN })
      .where(eq(botConfigsTable.id, cfg.id));
  } else {
    const [inserted] = await db
      .insert(botConfigsTable)
      .values({ botToken: TEST_BOT_TOKEN })
      .returning();
    botConfigRowId = inserted.id;
  }
}

async function restoreBotToken(): Promise<void> {
  if (botConfigRowId !== null) {
    await db
      .update(botConfigsTable)
      .set({ botToken: savedBotToken })
      .where(eq(botConfigsTable.id, botConfigRowId));
  }
}

// ---------------------------------------------------------------------------
// Low-level promo fixture helpers
// ---------------------------------------------------------------------------

let promoCounter = 0;

async function createPromoFixture(opts: {
  usageLimit: number;
  useCount?: number;
}): Promise<{ id: number; code: string }> {
  promoCounter += 1;
  const code = `RACETEST_${Date.now()}_${promoCounter}`;
  const [promo] = await db
    .insert(promotionsTable)
    .values({
      name: code,
      code,
      type: "fixed",
      discountValue: "1000",
      usageLimit: opts.usageLimit,
      useCount: opts.useCount ?? 0,
      isActive: true,
    })
    .returning({ id: promotionsTable.id, code: promotionsTable.code });
  return promo;
}

async function cleanupPromo(promoId: number): Promise<void> {
  await db.delete(promotionsTable).where(eq(promotionsTable.id, promoId));
}

async function getPromoUseCount(promoId: number): Promise<number> {
  const [row] = await db
    .select({ useCount: promotionsTable.useCount })
    .from(promotionsTable)
    .where(eq(promotionsTable.id, promoId));
  return row?.useCount ?? -1;
}

// ---------------------------------------------------------------------------
// End-to-end createOrderFromBot fixture
// ---------------------------------------------------------------------------

interface OrderRaceFixture {
  categoryId: number;
  productId: number;
  stockIds: number[];
  customerIds: number[];
  chatIds: string[];
  promoId: number;
  marker: string;
}

let raceCounter = 0;

async function createOrderRaceFixture(opts: {
  stockCount: number;
  promoUsageLimit: number;
}): Promise<OrderRaceFixture> {
  raceCounter += 1;
  const marker = `orderrace_${Date.now()}_${raceCounter}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;

  const [category] = await db
    .insert(categoriesTable)
    .values({ name: marker, icon: "🏁", isActive: true })
    .returning();

  const [product] = await db
    .insert(productsTable)
    .values({
      name: `${marker}_prod`,
      price: "50000",
      productType: "digital",
      categoryId: category.id,
      isActive: true,
      minQuantity: 1,
      maxQuantity: 5,
    })
    .returning();

  const stockIds: number[] = [];
  for (let i = 0; i < opts.stockCount; i++) {
    const [s] = await db
      .insert(productStocksTable)
      .values({
        productId: product.id,
        content: `${marker}_s${i}`,
        status: "available",
      })
      .returning();
    stockIds.push(s.id);
  }

  const customerIds: number[] = [];
  const chatIds: string[] = [];
  for (let i = 0; i < 2; i++) {
    const chatId = `88${Date.now()}${raceCounter}${i}`;
    const [cust] = await db
      .insert(customersTable)
      .values({ chatId, firstName: `${marker}_c${i}` })
      .returning();
    customerIds.push(cust.id);
    chatIds.push(chatId);
  }

  const { id: promoId } = await createPromoFixture({
    usageLimit: opts.promoUsageLimit,
    useCount: 0,
  });

  return {
    categoryId: category.id,
    productId: product.id,
    stockIds,
    customerIds,
    chatIds,
    promoId,
    marker,
  };
}

async function cleanupOrderRaceFixture(fx: OrderRaceFixture): Promise<void> {
  for (const customerId of fx.customerIds) {
    await cleanupBotLogsForCustomer(customerId);
  }

  for (const chatId of fx.chatIds) {
    await db
      .delete(botPendingActionsTable)
      .where(eq(botPendingActionsTable.chatId, chatId));
  }

  const orders = await db
    .select({ id: ordersTable.id })
    .from(ordersTable)
    .where(inArray(ordersTable.customerId, fx.customerIds));

  if (orders.length > 0) {
    const orderIds = orders.map((o) => o.id);
    await db.delete(transactionsTable).where(inArray(transactionsTable.orderId, orderIds));
    await db.delete(orderItemsTable).where(inArray(orderItemsTable.orderId, orderIds));
    await db.delete(ordersTable).where(inArray(ordersTable.id, orderIds));
  }

  await db.delete(productStocksTable).where(eq(productStocksTable.productId, fx.productId));
  await db.delete(productsTable).where(eq(productsTable.id, fx.productId));
  await db.delete(categoriesTable).where(eq(categoriesTable.id, fx.categoryId));

  await db.delete(customersTable).where(inArray(customersTable.id, fx.customerIds));

  await cleanupPromo(fx.promoId);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("payment race condition guards", () => {
  beforeAll(async () => {
    await ensureBotToken();
  });

  afterAll(async () => {
    await restoreBotToken();
  });

  beforeEach(() => {
    stubFetch();
  });

  // -------------------------------------------------------------------------
  // 1. createOrderFromBot promo race — true end-to-end integration
  // -------------------------------------------------------------------------

  describe("createOrderFromBot: promo code usage_limit race condition", () => {
    const fixtures: OrderRaceFixture[] = [];

    afterEach(async () => {
      while (fixtures.length) {
        await cleanupOrderRaceFixture(fixtures.pop()!);
      }
    });

    it("two concurrent createOrderFromBot calls with the same promo at usage_limit=1: only one order is created", async () => {
      // 2 stock items so neither order fails on stock shortage — the only
      // rejection path here should be the promo limit guard.
      const fx = await createOrderRaceFixture({ stockCount: 2, promoUsageLimit: 1 });
      fixtures.push(fx);

      const promotion: ValidPromotion = {
        id: fx.promoId,
        name: "Race test promo",
        code: `RACETEST`,
        discountAmount: 1000,
      };

      // Fire both order creations concurrently — customer 0 and customer 1 both
      // try to apply the same single-use promo at the same moment.
      await Promise.all([
        createOrderFromBot(
          parseInt(fx.chatIds[0]),
          fx.customerIds[0],
          fx.productId,
          1,
          promotion,
          "en",
        ),
        createOrderFromBot(
          parseInt(fx.chatIds[1]),
          fx.customerIds[1],
          fx.productId,
          1,
          promotion,
          "en",
        ),
      ]);

      // Exactly one order must have been committed (the other's transaction
      // rolled back when the atomic promo increment guard returned 0 rows).
      const orders = await db
        .select({ id: ordersTable.id, promotionId: ordersTable.promotionId })
        .from(ordersTable)
        .where(inArray(ordersTable.customerId, fx.customerIds));

      expect(orders.length).toBe(1);
      expect(orders[0].promotionId).toBe(fx.promoId);

      // Promo use_count must be exactly 1 — never incremented twice.
      expect(await getPromoUseCount(fx.promoId)).toBe(1);
    });

    it("winning order has its stock reserved; losing order leaves all stock available", async () => {
      const fx = await createOrderRaceFixture({ stockCount: 2, promoUsageLimit: 1 });
      fixtures.push(fx);

      const promotion: ValidPromotion = {
        id: fx.promoId,
        name: "Race test promo 2",
        code: `RACETEST`,
        discountAmount: 1000,
      };

      await Promise.all([
        createOrderFromBot(parseInt(fx.chatIds[0]), fx.customerIds[0], fx.productId, 1, promotion, "en"),
        createOrderFromBot(parseInt(fx.chatIds[1]), fx.customerIds[1], fx.productId, 1, promotion, "en"),
      ]);

      const stocks = await db
        .select({ status: productStocksTable.status })
        .from(productStocksTable)
        .where(eq(productStocksTable.productId, fx.productId));

      const reserved = stocks.filter((s) => s.status === "reserved").length;
      const available = stocks.filter((s) => s.status === "available").length;

      // Exactly 1 stock row should be reserved (by the winning order), 1 available.
      expect(reserved).toBe(1);
      expect(available).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // 2. Promo guard SQL invariant (unit-level, no full order flow)
  // -------------------------------------------------------------------------

  describe("promo usage_limit atomic SQL guard", () => {
    const promoIds: number[] = [];

    afterEach(async () => {
      while (promoIds.length) {
        await cleanupPromo(promoIds.pop()!);
      }
    });

    it("two simultaneous UPDATE applications at usage_limit=1: only one succeeds", async () => {
      const { id: promoId } = await createPromoFixture({ usageLimit: 1, useCount: 0 });
      promoIds.push(promoId);

      const applyPromo = () =>
        db
          .update(promotionsTable)
          .set({ useCount: sql`${promotionsTable.useCount} + 1` })
          .where(
            and(
              eq(promotionsTable.id, promoId),
              or(
                isNull(promotionsTable.usageLimit),
                lt(promotionsTable.useCount, promotionsTable.usageLimit),
              ),
            ),
          )
          .returning({ id: promotionsTable.id });

      const [result1, result2] = await Promise.all([applyPromo(), applyPromo()]);
      const successes = [result1, result2].filter((r) => r.length > 0).length;
      expect(successes).toBe(1);
      expect(await getPromoUseCount(promoId)).toBe(1);
    });

    it("promo already at limit: additional application is rejected", async () => {
      const { id: promoId } = await createPromoFixture({ usageLimit: 1, useCount: 1 });
      promoIds.push(promoId);

      const [result] = await db
        .update(promotionsTable)
        .set({ useCount: sql`${promotionsTable.useCount} + 1` })
        .where(
          and(
            eq(promotionsTable.id, promoId),
            or(
              isNull(promotionsTable.usageLimit),
              lt(promotionsTable.useCount, promotionsTable.usageLimit),
            ),
          ),
        )
        .returning({ id: promotionsTable.id });

      expect(result).toBeUndefined();
      expect(await getPromoUseCount(promoId)).toBe(1);
    });

    it("five simultaneous applications at usage_limit=2: exactly two succeed", async () => {
      const { id: promoId } = await createPromoFixture({ usageLimit: 2, useCount: 0 });
      promoIds.push(promoId);

      const applyPromo = () =>
        db
          .update(promotionsTable)
          .set({ useCount: sql`${promotionsTable.useCount} + 1` })
          .where(
            and(
              eq(promotionsTable.id, promoId),
              or(
                isNull(promotionsTable.usageLimit),
                lt(promotionsTable.useCount, promotionsTable.usageLimit),
              ),
            ),
          )
          .returning({ id: promotionsTable.id });

      const results = await Promise.all([
        applyPromo(),
        applyPromo(),
        applyPromo(),
        applyPromo(),
        applyPromo(),
      ]);

      const successes = results.filter((r) => r.length > 0).length;
      expect(successes).toBe(2);
      expect(await getPromoUseCount(promoId)).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // 3. deliverOrder idempotency / double-delivery prevention
  // -------------------------------------------------------------------------

  describe("deliverOrder double-delivery prevention", () => {
    const fixtures: Awaited<ReturnType<typeof createOrderFixture>>[] = [];

    afterEach(async () => {
      while (fixtures.length) {
        const fx = fixtures.pop()!;
        await cleanupBotLogsForCustomer(fx.customerId);
        await cleanupFixture(fx);
      }
    });

    it("second deliverOrder call for an already-delivered order returns false", async () => {
      const fx = await createOrderFixture({ status: "paid", withStock: true });
      fixtures.push(fx);

      const firstResult = await deliverOrder(fx.orderId);
      expect(firstResult).toBe(true);
      expect(await getOrderStatus(fx.orderId)).toBe("delivered");

      // A second call — simulating a crash-and-retry scenario — must not
      // re-deliver because the order status is already 'delivered'.
      const secondResult = await deliverOrder(fx.orderId);
      expect(secondResult).toBe(false);
    });

    it("second deliverOrder call does not change the delivered stock rows", async () => {
      const fx = await createOrderFixture({ status: "paid", withStock: true });
      fixtures.push(fx);

      await deliverOrder(fx.orderId);

      const [stockRow] = await db
        .select({ status: productStocksTable.status, orderId: productStocksTable.orderId })
        .from(productStocksTable)
        .where(eq(productStocksTable.productId, fx.productId));

      expect(stockRow.status).toBe("delivered");
      expect(stockRow.orderId).toBe(fx.orderId);

      await deliverOrder(fx.orderId);

      const [stockRowAfter] = await db
        .select({ status: productStocksTable.status, orderId: productStocksTable.orderId })
        .from(productStocksTable)
        .where(eq(productStocksTable.productId, fx.productId));

      expect(stockRowAfter.status).toBe("delivered");
      expect(stockRowAfter.orderId).toBe(fx.orderId);
    });

    it("two concurrent deliverOrder calls for the same paid order: stock content is never double-delivered", async () => {
      const fx = await createOrderFixture({ status: "paid", withStock: true });
      fixtures.push(fx);

      // Fire both concurrently. FOR UPDATE SKIP LOCKED in deliverOrder ensures the
      // single stock row can only be claimed by one transaction. The second transaction
      // either sees the order already 'delivered' (status guard bails) or finds no
      // unlocked stock rows and returns false. Either way the stock row is delivered
      // at most once — the core invariant that prevents duplicate content delivery.
      const [r1, r2] = await Promise.all([
        deliverOrder(fx.orderId),
        deliverOrder(fx.orderId),
      ]);

      // At most one call can return true (one successful delivery)
      const successes = [r1, r2].filter(Boolean).length;
      expect(successes).toBeLessThanOrEqual(1);

      // The single stock row must be in 'delivered' state — never double-claimed.
      const stocks = await db
        .select()
        .from(productStocksTable)
        .where(eq(productStocksTable.productId, fx.productId));

      expect(stocks.length).toBe(1);
      expect(stocks[0].status).toBe("delivered");
      expect(stocks[0].orderId).toBe(fx.orderId);
    });
  });
});
