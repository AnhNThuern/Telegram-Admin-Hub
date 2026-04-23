import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import {
  db,
  botConfigsTable,
  categoriesTable,
  productsTable,
  productStocksTable,
  customersTable,
  botLogsTable,
  botPendingActionsTable,
} from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { handleTelegramUpdate } from "../lib/bot";

// ---------------------------------------------------------------------------
// Minimal Telegram update shape (mirrors the private interface in bot.ts)
// ---------------------------------------------------------------------------

interface TgFrom {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
}

interface TgUpdate {
  update_id: number;
  callback_query?: {
    id: string;
    from: TgFrom;
    /** Include chat.id so the handler resolves chatId, but omit message_id so
     *  renderView skips editMessage and goes straight to sendMessage. */
    message?: { message_id?: number; chat: { id: number } };
    data?: string;
  };
  message?: {
    message_id: number;
    from?: TgFrom;
    chat: { id: number; type: string };
    text?: string;
    date: number;
  };
}

// ---------------------------------------------------------------------------
// Fetch stub — captures every outgoing Telegram API call
// ---------------------------------------------------------------------------

interface CapturedCall {
  url: string;
  body: Record<string, unknown>;
}

function captureFetch(): { calls: CapturedCall[]; restore: () => void } {
  const calls: CapturedCall[] = [];
  const original = globalThis.fetch;
  (globalThis as { fetch: unknown }).fetch = async (
    url: string,
    opts?: RequestInit,
  ) => {
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse((opts?.body as string) ?? "{}");
    } catch {
      /* non-JSON body — leave as empty object */
    }
    calls.push({ url, body });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return {
    calls,
    restore: () => {
      (globalThis as { fetch: unknown }).fetch = original;
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers to inspect captured calls
// ---------------------------------------------------------------------------

function sendMessageCalls(calls: CapturedCall[]): CapturedCall[] {
  return calls.filter((c) => c.url.endsWith("/sendMessage"));
}

type InlineButton = { text: string; callback_data: string };
type InlineKeyboard = InlineButton[][];

function inlineKeyboard(call: CapturedCall): InlineKeyboard {
  const rm = call.body.reply_markup as
    | { inline_keyboard?: InlineKeyboard }
    | undefined;
  return rm?.inline_keyboard ?? [];
}

function allButtons(call: CapturedCall): InlineButton[] {
  return inlineKeyboard(call).flat();
}

// ---------------------------------------------------------------------------
// Bot-config management — ensure a token exists so fetch is actually called
// ---------------------------------------------------------------------------

const TEST_BOT_TOKEN = "test_bot_token_conv_flow_12345";
let savedBotToken: string | null = null;
let botConfigRowId: number | null = null;

async function ensureBotToken(): Promise<void> {
  // Mirror production's "latest row" strategy (orderBy desc id) so that the
  // same config row that getBotToken() will read is the one we patch.
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
// Per-test fixtures
// ---------------------------------------------------------------------------

let counter = 0;

interface ConvFixture {
  categoryId: number;
  productId: number;
  stockIds: number[];
  chatId: number;
  marker: string;
}

async function createConvFixture(opts: {
  stockCount: number;
}): Promise<ConvFixture> {
  counter += 1;
  const marker = `convtest_${Date.now()}_${counter}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  // Use a large, unique numeric chatId that won't collide with real data
  const chatId = 9_900_000_000 + counter;

  const [category] = await db
    .insert(categoriesTable)
    .values({ name: marker, icon: "🧪", isActive: true })
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

  return {
    categoryId: category.id,
    productId: product.id,
    stockIds,
    chatId,
    marker,
  };
}

async function cleanupConvFixture(fx: ConvFixture): Promise<void> {
  // Delete bot state rows created by upsertCustomer / logBotAction
  const customers = await db
    .select({ id: customersTable.id })
    .from(customersTable)
    .where(eq(customersTable.chatId, String(fx.chatId)));
  for (const c of customers) {
    await db.delete(botLogsTable).where(eq(botLogsTable.customerId, c.id));
  }
  await db
    .delete(botPendingActionsTable)
    .where(eq(botPendingActionsTable.chatId, String(fx.chatId)));
  await db
    .delete(customersTable)
    .where(eq(customersTable.chatId, String(fx.chatId)));

  // Delete product data (child rows first)
  await db
    .delete(productStocksTable)
    .where(eq(productStocksTable.productId, fx.productId));
  await db
    .delete(productsTable)
    .where(eq(productsTable.id, fx.productId));
  await db
    .delete(categoriesTable)
    .where(eq(categoriesTable.id, fx.categoryId));
}

// ---------------------------------------------------------------------------
// Update builder
// ---------------------------------------------------------------------------

/** Build a callback_query update.
 *  We include `message.chat.id` so the handler can resolve the Telegram chatId,
 *  but omit `message_id` so `renderView` skips the editMessage path and goes
 *  straight to sendMessage — which simplifies captured-call assertions. */
function callbackUpdate(chatId: number, data: string): TgUpdate {
  return {
    update_id: Date.now() + Math.floor(Math.random() * 100_000),
    callback_query: {
      id: `cq_test_${Date.now()}`,
      from: { id: chatId, first_name: "TestUser" },
      message: { chat: { id: chatId } },
      data,
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Telegram bot conversation flow (end-to-end via handleTelegramUpdate)", () => {
  const fixtures: ConvFixture[] = [];

  beforeAll(async () => {
    await ensureBotToken();
  });

  afterAll(async () => {
    await restoreBotToken();
  });

  afterEach(async () => {
    while (fixtures.length) {
      await cleanupConvFixture(fixtures.pop()!);
    }
  });

  // ── browse_products ──────────────────────────────────────────────────────

  it("browse_products: outgoing keyboard contains cat_{id} button for the fixture category", async () => {
    const fx = await createConvFixture({ stockCount: 3 });
    fixtures.push(fx);

    const { calls, restore } = captureFetch();
    try {
      await handleTelegramUpdate(
        callbackUpdate(fx.chatId, "browse_products") as Parameters<
          typeof handleTelegramUpdate
        >[0],
      );
    } finally {
      restore();
    }

    const msgs = sendMessageCalls(calls);
    expect(msgs.length, "expected at least one sendMessage call").toBeGreaterThanOrEqual(1);

    const lastMsg = msgs[msgs.length - 1];
    const btns = allButtons(lastMsg);

    const catBtn = btns.find((b) => b.callback_data === `cat_${fx.categoryId}`);
    expect(catBtn, "category button not found in keyboard").toBeDefined();
    // Button label includes category name and in-stock indicator
    expect(catBtn!.text).toContain(fx.marker);
    expect(catBtn!.text).toContain("✅");
    expect(catBtn!.text).toContain("3");
  });

  it("browse_products: category with zero stock shows out-of-stock label", async () => {
    const fx = await createConvFixture({ stockCount: 0 });
    fixtures.push(fx);

    const { calls, restore } = captureFetch();
    try {
      await handleTelegramUpdate(
        callbackUpdate(fx.chatId, "browse_products") as Parameters<
          typeof handleTelegramUpdate
        >[0],
      );
    } finally {
      restore();
    }

    const msgs = sendMessageCalls(calls);
    expect(msgs.length).toBeGreaterThanOrEqual(1);

    const lastMsg = msgs[msgs.length - 1];
    const catBtn = allButtons(lastMsg).find(
      (b) => b.callback_data === `cat_${fx.categoryId}`,
    );
    expect(catBtn).toBeDefined();
    expect(catBtn!.text).toContain("❌");
  });

  // ── cat_{id} ─────────────────────────────────────────────────────────────

  it("cat_{id}: outgoing keyboard contains prod_{id} button for the fixture product", async () => {
    const fx = await createConvFixture({ stockCount: 4 });
    fixtures.push(fx);

    const { calls, restore } = captureFetch();
    try {
      await handleTelegramUpdate(
        callbackUpdate(fx.chatId, `cat_${fx.categoryId}`) as Parameters<
          typeof handleTelegramUpdate
        >[0],
      );
    } finally {
      restore();
    }

    const msgs = sendMessageCalls(calls);
    expect(msgs.length).toBeGreaterThanOrEqual(1);

    const lastMsg = msgs[msgs.length - 1];
    const btns = allButtons(lastMsg);

    const prodBtn = btns.find(
      (b) => b.callback_data === `prod_${fx.productId}`,
    );
    expect(prodBtn, "product button not found in keyboard").toBeDefined();
    expect(prodBtn!.text).toContain(`${fx.marker}_prod`);
    expect(prodBtn!.text).toContain("✅");
    expect(prodBtn!.text).toContain("4");
  });

  it("cat_{id}: keyboard has a back button that routes to browse_products", async () => {
    const fx = await createConvFixture({ stockCount: 1 });
    fixtures.push(fx);

    const { calls, restore } = captureFetch();
    try {
      await handleTelegramUpdate(
        callbackUpdate(fx.chatId, `cat_${fx.categoryId}`) as Parameters<
          typeof handleTelegramUpdate
        >[0],
      );
    } finally {
      restore();
    }

    const msgs = sendMessageCalls(calls);
    expect(msgs.length).toBeGreaterThanOrEqual(1);

    const lastMsg = msgs[msgs.length - 1];
    const backBtn = allButtons(lastMsg).find(
      (b) => b.callback_data === "browse_products",
    );
    expect(backBtn, "back-to-categories button not found").toBeDefined();
  });

  // ── prod_{id} ─────────────────────────────────────────────────────────────

  it("prod_{id}: message text contains the product name", async () => {
    const fx = await createConvFixture({ stockCount: 5 });
    fixtures.push(fx);

    const { calls, restore } = captureFetch();
    try {
      await handleTelegramUpdate(
        callbackUpdate(fx.chatId, `prod_${fx.productId}`) as Parameters<
          typeof handleTelegramUpdate
        >[0],
      );
    } finally {
      restore();
    }

    const msgs = sendMessageCalls(calls);
    expect(msgs.length).toBeGreaterThanOrEqual(1);

    const lastMsg = msgs[msgs.length - 1];
    expect(lastMsg.body.text as string).toContain(`${fx.marker}_prod`);
  });

  it("prod_{id}: keyboard contains qty_{productId}_1 button (minQuantity)", async () => {
    const fx = await createConvFixture({ stockCount: 5 });
    fixtures.push(fx);

    const { calls, restore } = captureFetch();
    try {
      await handleTelegramUpdate(
        callbackUpdate(fx.chatId, `prod_${fx.productId}`) as Parameters<
          typeof handleTelegramUpdate
        >[0],
      );
    } finally {
      restore();
    }

    const msgs = sendMessageCalls(calls);
    expect(msgs.length).toBeGreaterThanOrEqual(1);

    const lastMsg = msgs[msgs.length - 1];
    const qtyBtn = allButtons(lastMsg).find(
      (b) => b.callback_data === `qty_${fx.productId}_1`,
    );
    expect(qtyBtn, "min-quantity button not found").toBeDefined();
  });

  it("prod_{id}: back button routes to cat_{categoryId}", async () => {
    const fx = await createConvFixture({ stockCount: 3 });
    fixtures.push(fx);

    const { calls, restore } = captureFetch();
    try {
      await handleTelegramUpdate(
        callbackUpdate(fx.chatId, `prod_${fx.productId}`) as Parameters<
          typeof handleTelegramUpdate
        >[0],
      );
    } finally {
      restore();
    }

    const msgs = sendMessageCalls(calls);
    expect(msgs.length).toBeGreaterThanOrEqual(1);

    const lastMsg = msgs[msgs.length - 1];
    const backBtn = allButtons(lastMsg).find(
      (b) => b.callback_data === `cat_${fx.categoryId}`,
    );
    expect(backBtn, "back-to-category button not found").toBeDefined();
  });

  it("prod_{id} out of stock: shows stock_request button, no qty buttons", async () => {
    const fx = await createConvFixture({ stockCount: 0 });
    fixtures.push(fx);

    const { calls, restore } = captureFetch();
    try {
      await handleTelegramUpdate(
        callbackUpdate(fx.chatId, `prod_${fx.productId}`) as Parameters<
          typeof handleTelegramUpdate
        >[0],
      );
    } finally {
      restore();
    }

    const msgs = sendMessageCalls(calls);
    expect(msgs.length).toBeGreaterThanOrEqual(1);

    const lastMsg = msgs[msgs.length - 1];
    const btns = allButtons(lastMsg);

    const stockReqBtn = btns.find(
      (b) => b.callback_data === `stock_request_${fx.productId}`,
    );
    expect(stockReqBtn, "stock_request button not found").toBeDefined();

    const qtyBtn = btns.find((b) =>
      b.callback_data?.startsWith(`qty_${fx.productId}_`),
    );
    expect(qtyBtn, "qty button should not be present when out of stock").toBeUndefined();
  });

  // ── Full chain ────────────────────────────────────────────────────────────

  it("full chain browse_products → cat_{id} → prod_{id}: each step produces a correctly routed keyboard", async () => {
    const fx = await createConvFixture({ stockCount: 6 });
    fixtures.push(fx);

    // Step 1 — browse_products → categories list
    const step1 = captureFetch();
    await handleTelegramUpdate(
      callbackUpdate(fx.chatId, "browse_products") as Parameters<
        typeof handleTelegramUpdate
      >[0],
    );
    step1.restore();

    const catMsgs = sendMessageCalls(step1.calls);
    expect(catMsgs.length).toBeGreaterThanOrEqual(1);
    const catBtn = allButtons(catMsgs[catMsgs.length - 1]).find(
      (b) => b.callback_data === `cat_${fx.categoryId}`,
    );
    expect(catBtn, "Step 1: category button missing").toBeDefined();
    expect(catBtn!.text).toContain("6");

    // Step 2 — cat_{id} → product list
    const step2 = captureFetch();
    await handleTelegramUpdate(
      callbackUpdate(fx.chatId, `cat_${fx.categoryId}`) as Parameters<
        typeof handleTelegramUpdate
      >[0],
    );
    step2.restore();

    const prodListMsgs = sendMessageCalls(step2.calls);
    expect(prodListMsgs.length).toBeGreaterThanOrEqual(1);
    const prodBtn = allButtons(prodListMsgs[prodListMsgs.length - 1]).find(
      (b) => b.callback_data === `prod_${fx.productId}`,
    );
    expect(prodBtn, "Step 2: product button missing").toBeDefined();
    expect(prodBtn!.text).toContain("6");

    // Step 3 — prod_{id} → product detail
    const step3 = captureFetch();
    await handleTelegramUpdate(
      callbackUpdate(fx.chatId, `prod_${fx.productId}`) as Parameters<
        typeof handleTelegramUpdate
      >[0],
    );
    step3.restore();

    const detailMsgs = sendMessageCalls(step3.calls);
    expect(detailMsgs.length).toBeGreaterThanOrEqual(1);
    const detailMsg = detailMsgs[detailMsgs.length - 1];

    // Message text has the product name
    expect(detailMsg.body.text as string).toContain(`${fx.marker}_prod`);

    // Keyboard has quantity button and back button
    const detailBtns = allButtons(detailMsg);
    expect(
      detailBtns.find((b) => b.callback_data === `qty_${fx.productId}_1`),
      "Step 3: qty button missing",
    ).toBeDefined();
    expect(
      detailBtns.find((b) => b.callback_data === `cat_${fx.categoryId}`),
      "Step 3: back-to-category button missing",
    ).toBeDefined();
  });
});
