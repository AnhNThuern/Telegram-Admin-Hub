import { db, botLogsTable, customersTable, ordersTable, orderItemsTable, productStocksTable, transactionsTable, productsTable, promotionsTable, botPendingActionsTable } from "@workspace/db";
import { eq, and, desc, inArray, sql as sqlOp, lt, gte, count } from "drizzle-orm";
import { logger } from "./logger";
import { t, tMany, type Lang } from "./i18n";

// Persistent conversation state for customers awaiting promo code entry.
// Stored in `bot_pending_actions` so in-flight checkouts survive an API
// server restart (deploys, crashes). Keyed by chatId. Cleared on skip, on
// valid code entry, or when /start is sent. Expired entries are pruned by
// the periodic sweep in pendingOrderExpiry.ts.
interface AwaitingPromo {
  productId: number;
  quantity: number;
}
const PROMO_PROMPT_TTL_MS = 10 * 60 * 1000;
const PROMO_ACTION = "awaiting_promo";

async function setAwaitingPromo(chatId: number | string, productId: number, quantity: number): Promise<void> {
  const key = String(chatId);
  const expiresAt = new Date(Date.now() + PROMO_PROMPT_TTL_MS);
  const payload = { productId, quantity };
  await db
    .insert(botPendingActionsTable)
    .values({ chatId: key, action: PROMO_ACTION, payload, expiresAt })
    .onConflictDoUpdate({
      target: [botPendingActionsTable.chatId, botPendingActionsTable.action],
      set: { payload, expiresAt },
    });
}
async function takeAwaitingPromo(chatId: number | string): Promise<AwaitingPromo | null> {
  const key = String(chatId);
  const [row] = await db
    .delete(botPendingActionsTable)
    .where(and(eq(botPendingActionsTable.chatId, key), eq(botPendingActionsTable.action, PROMO_ACTION)))
    .returning({ payload: botPendingActionsTable.payload, expiresAt: botPendingActionsTable.expiresAt });
  if (!row) return null;
  if (new Date(row.expiresAt).getTime() < Date.now()) return null;
  const p = row.payload as { productId?: unknown; quantity?: unknown };
  if (typeof p.productId !== "number" || typeof p.quantity !== "number") return null;
  return { productId: p.productId, quantity: p.quantity };
}
async function clearAwaitingPromo(chatId: number | string): Promise<void> {
  const key = String(chatId);
  await db
    .delete(botPendingActionsTable)
    .where(and(eq(botPendingActionsTable.chatId, key), eq(botPendingActionsTable.action, PROMO_ACTION)));
}
async function hasAwaitingPromo(chatId: number | string): Promise<boolean> {
  // Match the original Map.has() semantics: any row, even an expired one
  // that the sweep hasn't pruned yet, counts. takeAwaitingPromo() will then
  // see the expired row, return null, and produce the explicit "phiên đã
  // hết hạn" timeout message — preserving the prior UX.
  const key = String(chatId);
  const [row] = await db
    .select({ id: botPendingActionsTable.id })
    .from(botPendingActionsTable)
    .where(and(
      eq(botPendingActionsTable.chatId, key),
      eq(botPendingActionsTable.action, PROMO_ACTION),
    ))
    .limit(1);
  return !!row;
}

/**
 * Delete expired bot_pending_actions rows. Called from the periodic sweep so
 * abandoned prompts (customer never replied) don't accumulate.
 */
export async function cleanupExpiredBotPendingActions(): Promise<number> {
  const deleted = await db
    .delete(botPendingActionsTable)
    .where(lt(botPendingActionsTable.expiresAt, new Date()))
    .returning({ id: botPendingActionsTable.id });
  return deleted.length;
}

// In-memory state for customers asked to type a custom quantity or promo code.
interface AwaitingQuantity {
  productId: number;
  expiresAt: number;
  quantity?: number;
  awaitingPromoEntry?: boolean;
  appliedPromo?: { id: number; code: string; discountAmount: number };
}
const awaitingQuantity = new Map<string, AwaitingQuantity>();
const QUANTITY_PROMPT_TTL_MS = 10 * 60 * 1000;

function setAwaitingQuantity(chatId: number | string, productId: number): void {
  awaitingQuantity.set(String(chatId), { productId, expiresAt: Date.now() + QUANTITY_PROMPT_TTL_MS });
}
function peekAwaitingQuantity(chatId: number | string): AwaitingQuantity | null {
  const key = String(chatId);
  const entry = awaitingQuantity.get(key);
  if (!entry || entry.expiresAt < Date.now()) return null;
  return entry;
}
function updateAwaitingQuantity(chatId: number | string, updates: Partial<Omit<AwaitingQuantity, "productId" | "expiresAt">>): void {
  const key = String(chatId);
  const entry = awaitingQuantity.get(key);
  if (entry) awaitingQuantity.set(key, { ...entry, ...updates });
}
function takeAwaitingQuantity(chatId: number | string): AwaitingQuantity | null {
  const key = String(chatId);
  const entry = awaitingQuantity.get(key);
  if (!entry) return null;
  awaitingQuantity.delete(key);
  if (entry.expiresAt < Date.now()) return null;
  return entry;
}
function clearAwaitingQuantity(chatId: number | string): void {
  awaitingQuantity.delete(String(chatId));
}

interface ValidPromotion {
  id: number;
  name: string;
  code: string;
  discountAmount: number;
}

/**
 * Validate a promo code against an order subtotal. Returns the computed discount and promotion info,
 * or an error message string explaining why the code is invalid.
 */
async function validatePromoCode(rawCode: string, subtotal: number): Promise<ValidPromotion | { error: string }> {
  const code = rawCode.trim().toUpperCase();
  if (!code) return { error: "Mã giảm giá trống." };

  const [promo] = await db.select().from(promotionsTable).where(eq(promotionsTable.code, code));
  if (!promo) return { error: "Mã giảm giá không tồn tại." };
  if (!promo.isActive) return { error: "Mã giảm giá đã bị tạm dừng." };

  const now = new Date();
  if (promo.startDate && now < promo.startDate) return { error: "Mã giảm giá chưa đến thời gian áp dụng." };
  if (promo.endDate && now > promo.endDate) return { error: "Mã giảm giá đã hết hạn." };
  if (promo.usageLimit != null && promo.useCount >= promo.usageLimit) {
    return { error: "Mã giảm giá đã hết lượt sử dụng." };
  }

  const value = promo.discountValue != null ? parseFloat(promo.discountValue) : NaN;
  let discount = 0;
  if (promo.type === "percentage") {
    if (!isFinite(value) || value <= 0) return { error: "Mã giảm giá chưa được cấu hình giá trị hợp lệ." };
    discount = Math.round((subtotal * value) / 100);
  } else if (promo.type === "fixed") {
    if (!isFinite(value) || value <= 0) return { error: "Mã giảm giá chưa được cấu hình giá trị hợp lệ." };
    discount = value;
  } else {
    return { error: "Loại khuyến mãi này chưa hỗ trợ nhập mã. Vui lòng dùng mã giảm giá theo % hoặc số tiền cố định." };
  }

  if (discount > subtotal) discount = subtotal;
  if (discount <= 0) return { error: "Mã giảm giá không tạo ra khoản giảm hợp lệ." };

  return { id: promo.id, name: promo.name, code: promo.code ?? code, discountAmount: discount };
}

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; first_name?: string; last_name?: string; username?: string };
    chat: { id: number; type: string };
    text?: string;
    date: number;
  };
  callback_query?: {
    id: string;
    from: { id: number; first_name?: string; last_name?: string; username?: string };
    message?: { message_id: number; chat: { id: number } };
    data?: string;
  };
}

async function getBotConfig(): Promise<{ botToken: string | null; adminChatId: string | null; warrantyText: string | null; supportText: string | null; infoText: string | null; shopName: string | null; welcomeMessage: string | null }> {
  const { botConfigsTable } = await import("@workspace/db");
  const { desc } = await import("drizzle-orm");
  const [config] = await db.select().from(botConfigsTable).orderBy(desc(botConfigsTable.id)).limit(1);
  return {
    botToken: config?.botToken ?? null,
    adminChatId: config?.adminChatId ?? null,
    warrantyText: config?.warrantyText ?? null,
    supportText: config?.supportText ?? null,
    infoText: config?.infoText ?? null,
    shopName: config?.shopName ?? null,
    welcomeMessage: config?.welcomeMessage ?? null,
  };
}

// Default text shown when admin hasn't customized these sections yet.
const DEFAULT_WARRANTY_TEXT =
  "🛡️ <b>BẢO HÀNH</b>\n\n" +
  "Nhập <b>mã giao dịch</b> của đơn bạn đã mua để được hỗ trợ.\n" +
  "<i>Ví dụ:</i> <code>FT26044904376607</code>\n\n" +
  "• Nếu cần huỷ: gõ <code>/cancel</code>";

const DEFAULT_SUPPORT_TEXT =
  "💬 <b>HỖ TRỢ KHÁCH HÀNG</b>\n\n" +
  "📞 Liên hệ Admin: <i>(chưa cấu hình)</i>\n\n" +
  "⏰ <b>Thời gian hỗ trợ:</b>\n8:00 - 23:00 hàng ngày\n\n" +
  "📝 <b>Lưu ý:</b>\n" +
  "• Gửi mã giao dịch khi cần hỗ trợ\n" +
  "• Mô tả rõ vấn đề gặp phải\n" +
  "• Chờ phản hồi trong 5-10 phút\n\n" +
  "Cảm ơn bạn đã tin tưởng shop!";

const DEFAULT_INFO_TEXT =
  "ℹ️ <b>VỀ CỬA HÀNG</b>\n\n" +
  "🤖 <b>Giới thiệu:</b>\n" +
  "Bot bán hàng tự động hoạt động 24/7, giao hàng tức thì.\n\n" +
  "✅ <b>Cam kết:</b>\n" +
  "• Giao hàng tự động ngay lập tức\n" +
  "• Sản phẩm chất lượng, giá tốt\n" +
  "• Bảo hành theo từng sản phẩm\n" +
  "• Hỗ trợ nhanh chóng\n\n" +
  "💳 <b>Thanh toán:</b>\nChuyển khoản ngân hàng (QR)";

// Persistent reply keyboard shown below the chat input. Built per-request so
// any admin edits to the customizable info text or i18n strings take effect
// immediately on the next interaction.
async function mainReplyKeyboard(lang: Lang = "vi"): Promise<Record<string, unknown>> {
  const [buy, products, account, topup, voucher, warranty, support, info, settings] = await Promise.all([
    t("btn.buy", lang),
    t("btn.products", lang),
    t("btn.account", lang),
    t("btn.topup", lang),
    t("btn.voucher", lang),
    t("btn.warranty", lang),
    t("btn.support", lang),
    t("btn.info", lang),
    t("btn.settings", lang),
  ]);
  return {
    keyboard: [
      [{ text: buy }, { text: products }],
      [{ text: account }, { text: topup }],
      [{ text: voucher }, { text: warranty }, { text: support }],
      [{ text: info }, { text: settings }],
    ],
    resize_keyboard: true,
    is_persistent: true,
  };
}

// All button text variants across both languages — used to recognize a reply-
// keyboard tap regardless of the user's current locale.
const VI_REPLY_KEYBOARD_BUTTONS = new Set([
  "🛒 Mua hàng",
  "📋 Sản phẩm",
  "👤 Tài khoản",
  "💰 Nạp ví",
  "🎟️ Voucher",
  "🛡️ Bảo hành",
  "💬 Hỗ trợ",
  "ℹ️ Thông tin",
  "⚙️ Cài đặt",
]);

const EN_REPLY_KEYBOARD_BUTTONS = new Set([
  "🛒 Shop",
  "📋 Products",
  "👤 Account",
  "💰 Top Up",
  "🎟️ Voucher",
  "🛡️ Warranty",
  "💬 Support",
  "ℹ️ Info",
  "⚙️ Settings",
]);

// Map button text to a stable action key, language-independent
const BUTTON_ACTION: Record<string, string> = {
  // vi
  "🛒 Mua hàng": "shop",
  "📋 Sản phẩm": "shop",
  "👤 Tài khoản": "account",
  "💰 Nạp ví": "topup",
  "🎟️ Voucher": "voucher",
  "🛡️ Bảo hành": "warranty",
  "💬 Hỗ trợ": "support",
  "ℹ️ Thông tin": "info",
  "⚙️ Cài đặt": "settings",
  // en
  "🛒 Shop": "shop",
  "📋 Products": "shop",
  "👤 Account": "account",
  "💰 Top Up": "topup",
  "🎟️ Voucher": "voucher",
  "🛡️ Warranty": "warranty",
  "💬 Support": "support",
  "ℹ️ Info": "info",
  "⚙️ Settings": "settings",
};

async function getBotToken(): Promise<string | null> {
  const { botToken } = await getBotConfig();
  return botToken;
}

export async function getAdminChatId(): Promise<string | null> {
  const { adminChatId } = await getBotConfig();
  return adminChatId;
}

async function sendMessage(chatId: number | string, text: string, options?: Record<string, unknown>): Promise<boolean> {
  const token = await getBotToken();
  if (!token) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", ...options }),
    });
    const data = await res.json() as { ok: boolean; description?: string };
    if (!data.ok) {
      logger.warn({ chatId, error: data.description }, "Telegram sendMessage returned ok=false");
      return false;
    }
    return true;
  } catch (err) {
    logger.error({ err }, "Failed to send Telegram message");
    return false;
  }
}

/**
 * Edit an existing Telegram message. Returns true if the edit succeeded.
 * Telegram returns ok=false with "message is not modified" when the new text/markup
 * are identical to the current ones — that's not a real failure, so we treat it as success.
 */
async function editMessage(chatId: number | string, messageId: number, text: string, options?: Record<string, unknown>): Promise<boolean> {
  const token = await getBotToken();
  if (!token) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId, text, parse_mode: "HTML", ...options }),
    });
    const data = await res.json() as { ok: boolean; description?: string };
    if (!data.ok) {
      const desc = data.description ?? "";
      if (/message is not modified/i.test(desc)) return true;
      logger.warn({ chatId, messageId, error: desc }, "Telegram editMessageText returned ok=false");
      return false;
    }
    return true;
  } catch (err) {
    logger.error({ err }, "Failed to edit Telegram message");
    return false;
  }
}

/**
 * Render a menu view: edits the existing inline-keyboard message in place when
 * `editMessageId` is provided (i.e. we're handling a callback query), otherwise
 * sends a brand new message. Falls back to sendMessage if the edit fails (e.g.
 * the original message is too old or was deleted).
 */
async function renderView(chatId: number | string, editMessageId: number | undefined, text: string, options?: Record<string, unknown>): Promise<boolean> {
  if (editMessageId !== undefined) {
    const edited = await editMessage(chatId, editMessageId, text, options);
    if (edited) return true;
  }
  return sendMessage(chatId, text, options);
}

async function sendPhoto(chatId: number | string, photoUrl: string, caption?: string, reply_markup?: object): Promise<boolean> {
  const token = await getBotToken();
  if (!token) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, photo: photoUrl, caption, parse_mode: "HTML", ...(reply_markup ? { reply_markup } : {}) }),
    });
    const data = await res.json() as { ok: boolean; description?: string };
    if (!data.ok) {
      logger.warn({ chatId, error: data.description }, "Telegram sendPhoto returned ok=false");
      return false;
    }
    return true;
  } catch (err) {
    logger.error({ err }, "Failed to send Telegram photo");
    return false;
  }
}

export async function sendMessageToCustomer(chatId: string, text: string): Promise<void> {
  await sendMessage(chatId, text);
}

async function answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
  const token = await getBotToken();
  if (!token) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
    });
  } catch (err) {
    logger.error({ err }, "Failed to answer callback query");
  }
}

async function logBotAction(action: string, chatId?: string, customerId?: number, content?: string, metadata?: unknown, level = "info"): Promise<void> {
  try {
    await db.insert(botLogsTable).values({ action, chatId, customerId, content, metadata: metadata as Record<string, unknown>, level });
  } catch (err) {
    logger.error({ err }, "Failed to log bot action");
  }
}

/**
 * Send an alert message to the admin's Telegram chat.
 * If no adminChatId is configured, logs the alert to bot_logs only.
 */
export async function sendAdminAlert(message: string, metadata?: Record<string, unknown>): Promise<void> {
  const adminChatId = await getAdminChatId();

  await logBotAction("admin_alert", adminChatId ?? undefined, undefined, message, metadata, "warn");

  if (!adminChatId) {
    logger.warn({ message, metadata }, "Admin alert skipped — no adminChatId configured");
    return;
  }

  const sent = await sendMessage(adminChatId, `⚠️ <b>Cảnh báo Admin</b>\n\n${message}`);
  if (!sent) {
    logger.warn({ adminChatId, message }, "Failed to deliver admin alert via Telegram");
  }
}

/**
 * Send an informational notification to the admin's Telegram chat (success/info level).
 * If no adminChatId is configured, logs the notification to bot_logs only.
 */
export async function sendAdminNotification(message: string, metadata?: Record<string, unknown>): Promise<void> {
  const adminChatId = await getAdminChatId();

  await logBotAction("admin_notification", adminChatId ?? undefined, undefined, message, metadata, "info");

  if (!adminChatId) {
    logger.info({ message, metadata }, "Admin notification skipped — no adminChatId configured");
    return;
  }

  const sent = await sendMessage(adminChatId, `ℹ️ <b>Thông báo Admin</b>\n\n${message}`);
  if (!sent) {
    logger.warn({ adminChatId, message }, "Failed to deliver admin notification via Telegram");
  }
}

/**
 * Broadcast a restock notification for the given product to all active customers.
 * Sends messages in small batches with short delays to stay within Telegram's
 * 30 msg/s global rate limit. Returns { sent, total }.
 */
export async function broadcastProductNotification(
  productId: number,
  productName: string,
  productPrice: string,
): Promise<{ sent: number; total: number; botConfigured: boolean }> {
  const token = await getBotToken();
  if (!token) return { sent: 0, total: 0, botConfigured: false };

  const customers = await db
    .select({ chatId: customersTable.chatId })
    .from(customersTable)
    .where(eq(customersTable.isActive, true));

  const priceFormatted = parseFloat(productPrice).toLocaleString("vi-VN");
  const text =
    `🔔 <b>Sản phẩm vừa có hàng!</b>\n\n` +
    `📦 <b>${productName}</b>\n` +
    `💰 Giá: <b>${priceFormatted}đ</b>\n\n` +
    `Bấm nút bên dưới để mua ngay!`;

  const inlineKeyboard = {
    inline_keyboard: [[{ text: "🛒 Mua ngay", callback_data: `prod_${productId}` }]],
  };

  const BATCH_SIZE = 25;
  const BATCH_DELAY_MS = 1000;

  let sent = 0;
  const total = customers.length;

  for (let i = 0; i < customers.length; i += BATCH_SIZE) {
    const batch = customers.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (c) => {
        const ok = await sendMessage(c.chatId, text, { reply_markup: inlineKeyboard });
        if (ok) sent++;
      }),
    );
    if (i + BATCH_SIZE < customers.length) {
      await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }

  await logBotAction(
    "broadcast_restock",
    undefined,
    undefined,
    `Broadcast for product ${productId} (${productName}): ${sent}/${total} sent`,
    { productId, productName, sent, total },
  );

  return { sent, total, botConfigured: true };
}

async function upsertCustomer(from: { id: number; first_name?: string; last_name?: string; username?: string }): Promise<{ customer: typeof customersTable.$inferSelect; isNew: boolean }> {
  const chatId = String(from.id);
  const [existing] = await db.select().from(customersTable).where(eq(customersTable.chatId, chatId));
  if (existing) {
    const [updated] = await db.update(customersTable).set({
      firstName: from.first_name ?? existing.firstName,
      lastName: from.last_name ?? existing.lastName,
      username: from.username ?? existing.username,
      lastActiveAt: new Date(),
    }).where(eq(customersTable.id, existing.id)).returning();
    return { customer: updated, isNew: false };
  }
  const [customer] = await db.insert(customersTable).values({
    chatId,
    firstName: from.first_name,
    lastName: from.last_name,
    username: from.username,
    language: "vi",
    lastActiveAt: new Date(),
  }).returning();
  return { customer, isNew: true };
}

async function saveCustomerLanguage(customerId: number, lang: Lang): Promise<void> {
  await db.update(customersTable).set({ language: lang }).where(eq(customersTable.id, customerId));
}

/**
 * Escape characters that have special meaning in Telegram's HTML parse mode
 * (`&`, `<`, `>`). Must be called on any dynamic/user-supplied string before
 * it is embedded in a message template.
 */
function escapeHtmlEntities(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Convert a lightweight subset of Markdown to Telegram HTML.
 *
 * IMPORTANT: call this on text that has already been HTML-escaped so that
 * dynamic values (names, shop names) cannot inject arbitrary HTML tags.
 *
 *   **bold**  → <b>bold</b>
 *   __bold__  → <b>bold</b>
 *   *italic*  → <i>italic</i>
 *   _italic_  → <i>italic</i>
 *
 * Intentional `<b>/<i>` tags inserted by our code (e.g. for placeholder
 * substitution) must be injected AFTER this call so they are not escaped.
 */
function mdToHtml(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/gs, "<b>$1</b>")
    .replace(/__(.+?)__/gs, "<b>$1</b>")
    .replace(/(?<!\*)\*([^*\n]+?)\*(?!\*)/g, "<i>$1</i>")
    .replace(/(?<!_)_([^_\n]+?)_(?!_)/g, "<i>$1</i>");
}

async function showMainMenu(chatId: number | string, customerName?: string, editMessageId?: number, lang: Lang = "vi"): Promise<void> {
  const name = customerName ?? (lang === "en" ? "there" : "bạn");
  const { shopName, welcomeMessage } = await getBotConfig();

  // Escape dynamic values so special chars (&, <, >) do not break Telegram HTML.
  const safeName = escapeHtmlEntities(name);
  const safeShopName = shopName ? escapeHtmlEntities(shopName) : null;

  let welcomeText: string;
  if (welcomeMessage && welcomeMessage.trim()) {
    // Admin has configured a custom welcome message.
    const escapedTemplate = escapeHtmlEntities(welcomeMessage);
    const withMarkdown = mdToHtml(escapedTemplate);
    welcomeText = withMarkdown
      .replace(/\{name\}/g, `<b>${safeName}</b>`)
      .replace(/\{shop_name\}/g, safeShopName ? `<b>${safeShopName}</b>` : (lang === "en" ? "our shop" : "cửa hàng"));
  } else {
    const defaultTemplate = await t("welcome.default", lang);
    const shop = safeShopName ? `<b>${safeShopName}</b>` : (lang === "en" ? "our shop" : "cửa hàng");
    welcomeText = defaultTemplate
      .replace(/\{name\}/g, `<b>${safeName}</b>`)
      .replace(/\{shop\}/g, shop);
  }

  const [browseLabel, ordersLabel, walletLabel] = await Promise.all([
    t("btn.browse_products", lang),
    t("btn.my_orders", lang),
    t("btn.wallet_history", lang),
  ]);

  // Render the inline menu (in place when navigating). The persistent reply
  // keyboard is attached separately on /start so it survives across edits.
  await renderView(chatId, editMessageId, welcomeText, {
    reply_markup: {
      inline_keyboard: [
        [{ text: browseLabel, callback_data: "browse_products" }],
        [{ text: ordersLabel, callback_data: "my_orders" }],
        [{ text: walletLabel, callback_data: "wallet_history" }],
      ],
    },
  });
}

// Show language selection prompt. Shown to new users on /start or when they
// request a language change from the settings menu.
async function showLanguageSelection(chatId: number | string): Promise<void> {
  const prompt = await t("lang.prompt", "vi"); // always shown in both languages (bilingual)
  const viLabel = await t("lang.vi", "vi");
  const enLabel = await t("lang.en", "en");
  await sendMessage(chatId, prompt, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: viLabel, callback_data: "set_lang_vi" },
          { text: enLabel, callback_data: "set_lang_en" },
        ],
      ],
    },
  });
}

// Show / refresh the persistent bottom reply keyboard. Telegram only renders a
// reply keyboard when it's attached to a freshly sent message (it can't be
// added via editMessage), so we send a tiny anchor message whenever we want to
// guarantee the keyboard is visible — typically right after /start.
async function showReplyKeyboard(chatId: number | string, lang: Lang = "vi"): Promise<void> {
  const label = await t("welcome.keyboard_ready", lang);
  await sendMessage(chatId, label, {
    reply_markup: await mainReplyKeyboard(lang),
  });
}

// Show the settings menu (language change, etc.)
async function showSettingsMenu(chatId: number | string, editMessageId?: number, lang: Lang = "vi"): Promise<void> {
  const title = lang === "en" ? "⚙️ <b>Settings</b>" : "⚙️ <b>Cài đặt</b>";
  const langLabel = await t("btn.language", lang);
  const homeLabel = await t("btn.home", lang);
  await renderView(chatId, editMessageId, title, {
    reply_markup: {
      inline_keyboard: [
        [{ text: langLabel, callback_data: "change_lang" }],
        [{ text: homeLabel, callback_data: "main_menu" }],
      ],
    },
  });
}

async function showAccountInfo(chatId: number | string, customer: typeof customersTable.$inferSelect, lang: Lang = "vi"): Promise<void> {
  const { sql: drizzleSql } = await import("drizzle-orm");
  const balance = parseFloat(customer.balance ?? "0");
  const [orderStats] = await db.select({
    totalOrders: drizzleSql<number>`COUNT(*)::int`,
    totalSpent: drizzleSql<number>`COALESCE(SUM(CASE WHEN status IN ('paid','delivered') THEN total_amount::numeric ELSE 0 END), 0)::numeric`,
  }).from(ordersTable).where(eq(ordersTable.customerId, customer.id));

  const totalOrders = Number(orderStats?.totalOrders ?? 0);
  const totalSpent = Number(orderStats?.totalSpent ?? 0);
  const noUsername = await t("account.no_username", lang);
  const username = customer.username ? `@${customer.username}` : noUsername;

  const strings = await tMany([
    "account.title", "account.id", "account.name", "account.username",
    "account.balance", "account.total_orders", "account.total_spent",
    "account.topup_cmd", "account.history_cmd"
  ], lang);

  const locale = lang === "en" ? "en-US" : "vi-VN";
  const msg =
    `${strings["account.title"]}\n\n` +
    `${strings["account.id"]} <code>${customer.chatId}</code>\n` +
    `${strings["account.name"]} ${customer.firstName ?? "-"}${customer.lastName ? " " + customer.lastName : ""}\n` +
    `${strings["account.username"]} ${username}\n\n` +
    `${strings["account.balance"]} ${balance.toLocaleString(locale)}đ\n` +
    `${strings["account.total_orders"]} ${totalOrders}\n` +
    `${strings["account.total_spent"]} ${totalSpent.toLocaleString(locale)}đ\n\n` +
    `${strings["account.topup_cmd"]}\n` +
    `${strings["account.history_cmd"]}`;
  await sendMessage(chatId, msg);
}

async function showTopupInstructions(chatId: number | string, lang: Lang = "vi"): Promise<void> {
  const strings = await tMany(["topup.title", "topup.instruction", "topup.minimum", "topup.qr_note"], lang);
  const msg =
    `${strings["topup.title"]}\n\n` +
    `${strings["topup.instruction"]}\n\n` +
    `${strings["topup.minimum"]}\n` +
    `${strings["topup.qr_note"]}`;
  await sendMessage(chatId, msg);
}

async function showActivePromotions(chatId: number | string, lang: Lang = "vi"): Promise<void> {
  // Show promotions that are currently active and not expired.
  const now = new Date();
  const promos = await db.select().from(promotionsTable)
    .where(and(eq(promotionsTable.isActive, true)))
    .orderBy(desc(promotionsTable.priority));
  const visible = promos.filter(p => {
    if (p.startDate && new Date(p.startDate) > now) return false;
    if (p.endDate && new Date(p.endDate) < now) return false;
    return true;
  }).slice(0, 10);

  const strings = await tMany(["voucher.title", "voucher.none", "voucher.enter_hint"], lang);
  const locale = lang === "en" ? "en-US" : "vi-VN";

  if (visible.length === 0) {
    await sendMessage(chatId, `${strings["voucher.title"]}\n\n${strings["voucher.none"]}`);
    return;
  }
  let msg = `${strings["voucher.title"]}\n\n`;
  const discountWord = lang === "en" ? "off" : "giảm";
  for (const p of visible) {
    const code = (p as unknown as { code?: string }).code;
    const value = (p as unknown as { discountValue?: string }).discountValue;
    const discountText = p.type === "percentage" ? `${value}%` : `${parseFloat(value ?? "0").toLocaleString(locale)}đ`;
    if (code) {
      msg += `• <code>${code}</code> — ${p.name} (${discountWord} ${discountText})\n`;
    } else {
      msg += `• ${p.name} (${discountWord} ${discountText})\n`;
    }
  }
  msg += `\n${strings["voucher.enter_hint"]}`;
  await sendMessage(chatId, msg);
}

async function showCategories(chatId: number | string, editMessageId?: number, lang: Lang = "vi"): Promise<void> {
  const { categoriesTable } = await import("@workspace/db");
  const categories = await db.select().from(categoriesTable).where(eq(categoriesTable.isActive, true));
  const [noneMsg, backLabel, titleLabel] = await Promise.all([
    t("cat.none", lang),
    t("btn.home", lang),
    t("cat.title", lang),
  ]);
  if (categories.length === 0) {
    await renderView(chatId, editMessageId, noneMsg, {
      reply_markup: { inline_keyboard: [[{ text: backLabel, callback_data: "main_menu" }]] },
    });
    return;
  }
  const keyboard = categories.map(c => [{ text: `${c.icon ?? "📁"} ${c.name}`, callback_data: `cat_${c.id}` }]);
  keyboard.push([{ text: await t("btn.back", lang), callback_data: "main_menu" }]);
  await renderView(chatId, editMessageId, titleLabel, { reply_markup: { inline_keyboard: keyboard } });
}

async function showProducts(chatId: number | string, categoryId: number, editMessageId?: number, lang: Lang = "vi"): Promise<void> {
  const { sql } = await import("drizzle-orm");
  const products = await db.select({
    id: productsTable.id,
    name: productsTable.name,
    price: productsTable.price,
    productIcon: productsTable.productIcon,
    stockCount: sql<number>`(SELECT COUNT(*) FROM product_stocks WHERE product_id = ${productsTable.id} AND status = 'available')::int`,
  }).from(productsTable).where(and(eq(productsTable.categoryId, categoryId), eq(productsTable.isActive, true)));

  const [noneMsg, backLabel, titleLabel] = await Promise.all([
    t("prod.none", lang),
    t("btn.back", lang),
    t("prod.title", lang),
  ]);
  const locale = lang === "en" ? "en-US" : "vi-VN";

  if (products.length === 0) {
    await renderView(chatId, editMessageId, noneMsg, {
      reply_markup: { inline_keyboard: [[{ text: backLabel, callback_data: "browse_products" }]] },
    });
    return;
  }
  const keyboard = products.map(p => [{
    text: `${p.productIcon ?? "📦"} ${p.name} - ${parseFloat(p.price).toLocaleString(locale)}đ ${p.stockCount > 0 ? "✅" : "❌"}`,
    callback_data: `prod_${p.id}`,
  }]);
  keyboard.push([{ text: backLabel, callback_data: "browse_products" }]);
  await renderView(chatId, editMessageId, titleLabel, { reply_markup: { inline_keyboard: keyboard } });
}

async function showProductDetail(chatId: number | string, productId: number, editMessageId?: number, lang: Lang = "vi"): Promise<void> {
  const { sql } = await import("drizzle-orm");
  const [product] = await db.select({
    id: productsTable.id,
    name: productsTable.name,
    description: productsTable.description,
    price: productsTable.price,
    originalPrice: productsTable.originalPrice,
    minQuantity: productsTable.minQuantity,
    maxQuantity: productsTable.maxQuantity,
    stockCount: sql<number>`(SELECT COUNT(*) FROM product_stocks WHERE product_id = ${productsTable.id} AND status = 'available')::int`,
  }).from(productsTable).where(eq(productsTable.id, productId));

  const strings = await tMany([
    "prod.not_found", "btn.home", "prod.in_stock", "prod.out_of_stock",
    "prod.price", "prod.stock", "prod.qty_range", "prod.max_qty",
    "prod.enter_qty", "prod.stock_request", "btn.back"
  ], lang);
  const locale = lang === "en" ? "en-US" : "vi-VN";

  if (!product) {
    await renderView(chatId, editMessageId, strings["prod.not_found"], {
      reply_markup: { inline_keyboard: [[{ text: strings["btn.home"], callback_data: "main_menu" }]] },
    });
    return;
  }

  // Find the category so the "back" button can return to the product list of the same category.
  const [productCategory] = await db.select({ categoryId: productsTable.categoryId })
    .from(productsTable).where(eq(productsTable.id, productId));
  const categoryId = productCategory?.categoryId;

  const priceFormatted = parseFloat(product.price).toLocaleString(locale);
  const originalFormatted = product.originalPrice ? `<s>${parseFloat(product.originalPrice).toLocaleString(locale)}đ</s> ` : "";
  const stockText = product.stockCount > 0
    ? `${strings["prod.in_stock"]} (${product.stockCount})`
    : strings["prod.out_of_stock"];

  let msg = `📦 <b>${product.name}</b>\n`;
  if (product.description) msg += `\n${product.description}\n`;
  msg += `\n${strings["prod.price"]} ${originalFormatted}<b>${priceFormatted}đ</b>`;
  msg += `\n${strings["prod.stock"]} ${stockText}`;
  msg += `\n${strings["prod.qty_range"]} ${product.minQuantity} - ${product.maxQuantity}`;

  const keyboard: Array<Array<{ text: string; callback_data: string }>> = [];
  const minQ = product.minQuantity;
  const maxQ = product.maxQuantity;
  // Show purchase actions whenever there's at least enough stock for the
  // minimum quantity. The "max" and custom-input options always reflect the
  // configured maxQuantity (not the live stock) — a customer who tries to buy
  // more than available will get a clear "not enough stock" error at order
  // time. Clamping by stock here was confusing: the header showed "Số lượng:
  // 1 - 3" but the keyboard only offered "1" when stock was 1.
  if (product.stockCount >= minQ) {
    const row: Array<{ text: string; callback_data: string }> = [];
    row.push({ text: `${minQ}`, callback_data: `qty_${productId}_${minQ}` });
    if (maxQ > minQ) {
      row.push({ text: `${strings["prod.max_qty"]} (${maxQ})`, callback_data: `qty_${productId}_${maxQ}` });
    }
    keyboard.push(row);
    if (maxQ > minQ) {
      keyboard.push([{ text: strings["prod.enter_qty"], callback_data: `qty_input_${productId}` }]);
    }
  } else {
    keyboard.push([{ text: strings["prod.stock_request"], callback_data: `stock_request_${productId}` }]);
  }
  const backRow: Array<{ text: string; callback_data: string }> = [];
  if (categoryId !== undefined && categoryId !== null) {
    backRow.push({ text: strings["btn.back"], callback_data: `cat_${categoryId}` });
  } else {
    backRow.push({ text: strings["btn.back"], callback_data: "browse_products" });
  }
  backRow.push({ text: strings["btn.home"], callback_data: "main_menu" });
  keyboard.push(backRow);

  await renderView(chatId, editMessageId, msg, { reply_markup: { inline_keyboard: keyboard } });
}

// Look up the most recent promo code the customer successfully used within the
// last 7 days, so we can offer a one-tap "Dùng lại" button instead of forcing
// them to retype it. Only paid / delivered orders count — we don't want to
// suggest a code that came from an abandoned cart.
const RECENT_PROMO_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
async function findRecentPromotionForCustomer(customerId: number): Promise<{ id: number; code: string } | null> {
  const since = new Date(Date.now() - RECENT_PROMO_WINDOW_MS);
  const [row] = await db.select({
    id: promotionsTable.id,
    code: promotionsTable.code,
  })
    .from(ordersTable)
    .innerJoin(promotionsTable, eq(promotionsTable.id, ordersTable.promotionId))
    .where(sqlOp`${ordersTable.customerId} = ${customerId} AND ${ordersTable.promotionId} IS NOT NULL AND ${ordersTable.status} IN ('paid','delivered') AND ${ordersTable.createdAt} >= ${since}`)
    .orderBy(desc(ordersTable.createdAt))
    .limit(1);
  if (!row || !row.code) return null;
  return { id: row.id, code: row.code };
}

async function promptForPromoCode(chatId: number | string, customerId: number, productId: number, quantity: number, editMessageId?: number): Promise<void> {
  const { sql, count } = await import("drizzle-orm");
  const [product] = await db.select({
    id: productsTable.id,
    name: productsTable.name,
    price: productsTable.price,
    minQuantity: productsTable.minQuantity,
    maxQuantity: productsTable.maxQuantity,
  }).from(productsTable).where(eq(productsTable.id, productId));

  if (!product) {
    await renderView(chatId, editMessageId, "❌ Sản phẩm không còn tồn tại.", {
      reply_markup: { inline_keyboard: [[{ text: "🏠 Trang chủ", callback_data: "main_menu" }]] },
    });
    return;
  }
  const [stockRow] = await db.select({ c: count() }).from(productStocksTable).where(sql`${productStocksTable.productId} = ${productId} AND ${productStocksTable.status} = 'available'`);
  const stockCount = Number(stockRow?.c ?? 0);
  if (quantity < product.minQuantity || quantity > product.maxQuantity) {
    await renderView(chatId, editMessageId, `❌ Số lượng không hợp lệ. Mua từ ${product.minQuantity} đến ${product.maxQuantity}.`, {
      reply_markup: { inline_keyboard: [[{ text: "⬅️ Quay lại", callback_data: `prod_${productId}` }]] },
    });
    return;
  }
  if (stockCount < quantity) {
    if (stockCount === 0) {
      await renderView(chatId, editMessageId, `❌ <b>${product.name}</b> hiện đã hết hàng.\n\nBạn có thể yêu cầu shop nhập thêm hàng.`, {
        reply_markup: {
          inline_keyboard: [
            [{ text: "🔔 Yêu cầu hàng mới", callback_data: `stock_request_${productId}` }],
            [{ text: "⬅️ Quay lại", callback_data: `prod_${productId}` }, { text: "🏠 Trang chủ", callback_data: "main_menu" }],
          ],
        },
      });
    } else {
      await renderView(chatId, editMessageId, `❌ Không đủ hàng. Chỉ còn <b>${stockCount}</b> sản phẩm. Vui lòng chọn số lượng phù hợp.`, {
        reply_markup: { inline_keyboard: [[{ text: "⬅️ Quay lại", callback_data: `prod_${productId}` }]] },
      });
    }
    return;
  }

  const subtotal = parseFloat(product.price) * quantity;
  const subtotalFormatted = subtotal.toLocaleString("vi-VN");

  await setAwaitingPromo(chatId, productId, quantity);
  await logBotAction("promo_prompt", String(chatId), customerId, `Promo prompt for ${product.name} x${quantity}`, { productId, quantity });

  const recent = await findRecentPromotionForCustomer(customerId);

  const msg =
    `🛒 <b>${product.name}</b> x${quantity} — ${subtotalFormatted}đ\n\n` +
    `🎟️ <b>Nhập mã giảm giá (hoặc bỏ qua)</b>\n` +
    `<i>Gõ mã giảm giá vào ô chat, hoặc bấm "Bỏ qua" để tiếp tục.</i>` +
    (recent ? `\n\n<i>Lần trước bạn đã dùng mã <code>${recent.code}</code>.</i>` : "");

  // Top row: "Dùng lại MÃXXX" (when available) alongside "Bỏ qua".
  const topRow: Array<{ text: string; callback_data: string }> = [];
  if (recent) {
    topRow.push({ text: `🔁 Dùng lại ${recent.code}`, callback_data: `reuse_promo_${recent.id}_${productId}_${quantity}` });
  }
  topRow.push({ text: "⏭️ Bỏ qua", callback_data: `skip_promo_${productId}_${quantity}` });

  await renderView(chatId, editMessageId, msg, {
    reply_markup: {
      inline_keyboard: [
        topRow,
        [{ text: "⬅️ Quay lại", callback_data: `prod_${productId}` }, { text: "🏠 Trang chủ", callback_data: "main_menu" }],
      ],
    },
  });
}

/**
 * Shows the order confirmation screen where the customer can optionally apply
 * a promo code before placing the order. This replaces the old separate promo
 * screen — promo entry is now inline within the quantity confirmation step.
 */
async function showOrderConfirmScreen(
  chatId: number | string,
  customerId: number,
  productId: number,
  quantity: number,
  appliedPromo: { id: number; code: string; discountAmount: number } | null,
  editMessageId?: number,
): Promise<void> {
  const { sql, count } = await import("drizzle-orm");
  const [product] = await db.select({
    id: productsTable.id,
    name: productsTable.name,
    price: productsTable.price,
    minQuantity: productsTable.minQuantity,
    maxQuantity: productsTable.maxQuantity,
  }).from(productsTable).where(eq(productsTable.id, productId));

  if (!product) {
    await renderView(chatId, editMessageId, "❌ Sản phẩm không còn tồn tại.", {
      reply_markup: { inline_keyboard: [[{ text: "🏠 Trang chủ", callback_data: "main_menu" }]] },
    });
    return;
  }

  const [stockRow] = await db.select({ c: count() }).from(productStocksTable)
    .where(sql`${productStocksTable.productId} = ${productId} AND ${productStocksTable.status} = 'available'`);
  const stockCount = Number(stockRow?.c ?? 0);

  if (quantity < product.minQuantity || quantity > product.maxQuantity) {
    await showProductDetail(chatId, productId, editMessageId);
    return;
  }

  if (stockCount < quantity) {
    // Redirect to the live product detail so the customer always sees the
    // accurate, up-to-date stock status (Hết hàng / reduced count) rather
    // than a stale counter from the previous render.
    await showProductDetail(chatId, productId, editMessageId);
    return;
  }

  // Persist the current state (product + qty + promo) so any subsequent text
  // typed by the customer is recognised as a promo code entry.
  awaitingQuantity.set(String(chatId), {
    productId,
    quantity,
    expiresAt: Date.now() + QUANTITY_PROMPT_TTL_MS,
    appliedPromo: appliedPromo ?? undefined,
  });

  const subtotal = parseFloat(product.price) * quantity;
  const discount = appliedPromo ? appliedPromo.discountAmount : 0;
  const finalTotal = Math.max(0, subtotal - discount);
  const subtotalFormatted = subtotal.toLocaleString("vi-VN");
  const finalFormatted = finalTotal.toLocaleString("vi-VN");

  let msg = `🛒 <b>${product.name}</b> × ${quantity}\n\n`;
  if (appliedPromo) {
    msg += `💰 Tạm tính: <s>${subtotalFormatted}đ</s>\n`;
    msg += `🎟️ Mã <code>${appliedPromo.code}</code>: −${appliedPromo.discountAmount.toLocaleString("vi-VN")}đ\n`;
    msg += `💵 <b>Tổng: ${finalFormatted}đ</b>`;
  } else {
    msg += `💵 <b>Tổng: ${subtotalFormatted}đ</b>`;
  }

  const keyboard: Array<Array<{ text: string; callback_data: string }>> = [];

  // Promo row: clear existing code OR enter a new one (+ quick reuse)
  if (appliedPromo) {
    keyboard.push([{ text: `❌ Bỏ mã: ${appliedPromo.code}`, callback_data: `clear_promo_${productId}_${quantity}` }]);
  } else {
    const promoRow: Array<{ text: string; callback_data: string }> = [
      { text: "🎟️ Nhập mã giảm giá", callback_data: `promo_enter_${productId}_${quantity}` },
    ];
    const recent = await findRecentPromotionForCustomer(customerId);
    if (recent) {
      promoRow.push({ text: `🔁 ${recent.code}`, callback_data: `reuse_promo_${recent.id}_${productId}_${quantity}` });
    }
    keyboard.push(promoRow);
  }

  const promoSuffix = appliedPromo ? `_${appliedPromo.id}` : "";
  keyboard.push([{ text: "✅ Đặt hàng", callback_data: `confirm_order_${productId}_${quantity}${promoSuffix}` }]);
  keyboard.push([{ text: "⬅️ Quay lại", callback_data: `prod_${productId}` }, { text: "🏠 Trang chủ", callback_data: "main_menu" }]);

  await renderView(chatId, editMessageId, msg, { reply_markup: { inline_keyboard: keyboard } });
}

async function createOrderFromBot(chatId: number | string, customerId: number, productId: number, quantity: number, promotion: ValidPromotion | null = null): Promise<void> {
  const { sql, count } = await import("drizzle-orm");
  const [product] = await db.select({
    id: productsTable.id,
    name: productsTable.name,
    price: productsTable.price,
    minQuantity: productsTable.minQuantity,
    maxQuantity: productsTable.maxQuantity,
  }).from(productsTable).where(eq(productsTable.id, productId));

  if (!product) {
    await sendMessage(chatId, "❌ Sản phẩm không còn tồn tại.");
    return;
  }
  const [stockRow] = await db.select({ c: count() }).from(productStocksTable).where(sql`${productStocksTable.productId} = ${productId} AND ${productStocksTable.status} = 'available'`);
  const stockCount = Number(stockRow?.c ?? 0);

  if (quantity < product.minQuantity || quantity > product.maxQuantity) {
    await sendMessage(chatId, `❌ Số lượng không hợp lệ. Mua từ ${product.minQuantity} đến ${product.maxQuantity}.`);
    return;
  }

  if (stockCount < quantity) {
    if (stockCount === 0) {
      await sendMessage(chatId, `❌ <b>${product.name}</b> hiện đã hết hàng. Vui lòng quay lại sau.`, {
        reply_markup: {
          inline_keyboard: [
            [{ text: "🔔 Yêu cầu hàng mới", callback_data: `stock_request_${productId}` }],
            [{ text: "🏠 Trang chủ", callback_data: "main_menu" }],
          ],
        },
      });
    } else {
      await sendMessage(chatId, `❌ Không đủ hàng. Chỉ còn <b>${stockCount}</b> sản phẩm.`, {
        reply_markup: { inline_keyboard: [[{ text: "⬅️ Quay lại", callback_data: `prod_${productId}` }]] },
      });
    }
    return;
  }

  const subtotal = parseFloat(product.price) * quantity;
  const discount = promotion ? promotion.discountAmount : 0;
  const finalTotal = Math.max(0, subtotal - discount);
  const totalAmount = finalTotal.toFixed(2);
  const discountAmount = discount.toFixed(2);
  // Order code follows the SePay default template: prefix "DH" + 8 alphanumeric
  // chars (uppercase letters + digits). Total length 10, fits SePay's 2-5 prefix
  // and 3-10 suffix rules. Example: DHA1B2C3D4. SePay matches transfers whose
  // description contains this code, so it must be unique and easy to type.
  const ORDER_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // omit confusing 0/O/1/I
  const randomBytes = (await import("node:crypto")).randomBytes(8);
  let suffix = "";
  for (let i = 0; i < 8; i++) {
    suffix += ORDER_CODE_ALPHABET[randomBytes[i] % ORDER_CODE_ALPHABET.length];
  }
  const orderCode = `DH${suffix}`;

  // Atomically create the order AND reserve stock rows in one transaction.
  // If concurrent buyers have depleted stock since our pre-check, the reservation
  // will find fewer rows (SKIP LOCKED means held rows are simply not returned),
  // and we abort the entire transaction — no order is created, no stock double-claimed.
  const STOCK_DEPLETED_AT_CREATION = "STOCK_DEPLETED_AT_ORDER_CREATION";
  let order: typeof ordersTable.$inferSelect;

  try {
    order = await db.transaction(async (tx) => {
      const [newOrder] = await tx.insert(ordersTable).values({
        orderCode,
        customerId,
        totalAmount,
        promotionId: promotion ? promotion.id : null,
        discountAmount,
        status: "pending",
      }).returning();

      await tx.insert(orderItemsTable).values({
        orderId: newOrder.id,
        productId: product.id,
        productName: product.name,
        quantity,
        unitPrice: product.price,
        totalPrice: subtotal.toFixed(2),
      });

      // Lock exactly 'quantity' available stock rows and mark them 'reserved'
      // for this order. Any row locked by another concurrent transaction is
      // skipped (SKIP LOCKED), so if we can't reserve enough, stock is gone.
      const reserved = await tx.execute(
        sqlOp`UPDATE product_stocks
              SET status = 'reserved', order_id = ${newOrder.id}
              WHERE id IN (
                SELECT id FROM product_stocks
                WHERE product_id = ${productId} AND status = 'available'
                ORDER BY created_at
                LIMIT ${quantity}
                FOR UPDATE SKIP LOCKED
              )
              RETURNING id`
      );
      const reservedRows = reserved.rows as Array<{ id: number }>;
      if (reservedRows.length < quantity) throw new Error(STOCK_DEPLETED_AT_CREATION);

      return newOrder;
    });
  } catch (err) {
    if ((err as Error).message === STOCK_DEPLETED_AT_CREATION) {
      // Stock was depleted between our pre-check and the reservation attempt.
      await sendMessage(chatId, `❌ <b>${product.name}</b> đã hết hàng vào lúc xác nhận đơn. Vui lòng thử lại.`, {
        reply_markup: {
          inline_keyboard: [
            [{ text: "🔔 Yêu cầu hàng mới", callback_data: `stock_request_${productId}` }],
            [{ text: "🏠 Trang chủ", callback_data: "main_menu" }],
          ],
        },
      });
      return;
    }
    throw err;
  }

  // Transaction committed — do non-critical best-effort updates outside the transaction
  if (promotion) {
    await db.update(promotionsTable)
      .set({ useCount: sqlOp`use_count + 1` })
      .where(eq(promotionsTable.id, promotion.id));
  }
  await db.update(customersTable)
    .set({ totalOrders: sqlOp`total_orders + 1` })
    .where(eq(customersTable.id, customerId));

  await logBotAction("create_order", String(chatId), customerId, `Order ${orderCode} created (stock reserved)`, { orderId: order.id, productId, quantity, promotionId: promotion?.id, discountAmount });

  const amountFormatted = parseFloat(totalAmount).toLocaleString("vi-VN");
  const subtotalFormatted = subtotal.toLocaleString("vi-VN");
  const discountFormatted = discount.toLocaleString("vi-VN");
  const promoLine = promotion
    ? `🎟️ Mã giảm giá: <code>${promotion.code}</code> (−${discountFormatted}đ)\n`
    : "";
  const subtotalLine = promotion
    ? `🧾 Tạm tính: <s>${subtotalFormatted}đ</s>\n${promoLine}`
    : "";

  // Check customer's wallet balance
  const [customer] = await db.select({ balance: customersTable.balance }).from(customersTable).where(eq(customersTable.id, customerId));
  const customerBalance = customer ? parseFloat(customer.balance) : 0;
  const orderTotal = parseFloat(totalAmount);

  if (customerBalance >= orderTotal) {
    // Offer both payment methods
    const balanceFormatted = customerBalance.toLocaleString("vi-VN");
    let msg = `✅ <b>Đơn hàng #${orderCode} đã tạo!</b>\n\n`;
    msg += `📦 Sản phẩm: ${product.name} x${quantity}\n`;
    msg += subtotalLine;
    msg += `💰 Tổng tiền: <b>${amountFormatted}đ</b>\n`;
    msg += `👛 Số dư ví: <b>${balanceFormatted}đ</b>\n\n`;
    msg += `Bạn muốn thanh toán bằng cách nào?`;

    await sendMessage(chatId, msg, {
      reply_markup: {
        inline_keyboard: [
          [{ text: `💰 Trả bằng số dư (${balanceFormatted}đ)`, callback_data: `pay_with_balance_${order.id}` }],
          [{ text: "🏦 Chuyển khoản ngân hàng", callback_data: `show_bank_transfer_${order.id}` }],
          [{ text: "❌ Hủy đơn hàng", callback_data: `cancel_order_${order.id}` }],
        ],
      },
    });
    await logBotAction("payment_choice_offered", String(chatId), customerId, `Wallet vs bank for order ${orderCode}`, { orderId: order.id });
    return;
  }

  // Balance insufficient — show bank transfer details directly
  const { createPaymentRequest } = await import("./payments");
  const paymentInfo = await createPaymentRequest(order.id);

  if (paymentInfo) {
    let msg = `✅ <b>Đơn hàng #${orderCode} đã tạo!</b>\n\n`;
    msg += `📦 Sản phẩm: ${product.name} x${quantity}\n`;
    msg += subtotalLine;
    msg += `💰 Tổng tiền: <b>${amountFormatted}đ</b>\n\n`;
    msg += `🏦 <b>Thông tin thanh toán:</b>\n`;
    msg += `Ngân hàng: <b>${paymentInfo.bankName}</b>\n`;
    msg += `Số tài khoản: <code>${paymentInfo.accountNumber}</code>\n`;
    msg += `Chủ TK: <b>${paymentInfo.accountHolder}</b>\n`;
    msg += `Số tiền: <b>${amountFormatted}đ</b>\n`;
    msg += `Nội dung CK: <code>${paymentInfo.reference}</code>\n\n`;
    msg += `⚠️ <i>Vui lòng chuyển khoản đúng nội dung để đơn hàng được xử lý tự động.</i>`;

    if (customerBalance > 0) {
      msg += `\n\n💡 <i>Số dư ví ${customerBalance.toLocaleString("vi-VN")}đ chưa đủ để thanh toán. Nạp thêm bằng /naptien để thanh toán nhanh hơn.</i>`;
    }

    const cancelKeyboard = { inline_keyboard: [[{ text: "❌ Hủy đơn hàng", callback_data: `cancel_order_${order.id}` }]] };
    if (paymentInfo.qrUrl) {
      const sent = await sendPhoto(chatId, paymentInfo.qrUrl, msg, cancelKeyboard);
      if (!sent) await sendMessage(chatId, msg, { reply_markup: cancelKeyboard });
    } else {
      await sendMessage(chatId, msg, { reply_markup: cancelKeyboard });
    }
    await logBotAction("payment_initiated", String(chatId), customerId, `Payment for order ${orderCode}`, { orderId: order.id, reference: paymentInfo.reference });
  } else {
    await sendMessage(chatId, `✅ Đơn hàng <b>${orderCode}</b> đã tạo! Vui lòng liên hệ admin để thanh toán.`, {
      reply_markup: { inline_keyboard: [[{ text: "❌ Hủy đơn hàng", callback_data: `cancel_order_${order.id}` }]] },
    });
  }
}

async function cancelOrderByCustomer(chatId: number | string, orderId: number, customerId: number, messageId?: number): Promise<void> {
  const [order] = await db.select().from(ordersTable).where(
    and(eq(ordersTable.id, orderId), eq(ordersTable.customerId, customerId))
  );

  if (!order) {
    await sendMessage(chatId, "❌ Không tìm thấy đơn hàng.");
    return;
  }
  if (order.status !== "pending") {
    const statusLabels: Record<string, string> = {
      paid: "đã thanh toán",
      delivered: "đã giao",
      cancelled: "đã bị hủy trước đó",
      failed: "đã thất bại",
    };
    const label = statusLabels[order.status] ?? order.status;
    const msg = `❌ Đơn hàng <b>#${order.orderCode}</b> không thể hủy vì ${label}.`;
    if (messageId) {
      await renderView(chatId, messageId, msg, { reply_markup: { inline_keyboard: [[{ text: "🏠 Trang chủ", callback_data: "main_menu" }]] } });
    } else {
      await sendMessage(chatId, msg, { reply_markup: { inline_keyboard: [[{ text: "🏠 Trang chủ", callback_data: "main_menu" }]] } });
    }
    return;
  }

  // Release reserved stock back to available
  await db.execute(
    sqlOp`UPDATE product_stocks SET status = 'available', order_id = NULL WHERE order_id = ${orderId} AND status = 'reserved'`
  );

  // Mark order cancelled
  await db.update(ordersTable).set({ status: "cancelled" }).where(eq(ordersTable.id, orderId));

  // Cancel any pending payment transactions for this order
  await db.update(transactionsTable)
    .set({ status: "cancelled" })
    .where(and(eq(transactionsTable.orderId, orderId), eq(transactionsTable.status, "pending")));

  await logBotAction("cancel_order", String(chatId), customerId, `Customer cancelled order ${order.orderCode}`, { orderId });

  const msg = `✅ Đơn hàng <b>#${order.orderCode}</b> đã được hủy thành công.\n\nTồn kho đã được hoàn trả. Bạn có thể đặt hàng lại bất cứ lúc nào.`;
  if (messageId) {
    await renderView(chatId, messageId, msg, {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🛍️ Tiếp tục mua hàng", callback_data: "main_menu" }],
        ],
      },
    });
  } else {
    await sendMessage(chatId, msg, {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🛍️ Tiếp tục mua hàng", callback_data: "main_menu" }],
        ],
      },
    });
  }
}

async function sendBankTransferForOrder(chatId: number | string, orderId: number, customerId: number): Promise<void> {
  const [order] = await db.select().from(ordersTable).where(
    and(eq(ordersTable.id, orderId), eq(ordersTable.customerId, customerId))
  );
  if (!order || order.status !== "pending") {
    await sendMessage(chatId, "❌ Đơn hàng không còn hợp lệ để thanh toán.");
    return;
  }

  const { createPaymentRequest, getPaymentConfig, buildSepayQrUrl } = await import("./payments");

  // Reuse an existing pending bank-payment transaction to avoid creating duplicate references
  const [existingTxn] = await db.select()
    .from(transactionsTable)
    .where(and(
      eq(transactionsTable.orderId, orderId),
      eq(transactionsTable.type, "payment"),
      eq(transactionsTable.status, "pending"),
    ))
    .limit(1);

  let paymentInfo: { bankName: string; accountNumber: string; accountHolder: string; reference: string; qrUrl: string | null } | null = null;

  if (existingTxn?.paymentReference) {
    const config = await getPaymentConfig();
    if (config?.accountNumber && (config.bankCode || config.bankName)) {
      const bankCode = config.bankCode ?? config.bankName ?? "VCB";
      const accountHolder = config.accountHolder ?? "SHOP OWNER";
      const amount = parseFloat(order.totalAmount);
      paymentInfo = {
        bankName: config.bankName ?? bankCode,
        accountNumber: config.accountNumber,
        accountHolder,
        reference: existingTxn.paymentReference,
        qrUrl: buildSepayQrUrl({ bankCode, accountNumber: config.accountNumber, amount, description: existingTxn.paymentReference, accountHolder }),
      };
    }
  }

  if (!paymentInfo) {
    paymentInfo = await createPaymentRequest(orderId);
  }

  if (!paymentInfo) {
    await sendMessage(chatId, "❌ Không thể tạo thông tin thanh toán. Vui lòng liên hệ admin.");
    return;
  }

  const amountFormatted = parseFloat(order.totalAmount).toLocaleString("vi-VN");
  let msg = `🏦 <b>Thanh toán chuyển khoản cho đơn ${order.orderCode}</b>\n\n`;
  msg += `Ngân hàng: <b>${paymentInfo.bankName}</b>\n`;
  msg += `Số tài khoản: <code>${paymentInfo.accountNumber}</code>\n`;
  msg += `Chủ TK: <b>${paymentInfo.accountHolder}</b>\n`;
  msg += `Số tiền: <b>${amountFormatted}đ</b>\n`;
  msg += `Nội dung CK: <code>${paymentInfo.reference}</code>\n\n`;
  msg += `📱 <i>Quét mã QR bên trên hoặc chuyển khoản theo thông tin trên.</i>\n`;
  msg += `⚠️ <i>Vui lòng chuyển khoản đúng nội dung để đơn hàng được xử lý tự động.</i>`;

  // If we have a SePay QR URL, send the QR image with the payment details as the
  // caption — this matches the topup flow and lets customers pay by scanning.
  // Fall back to a plain text message if QR generation failed for any reason.
  const cancelKeyboard = { inline_keyboard: [[{ text: "❌ Hủy đơn hàng", callback_data: `cancel_order_${orderId}` }]] };
  if (paymentInfo.qrUrl) {
    const sent = await sendPhoto(chatId, paymentInfo.qrUrl, msg, cancelKeyboard);
    if (!sent) {
      await sendMessage(chatId, msg, { reply_markup: cancelKeyboard });
    }
  } else {
    await sendMessage(chatId, msg, { reply_markup: cancelKeyboard });
  }
}

/**
 * Atomically pay with wallet balance AND claim + deliver stock in one DB transaction.
 * This prevents the "charged but no goods" scenario: if stock is unavailable, the
 * balance is never debited. Returns the claimed stock rows on success so the caller
 * can send the delivery message after the transaction commits.
 */
async function payWithBalanceAndDeliver(
  orderId: number,
  customerId: number,
): Promise<
  | { outcome: "success"; stocks: Array<{ id: number; content: string }>; order: typeof ordersTable.$inferSelect; item: typeof orderItemsTable.$inferSelect }
  | { outcome: "out_of_stock" | "insufficient_balance" | "error" }
> {
  const [order] = await db.select().from(ordersTable).where(
    and(eq(ordersTable.id, orderId), eq(ordersTable.customerId, customerId))
  );
  if (!order || order.status !== "pending") return { outcome: "error" };

  const [item] = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, orderId));
  if (!item) return { outcome: "error" };

  const totalAmount = parseFloat(order.totalAmount).toFixed(2);
  const OUT_OF_STOCK = "OUT_OF_STOCK_WALLET_SENTINEL";
  const INSUFFICIENT = "INSUFFICIENT_BALANCE_WALLET_SENTINEL";
  let claimedStocks: Array<{ id: number; content: string }> = [];

  try {
    await db.transaction(async (tx) => {
      // Step 1: Lock and claim stock rows atomically. Prefer rows already reserved
      // for this order at creation time; fall back to any available row (for legacy
      // orders that predate the reservation model). SKIP LOCKED ensures we never
      // double-claim a row held by a concurrent transaction.
      const result = await tx.execute(
        sqlOp`SELECT id, content FROM product_stocks
              WHERE product_id = ${item.productId}
                AND (status = 'available' OR (status = 'reserved' AND order_id = ${orderId}))
              ORDER BY (CASE WHEN status = 'reserved' AND order_id = ${orderId} THEN 0 ELSE 1 END), created_at
              LIMIT ${item.quantity}
              FOR UPDATE SKIP LOCKED`
      );
      const rows = result.rows as Array<{ id: number; content: string }>;
      if (rows.length < item.quantity) throw new Error(OUT_OF_STOCK);
      claimedStocks = rows;

      // Step 2: Claim the order slot (pending → paid), prevents double payment
      const claimed = await tx.update(ordersTable)
        .set({ status: "paid", paidAt: new Date() })
        .where(and(eq(ordersTable.id, orderId), eq(ordersTable.status, "pending")))
        .returning({ id: ordersTable.id });
      if (claimed.length === 0) throw new Error("ORDER_ALREADY_CLAIMED");

      // Step 3: Deduct wallet balance — rolls back everything if insufficient
      const deducted = await tx.update(customersTable)
        .set({ balance: sqlOp`balance - ${totalAmount}::numeric` })
        .where(and(
          eq(customersTable.id, customerId),
          sqlOp`balance >= ${totalAmount}::numeric`
        ))
        .returning({ id: customersTable.id });
      if (deducted.length === 0) throw new Error(INSUFFICIENT);

      // Step 4: Mark the claimed stock rows as delivered (still in the same transaction).
      // Rows may be 'reserved' (for this order) or 'available' (legacy); update unconditionally
      // since we hold row-level locks from Step 1.
      await tx.update(productStocksTable)
        .set({ status: "delivered", orderId })
        .where(inArray(productStocksTable.id, rows.map(r => r.id)));

      // Step 5: Record the wallet transaction
      await tx.insert(transactionsTable).values({
        transactionCode: `TXN-WALLET-${Date.now()}-${orderId}`,
        type: "balance_payment",
        orderId,
        customerId,
        amount: order.totalAmount,
        status: "confirmed",
        provider: "wallet",
        confirmedAt: new Date(),
      });

      // Step 6: Mark order as delivered
      await tx.update(ordersTable)
        .set({ status: "delivered", deliveredAt: new Date() })
        .where(eq(ordersTable.id, orderId));
    });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === OUT_OF_STOCK) return { outcome: "out_of_stock" };
    if (msg === INSUFFICIENT) return { outcome: "insufficient_balance" };
    if (msg === "ORDER_ALREADY_CLAIMED") return { outcome: "error" };
    throw err;
  }

  // Update customer spend stats outside the transaction (non-critical, best-effort)
  await db.update(customersTable)
    .set({ totalSpent: sqlOp`total_spent + ${parseFloat(order.totalAmount)}` })
    .where(eq(customersTable.id, customerId))
    .catch(err => logger.warn({ err, orderId }, "Failed to update totalSpent after wallet delivery"));

  return { outcome: "success", stocks: claimedStocks, order, item };
}

export async function deliverOrder(orderId: number, opts: { isRetry?: boolean } = {}): Promise<boolean> {
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId));
  if (!order || (order.status !== "paid" && order.status !== "needs_manual_action")) return false;

  const isRetry = opts.isRetry === true || order.status === "needs_manual_action";

  // Persist retry attempt count on the order itself so /orders/:id and admin lists
  // can show it without scanning bot_logs on every request.
  if (isRetry) {
    await db.update(ordersTable)
      .set({ retryCount: sqlOp`${ordersTable.retryCount} + 1` })
      .where(eq(ordersTable.id, orderId));
  }

  const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, order.customerId));
  if (!customer) return false;

  const [item] = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, orderId));
  if (!item) return false;

  // Atomically claim exactly the required stock rows inside a transaction.
  // FOR UPDATE SKIP LOCKED ensures two concurrent deliveries for the same product
  // never claim the same row — if another transaction already holds a lock on a
  // row, we skip it rather than block. If we cannot lock enough unlocked rows
  // (genuinely out of stock, or all remaining rows are mid-delivery), we throw a
  // sentinel and handle the insufficiency outside the transaction, leaving the DB
  // in a clean state and preventing any double-delivery of the same content.
  const INSUFFICIENT_STOCK_SENTINEL = "INSUFFICIENT_STOCK_AT_DELIVERY";
  let deliveryStocks: Array<{ id: number; content: string }> = [];
  let stockAvailableAtFailure = 0;

  try {
    await db.transaction(async (tx) => {
      // Prefer reserved rows already allocated to this order at creation time;
      // fall back to any available row for retries / legacy orders without reservation.
      const result = await tx.execute(
        sqlOp`SELECT id, content FROM product_stocks
              WHERE product_id = ${item.productId}
                AND (status = 'available' OR (status = 'reserved' AND order_id = ${orderId}))
              ORDER BY (CASE WHEN status = 'reserved' AND order_id = ${orderId} THEN 0 ELSE 1 END), created_at
              LIMIT ${item.quantity}
              FOR UPDATE SKIP LOCKED`
      );
      const rows = result.rows as Array<{ id: number; content: string }>;

      if (rows.length < item.quantity) {
        stockAvailableAtFailure = rows.length;
        throw new Error(INSUFFICIENT_STOCK_SENTINEL);
      }

      deliveryStocks = rows;

      // Update within the same transaction while the locks are held.
      // The rows may be 'reserved' (for this order) or 'available' (legacy / retries).
      await tx.update(productStocksTable)
        .set({ status: "delivered", orderId })
        .where(inArray(productStocksTable.id, rows.map(r => r.id)));
    });
  } catch (err) {
    if ((err as Error).message !== INSUFFICIENT_STOCK_SENTINEL) throw err;

    await logBotAction("delivery_failed", customer.chatId, customer.id,
      `Insufficient stock for order ${order.orderCode}`,
      { orderId, available: stockAvailableAtFailure, required: item.quantity },
      "error"
    );
    await db.update(ordersTable).set({ status: "needs_manual_action" }).where(eq(ordersTable.id, orderId));
    await sendMessage(parseInt(customer.chatId), `⚠️ Đơn hàng <b>${order.orderCode}</b> cần xử lý thủ công. Admin sẽ liên hệ bạn sớm.`);

    const customerName = [customer.firstName, customer.lastName].filter(Boolean).join(" ") || customer.username || `ID:${customer.id}`;
    const adminBaseUrl = process.env.ADMIN_BASE_URL
      || (process.env.REPLIT_DOMAINS ? `https://${process.env.REPLIT_DOMAINS.split(",")[0].trim()}` : "")
      || (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "");
    const orderLink = adminBaseUrl ? `\n🔗 <a href="${adminBaseUrl}/orders/${orderId}">Xem đơn hàng trong Admin Panel</a>` : "";
    const adminMsg =
      `❌ <b>Giao hàng thất bại — hết hàng</b>\n\n` +
      `📦 Đơn hàng: <code>${order.orderCode}</code>\n` +
      `👤 Khách hàng: ${customerName}${customer.username ? ` (@${customer.username})` : ""}\n` +
      `🛍️ Sản phẩm: ${item.productName} x${item.quantity}\n` +
      `💰 Số tiền: ${parseFloat(order.totalAmount).toLocaleString("vi-VN")}đ\n` +
      `📊 Tồn kho còn: ${stockAvailableAtFailure} / cần ${item.quantity}\n\n` +
      `Cần nhập thêm hàng và xử lý thủ công đơn này.` +
      orderLink;
    await sendAdminAlert(adminMsg, { orderId, productId: item.productId, productName: item.productName, available: stockAvailableAtFailure, required: item.quantity });

    return false;
  }

  // Send stock content to customer
  let deliveryMsg = `🎉 <b>Đơn hàng ${order.orderCode} đã giao thành công!</b>\n\n`;
  deliveryMsg += `📦 ${item.productName} x${item.quantity}\n`;

  // Show discount details on the receipt if a promo code was applied
  const orderDiscount = parseFloat(order.discountAmount ?? "0");
  if (orderDiscount > 0) {
    let promoCode: string | null = null;
    if (order.promotionId) {
      const [promo] = await db
        .select({ code: promotionsTable.code })
        .from(promotionsTable)
        .where(eq(promotionsTable.id, order.promotionId));
      promoCode = promo?.code ?? null;
    }
    const subtotal = parseFloat(order.totalAmount) + orderDiscount;
    deliveryMsg += `🧾 Tạm tính: <s>${subtotal.toLocaleString("vi-VN")}đ</s>\n`;
    deliveryMsg += promoCode
      ? `🎟️ Mã giảm giá: <code>${promoCode}</code> (−${orderDiscount.toLocaleString("vi-VN")}đ)\n`
      : `🎟️ Giảm giá: −${orderDiscount.toLocaleString("vi-VN")}đ\n`;
    deliveryMsg += `💰 Đã thanh toán: <b>${parseFloat(order.totalAmount).toLocaleString("vi-VN")}đ</b>\n`;
  }

  deliveryMsg += `\n<b>Thông tin sản phẩm:</b>\n`;
  deliveryStocks.forEach((s, i) => {
    deliveryMsg += `${i + 1}. <code>${s.content}</code>\n`;
  });
  if (isRetry) {
    deliveryMsg += `\n✅ Cảm ơn bạn đã kiên nhẫn chờ đợi! Xin lỗi vì sự chậm trễ.`;
  } else {
    deliveryMsg += `\n✅ Cảm ơn bạn đã mua hàng!`;
  }

  await sendMessage(parseInt(customer.chatId), deliveryMsg);

  // Update order status
  await db.update(ordersTable).set({ status: "delivered", deliveredAt: new Date() }).where(eq(ordersTable.id, orderId));

  // Update customer total spent
  const { sql } = await import("drizzle-orm");
  await db.update(customersTable).set({ totalSpent: sql`total_spent + ${parseFloat(order.totalAmount)}` }).where(eq(customersTable.id, customer.id));

  const deliveryAction = isRetry ? "retry_delivery_sent" : "delivery_sent";
  await logBotAction(deliveryAction, customer.chatId, customer.id, `Delivered order ${order.orderCode}`, { orderId, isRetry });

  // Notify admin when a previously stuck order was auto-delivered
  if (isRetry) {
    const customerName = [customer.firstName, customer.lastName].filter(Boolean).join(" ") || customer.username || `ID:${customer.id}`;
    const deliveredAt = new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
    const adminBaseUrl = process.env.ADMIN_BASE_URL
      || (process.env.REPLIT_DOMAINS ? `https://${process.env.REPLIT_DOMAINS.split(",")[0].trim()}` : "")
      || (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "");
    const orderLink = adminBaseUrl ? `\n🔗 <a href="${adminBaseUrl}/orders/${orderId}">Xem đơn hàng trong Admin Panel</a>` : "";
    await sendAdminNotification(
      `✅ <b>Đơn hàng bị kẹt đã được giao tự động</b>\n\n` +
      `📦 Đơn hàng: <code>${order.orderCode}</code>\n` +
      `👤 Khách hàng: ${customerName}${customer.username ? ` (@${customer.username})` : ""}\n` +
      `🛍️ Sản phẩm: ${item.productName} x${item.quantity}\n` +
      `🕐 Thời gian giao: ${deliveredAt}` +
      orderLink,
      { orderId, orderCode: order.orderCode, customerId: customer.id, productName: item.productName }
    );
  }

  return true;
}

async function showWalletHistory(chatId: number | string, customer: typeof customersTable.$inferSelect, editMessageId?: number): Promise<void> {
  const txns = await db.select()
    .from(transactionsTable)
    .where(and(
      eq(transactionsTable.customerId, customer.id),
      inArray(transactionsTable.type, ["topup", "balance_payment"]),
      eq(transactionsTable.status, "confirmed"),
    ))
    .orderBy(desc(transactionsTable.createdAt))
    .limit(10);

  const balanceFormatted = parseFloat(customer.balance).toLocaleString("vi-VN");
  let msg = `💳 <b>Lịch sử ví</b>\n\n`;
  msg += `👛 Số dư hiện tại: <b>${balanceFormatted}đ</b>\n\n`;

  if (txns.length === 0) {
    msg += `<i>Chưa có giao dịch ví nào.</i>\n\nDùng <code>/naptien [số tiền]</code> để nạp tiền vào ví.`;
  } else {
    msg += `<b>${txns.length} giao dịch gần nhất:</b>\n`;
    let runningBalance = parseFloat(customer.balance);
    for (const t of txns) {
      const amount = parseFloat(t.amount);
      const amountFormatted = amount.toLocaleString("vi-VN");
      const date = new Date(t.createdAt).toLocaleString("vi-VN", {
        timeZone: "Asia/Ho_Chi_Minh",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
      const isTopup = t.type === "topup";
      const label = isTopup ? "⬆️ Nạp tiền" : "⬇️ Thanh toán";
      const sign = isTopup ? "+" : "−";
      const balanceAfter = runningBalance;
      const balanceAfterFormatted = balanceAfter.toLocaleString("vi-VN");
      msg += `\n${label}\n   ${sign}${amountFormatted}đ • ${date}\n   👛 Số dư sau: <b>${balanceAfterFormatted}đ</b>\n`;
      runningBalance = isTopup ? runningBalance - amount : runningBalance + amount;
    }
  }

  await renderView(chatId, editMessageId, msg, {
    reply_markup: {
      inline_keyboard: [[{ text: "🏠 Trang chủ", callback_data: "main_menu" }]],
    },
  });
}

async function showMyOrders(chatId: number | string, customerId: number, editMessageId?: number): Promise<void> {
  const recentOrders = await db.select().from(ordersTable)
    .where(eq(ordersTable.customerId, customerId))
    .orderBy(desc(ordersTable.createdAt))
    .limit(5);
  if (recentOrders.length === 0) {
    await renderView(chatId, editMessageId, "📦 Bạn chưa có đơn hàng nào.", {
      reply_markup: { inline_keyboard: [[{ text: "🏠 Trang chủ", callback_data: "main_menu" }]] },
    });
    return;
  }
  let msg = "📦 <b>Đơn hàng gần đây:</b>\n\n";
  recentOrders.forEach(o => {
    const statusMap: Record<string, string> = { pending: "⏳ Chờ TT", paid: "✅ Đã TT", delivered: "📬 Đã giao", failed: "❌ Lỗi", cancelled: "🚫 Huỷ", needs_manual_action: "⚠️ Cần xử lý" };
    msg += `• <b>${o.orderCode}</b> - ${parseFloat(o.totalAmount).toLocaleString("vi-VN")}đ - ${statusMap[o.status] ?? o.status}\n`;
  });
  await renderView(chatId, editMessageId, msg, {
    reply_markup: { inline_keyboard: [[{ text: "🏠 Trang chủ", callback_data: "main_menu" }]] },
  });
}

// Preset amounts (in VND) shown as quick-pick buttons when the customer runs
// /naptien with no argument. Each button emits `topup_amount_<n>` where n is
// one of these values; the callback handler parses any positive integer, so
// adding/removing entries here is safe.
const TOPUP_PRESET_AMOUNTS = [50000, 100000, 200000, 500000, 1000000];

async function handleTopup(chatId: number | string, customer: typeof customersTable.$inferSelect, text: string): Promise<void> {
  const parts = text.trim().split(/\s+/);
  const rawAmount = parts[1];

  if (!rawAmount) {
    const keyboard = [
      TOPUP_PRESET_AMOUNTS.slice(0, 3).map(n => ({
        text: `${n.toLocaleString("vi-VN")}đ`,
        callback_data: `topup_amount_${n}`,
      })),
      TOPUP_PRESET_AMOUNTS.slice(3).map(n => ({
        text: `${n.toLocaleString("vi-VN")}đ`,
        callback_data: `topup_amount_${n}`,
      })),
    ];
    await sendMessage(chatId,
      `💳 <b>Nạp tiền vào tài khoản</b>\n\n` +
      `👛 Số dư hiện tại: <b>${parseFloat(customer.balance).toLocaleString("vi-VN")}đ</b>\n\n` +
      `Chọn số tiền muốn nạp bên dưới hoặc gõ <code>/naptien [số tiền]</code> để nhập số tiền tuỳ chọn.\n` +
      `Ví dụ: <code>/naptien 100000</code>`,
      { reply_markup: { inline_keyboard: keyboard } }
    );
    return;
  }

  const amount = parseInt(rawAmount.replace(/[.,]/g, ""), 10);
  if (isNaN(amount) || amount <= 0) {
    await sendMessage(chatId, "❌ Số tiền không hợp lệ. Vui lòng nhập số tiền dương.\nVí dụ: <code>/naptien 100000</code>");
    return;
  }

  await executeTopup(chatId, customer, amount);
}

async function executeTopup(chatId: number | string, customer: typeof customersTable.$inferSelect, amount: number): Promise<void> {
  if (amount < 10000) {
    await sendMessage(chatId, "❌ Số tiền nạp tối thiểu là <b>10.000đ</b>.");
    return;
  }

  const { createTopupRequest } = await import("./payments");
  const topupInfo = await createTopupRequest(customer.id, amount);

  if (!topupInfo) {
    await sendMessage(chatId, "❌ Không thể tạo yêu cầu nạp tiền. Vui lòng liên hệ admin.");
    return;
  }

  const amountFormatted = amount.toLocaleString("vi-VN");
  const caption =
    `💳 <b>Nạp tiền ${amountFormatted}đ</b>\n\n` +
    `🏦 Ngân hàng: <b>${topupInfo.bankName}</b>\n` +
    `💳 Số tài khoản: <code>${topupInfo.accountNumber}</code>\n` +
    `👤 Chủ tài khoản: <b>${topupInfo.accountHolder}</b>\n` +
    `💰 Số tiền: <b>${amountFormatted}đ</b>\n` +
    `📝 Nội dung CK: <code>${topupInfo.reference}</code>\n\n` +
    `⚠️ <i>Vui lòng chuyển khoản đúng nội dung để hệ thống tự động cộng tiền vào tài khoản.</i>`;

  let sent = false;
  if (topupInfo.qrUrl) {
    sent = await sendPhoto(chatId, topupInfo.qrUrl, caption);
  }

  if (!sent) {
    await sendMessage(chatId, caption);
  }

  await logBotAction("topup_requested", String(chatId), customer.id, `Topup ${amountFormatted}đ`, { amount, reference: topupInfo.reference });
}

export async function handleTelegramUpdate(update: TelegramUpdate): Promise<void> {
  try {
    if (update.message) {
      const msg = update.message;
      const from = msg.from;
      if (!from) return;
      const chatId = msg.chat.id;
      const text = msg.text ?? "";

      const { customer, isNew } = await upsertCustomer(from);
      if (!customer.isActive) return;
      const lang = (customer.language ?? "vi") as Lang;

      await logBotAction("message", String(chatId), customer.id, text);

      if (text === "/start" || text.startsWith("/start ")) {
        await clearAwaitingPromo(chatId);
        clearAwaitingQuantity(chatId);
        await logBotAction("start", String(chatId), customer.id, text);

        if (isNew) {
          // New user: show language selection before anything else
          await showLanguageSelection(chatId);
        } else {
          // Returning user: install keyboard in their language and show main menu
          await showReplyKeyboard(chatId, lang);
          // Handle deep-link parameter: /start prod_<id>
          const startParam = text.startsWith("/start ") ? text.slice(7).trim() : "";
          if (startParam.startsWith("prod_")) {
            const deepProductId = parseInt(startParam.replace("prod_", ""), 10);
            if (!isNaN(deepProductId)) {
              await showProductDetail(chatId, deepProductId, undefined, lang);
            } else {
              await showMainMenu(chatId, from.first_name, undefined, lang);
            }
          } else {
            await showMainMenu(chatId, from.first_name, undefined, lang);
          }
        }
      } else if (VI_REPLY_KEYBOARD_BUTTONS.has(text.trim()) || EN_REPLY_KEYBOARD_BUTTONS.has(text.trim())) {
        // A tap on the persistent reply keyboard. Always cancel any pending
        // quantity / promo prompt — the user is starting a new flow.
        await clearAwaitingPromo(chatId);
        clearAwaitingQuantity(chatId);
        const btn = text.trim();
        const action = BUTTON_ACTION[btn] ?? btn;
        await logBotAction("reply_keyboard", String(chatId), customer.id, btn);
        const cfg = await getBotConfig();
        if (action === "shop") {
          await showCategories(chatId, undefined, lang);
        } else if (action === "account") {
          await showAccountInfo(chatId, customer, lang);
        } else if (action === "topup") {
          await showTopupInstructions(chatId, lang);
        } else if (action === "voucher") {
          await showActivePromotions(chatId, lang);
        } else if (action === "warranty") {
          const warrantyDefault = await t("warranty.default", lang);
          const warrantyTitle = await t("warranty.title", lang);
          const warrantyContent = cfg.warrantyText && cfg.warrantyText.trim().length > 0
            ? cfg.warrantyText
            : `${warrantyTitle}\n\n${warrantyDefault}`;
          await sendMessage(chatId, warrantyContent);
        } else if (action === "support") {
          const supportDefault = await t("support.default", lang);
          const supportTitle = await t("support.title", lang);
          const supportContent = cfg.supportText && cfg.supportText.trim().length > 0
            ? cfg.supportText
            : `${supportTitle}\n\n${supportDefault}`;
          await sendMessage(chatId, supportContent);
        } else if (action === "info") {
          const infoDefault = await t("info.default", lang);
          const infoTitle = await t("info.title", lang);
          const infoContent = cfg.infoText && cfg.infoText.trim().length > 0
            ? cfg.infoText
            : `${infoTitle}\n\n${infoDefault}`;
          await sendMessage(chatId, infoContent);
        } else if (action === "settings") {
          await showSettingsMenu(chatId, undefined, lang);
        }
      } else if (text.startsWith("/naptien")) {
        await clearAwaitingPromo(chatId);
        clearAwaitingQuantity(chatId);
        await handleTopup(chatId, customer, text);
      } else if (text === "/lichsu") {
        await clearAwaitingPromo(chatId);
        clearAwaitingQuantity(chatId);
        await showWalletHistory(chatId, customer);
      } else if (text === "/cancel" || text.startsWith("/cancel ")) {
        await clearAwaitingPromo(chatId);
        clearAwaitingQuantity(chatId);
        // Find the most recent pending order for this customer
        const [latestOrder] = await db
          .select({ id: ordersTable.id, orderCode: ordersTable.orderCode })
          .from(ordersTable)
          .where(and(eq(ordersTable.customerId, customer.id), eq(ordersTable.status, "pending")))
          .orderBy(desc(ordersTable.createdAt))
          .limit(1);
        if (!latestOrder) {
          await sendMessage(chatId, "ℹ️ Bạn không có đơn hàng nào đang chờ thanh toán để hủy.");
        } else {
          await cancelOrderByCustomer(chatId, latestOrder.id, customer.id);
        }
      } else if (awaitingQuantity.has(String(chatId)) && text.trim().length > 0) {
        const entry = peekAwaitingQuantity(chatId);
        if (!entry) {
          clearAwaitingQuantity(chatId);
          await sendMessage(chatId, "⏰ Phiên đã hết hạn. Vui lòng chọn lại sản phẩm.");
        } else if (entry.awaitingPromoEntry) {
          // Customer typed a promo code while on the confirm screen
          updateAwaitingQuantity(chatId, { awaitingPromoEntry: false });
          const qty = entry.quantity!;
          const { sql, count } = await import("drizzle-orm");
          const [product] = await db.select({ price: productsTable.price }).from(productsTable).where(eq(productsTable.id, entry.productId));
          const [stockRow] = await db.select({ c: count() }).from(productStocksTable).where(sql`${productStocksTable.productId} = ${entry.productId} AND ${productStocksTable.status} = 'available'`);
          const stockCount = Number(stockRow?.c ?? 0);
          if (!product) {
            clearAwaitingQuantity(chatId);
            await sendMessage(chatId, "❌ Sản phẩm không còn tồn tại.");
          } else if (stockCount < qty) {
            clearAwaitingQuantity(chatId);
            await showProductDetail(chatId, entry.productId);
          } else {
            const subtotal = parseFloat(product.price) * qty;
            const result = await validatePromoCode(text.trim(), subtotal);
            if ("error" in result) {
              await logBotAction("promo_invalid", String(chatId), customer.id, `Invalid promo "${text.trim()}": ${result.error}`, { code: text.trim(), productId: entry.productId, quantity: qty }, "warn");
              // Re-arm promo entry so the customer can try another code
              updateAwaitingQuantity(chatId, { awaitingPromoEntry: true });
              await sendMessage(chatId, `❌ ${result.error}\n\n<i>Hãy thử mã khác hoặc bấm "Bỏ qua" bên dưới.</i>`, {
                reply_markup: {
                  inline_keyboard: [[{ text: "⏭️ Bỏ qua", callback_data: `clear_promo_${entry.productId}_${qty}` }]],
                },
              });
            } else {
              await logBotAction("promo_applied", String(chatId), customer.id, `Applied promo ${result.code} (-${result.discountAmount})`, { code: result.code, promotionId: result.id, discountAmount: result.discountAmount, productId: entry.productId, quantity: qty });
              await showOrderConfirmScreen(chatId, customer.id, entry.productId, qty, result);
            }
          }
        } else {
          // Customer typed a custom quantity
          const pending = takeAwaitingQuantity(chatId);
          if (!pending) {
            await sendMessage(chatId, "⏰ Phiên nhập số lượng đã hết hạn. Vui lòng chọn lại sản phẩm.");
          } else {
            const { sql, count } = await import("drizzle-orm");
            const [product] = await db.select({
              name: productsTable.name,
              minQuantity: productsTable.minQuantity,
              maxQuantity: productsTable.maxQuantity,
            }).from(productsTable).where(eq(productsTable.id, pending.productId));
            if (!product) {
              await sendMessage(chatId, "❌ Sản phẩm không còn tồn tại.");
            } else {
              const trimmed = text.trim();
              const qty = /^\d+$/.test(trimmed) ? parseInt(trimmed, 10) : NaN;
              if (!Number.isFinite(qty) || qty < product.minQuantity || qty > product.maxQuantity) {
                setAwaitingQuantity(chatId, pending.productId);
                await sendMessage(
                  chatId,
                  `❌ Số lượng không hợp lệ. Vui lòng nhập một số từ <b>${product.minQuantity}</b> đến <b>${product.maxQuantity}</b>.`,
                  { reply_markup: { inline_keyboard: [[{ text: "⬅️ Quay lại", callback_data: `prod_${pending.productId}` }]] } }
                );
              } else {
                await logBotAction("quantity_input", String(chatId), customer.id, `Custom quantity ${qty} for product ${pending.productId}`, { productId: pending.productId, quantity: qty });
                await showOrderConfirmScreen(chatId, customer.id, pending.productId, qty, null);
              }
            }
          }
        }
      }
    } else if (update.callback_query) {
      const cq = update.callback_query;
      const from = cq.from;
      const chatId = cq.message?.chat.id;
      if (!chatId) return;
      // The id of the original menu message — we reuse this slot to render every
      // navigation step, so the customer always sees a single up-to-date menu
      // instead of a long chain of throwaway messages.
      const messageId = cq.message?.message_id;

      await answerCallbackQuery(cq.id);
      const { customer } = await upsertCustomer(from);
      if (!customer.isActive) return;
      const lang = (customer.language ?? "vi") as Lang;

      const data = cq.data ?? "";
      await logBotAction("callback", String(chatId), customer.id, data);

      // Language selection callbacks (happen before any other nav)
      if (data === "set_lang_vi" || data === "set_lang_en") {
        const selectedLang: Lang = data === "set_lang_vi" ? "vi" : "en";
        await saveCustomerLanguage(customer.id, selectedLang);
        const confirmKey = selectedLang === "vi" ? "lang.selected_vi" : "lang.selected_en";
        const confirmMsg = await t(confirmKey, selectedLang);
        await sendMessage(chatId, confirmMsg);
        await showReplyKeyboard(chatId, selectedLang);
        await showMainMenu(chatId, from.first_name, undefined, selectedLang);
        return;
      }

      if (data === "change_lang") {
        await showLanguageSelection(chatId);
        return;
      }

      if (data === "settings_menu") {
        await showSettingsMenu(chatId, messageId, lang);
        return;
      }

      // Any callback that isn't part of the quantity/confirm flow exits it cleanly.
      const KEEP_QTY_STATE_PREFIXES = ["qty_input_", "promo_enter_", "clear_promo_", "confirm_order_", "reuse_promo_"];
      if (!KEEP_QTY_STATE_PREFIXES.some(p => data.startsWith(p))) {
        clearAwaitingQuantity(chatId);
      }

      if (data === "main_menu") {
        await showMainMenu(chatId, from.first_name, messageId, lang);
      } else if (data === "browse_products") {
        await showCategories(chatId, messageId, lang);
      } else if (data.startsWith("cat_")) {
        const categoryId = parseInt(data.replace("cat_", ""), 10);
        await showProducts(chatId, categoryId, messageId, lang);
        await logBotAction("browse_category", String(chatId), customer.id, `Category ${categoryId}`);
      } else if (data.startsWith("back_to_cat_")) {
        // Legacy callback emitted by older inline keyboards still floating in chat history.
        // Look up the product's category and show that list.
        const productId = parseInt(data.replace("back_to_cat_", ""), 10);
        const [row] = await db.select({ categoryId: productsTable.categoryId })
          .from(productsTable).where(eq(productsTable.id, productId));
        if (row?.categoryId !== undefined && row?.categoryId !== null) {
          await showProducts(chatId, row.categoryId, messageId, lang);
        } else {
          await showCategories(chatId, messageId, lang);
        }
      } else if (data.startsWith("prod_")) {
        const productId = parseInt(data.replace("prod_", ""), 10);
        await showProductDetail(chatId, productId, messageId, lang);
        await logBotAction("view_product", String(chatId), customer.id, `Product ${productId}`);
      } else if (data.startsWith("stock_request_")) {
        const productId = parseInt(data.replace("stock_request_", ""), 10);
        const [product] = await db.select({
          id: productsTable.id,
          name: productsTable.name,
          productIcon: productsTable.productIcon,
        }).from(productsTable).where(eq(productsTable.id, productId));

        if (!product) {
          await renderView(chatId, messageId, "❌ Sản phẩm không còn tồn tại.", {
            reply_markup: { inline_keyboard: [[{ text: "🏠 Trang chủ", callback_data: "main_menu" }]] },
          });
        } else {
          // Deduplication: only allow one stock request per (customerId, productId)
          // within a 24-hour rolling window to prevent admin notification spam.
          const STOCK_REQUEST_WINDOW_MS = 24 * 60 * 60 * 1000;
          const since = new Date(Date.now() - STOCK_REQUEST_WINDOW_MS);
          const [dupRow] = await db
            .select({ c: count() })
            .from(botLogsTable)
            .where(and(
              eq(botLogsTable.action, "stock_request"),
              eq(botLogsTable.customerId, customer.id),
              gte(botLogsTable.createdAt, since),
              sqlOp`${botLogsTable.metadata}->>'productId' = ${String(productId)}`,
            ));
          const alreadyRequested = Number(dupRow?.c ?? 0) > 0;

          if (alreadyRequested) {
            // Customer already requested this product within the rate-limit window;
            // show a friendly reminder without sending another admin notification.
            await renderView(
              chatId,
              messageId,
              `🔔 <b>Yêu cầu đã được ghi nhận trước đó</b>\n\n` +
              `Bạn đã gửi yêu cầu cho sản phẩm ${product.productIcon ?? "📦"} <b>${product.name}</b> rồi.\n\n` +
              `Chúng tôi sẽ thông báo ngay khi có hàng. Hãy quay lại kiểm tra sau nhé! 🙏`,
              {
                reply_markup: {
                  inline_keyboard: [
                    [{ text: "🔄 Kiểm tra lại", callback_data: `prod_${productId}` }],
                    [{ text: "🛒 Xem sản phẩm khác", callback_data: "browse_products" }, { text: "🏠 Trang chủ", callback_data: "main_menu" }],
                  ],
                },
              }
            );
          } else {
            await logBotAction("stock_request", String(chatId), customer.id,
              `Stock request for product ${productId} (${product.name})`,
              { productId, productName: product.name, customerName: from.first_name, customerUsername: from.username }
            );

            const customerLabel = from.username
              ? `@${from.username} (${from.first_name})`
              : `${from.first_name} [chat ${chatId}]`;
            await sendAdminNotification(
              `🔔 <b>Yêu cầu hàng mới</b>\n\n` +
              `Khách hàng <b>${customerLabel}</b> muốn mua:\n` +
              `${product.productIcon ?? "📦"} <b>${product.name}</b>\n\n` +
              `Vui lòng nhập thêm hàng để đáp ứng nhu cầu.`,
              { productId, customerId: customer.id, chatId: String(chatId) }
            );

            await renderView(
              chatId,
              messageId,
              `✅ <b>Đã ghi nhận yêu cầu của bạn!</b>\n\n` +
              `${product.productIcon ?? "📦"} <b>${product.name}</b> hiện đang hết hàng.\n\n` +
              `Chúng tôi đã nhận được yêu cầu và sẽ bổ sung sớm nhất có thể. Hãy quay lại kiểm tra sau nhé! 🙏`,
              {
                reply_markup: {
                  inline_keyboard: [
                    [{ text: "🔄 Kiểm tra lại", callback_data: `prod_${productId}` }],
                    [{ text: "🛒 Xem sản phẩm khác", callback_data: "browse_products" }, { text: "🏠 Trang chủ", callback_data: "main_menu" }],
                  ],
                },
              }
            );
          }
        }
      } else if (data.startsWith("qty_input_")) {
        const productId = parseInt(data.replace("qty_input_", ""), 10);
        const { sql, count } = await import("drizzle-orm");
        const [product] = await db.select({
          name: productsTable.name,
          minQuantity: productsTable.minQuantity,
          maxQuantity: productsTable.maxQuantity,
        }).from(productsTable).where(eq(productsTable.id, productId));
        if (!product) {
          await renderView(chatId, messageId, "❌ Sản phẩm không còn tồn tại.", {
            reply_markup: { inline_keyboard: [[{ text: "🏠 Trang chủ", callback_data: "main_menu" }]] },
          });
        } else {
          // Gate only on having any stock at all — the user may type up to the
          // configured maxQuantity. Stock is re-validated when they confirm the
          // order, so an over-stock pick produces a clear error there.
          const [stockRow] = await db.select({ c: count() }).from(productStocksTable).where(sql`${productStocksTable.productId} = ${productId} AND ${productStocksTable.status} = 'available'`);
          const stockCount = Number(stockRow?.c ?? 0);
          if (stockCount < product.minQuantity) {
            await renderView(chatId, messageId, `❌ <b>${product.name}</b> hiện đã hết hàng.\n\nBạn có thể yêu cầu shop nhập thêm hàng.`, {
              reply_markup: {
                inline_keyboard: [
                  [{ text: "🔔 Yêu cầu hàng mới", callback_data: `stock_request_${productId}` }],
                  [{ text: "⬅️ Quay lại", callback_data: `prod_${productId}` }, { text: "🏠 Trang chủ", callback_data: "main_menu" }],
                ],
              },
            });
          } else {
            await clearAwaitingPromo(chatId);
            setAwaitingQuantity(chatId, productId);
            await logBotAction("quantity_prompt", String(chatId), customer.id, `Quantity prompt for product ${productId}`, { productId, minQuantity: product.minQuantity, maxQuantity: product.maxQuantity, stockCount });
            const stockHint = stockCount < product.maxQuantity ? `\n<i>Hiện còn ${stockCount} trong kho.</i>` : "";
            await renderView(
              chatId,
              messageId,
              `✏️ <b>Nhập số lượng muốn mua cho ${product.name}</b>\n` +
              `<i>Gõ một số từ ${product.minQuantity} đến ${product.maxQuantity} vào ô chat.</i>` +
              stockHint,
              { reply_markup: { inline_keyboard: [[{ text: "⬅️ Quay lại", callback_data: `prod_${productId}` }, { text: "🏠 Trang chủ", callback_data: "main_menu" }]] } }
            );
          }
        }
      } else if (data.startsWith("qty_")) {
        const parts = data.split("_");
        const productId = parseInt(parts[1], 10);
        const quantity = parseInt(parts[2], 10);
        await showOrderConfirmScreen(chatId, customer.id, productId, quantity, null, messageId);
      } else if (data.startsWith("skip_promo_")) {
        const parts = data.replace("skip_promo_", "").split("_");
        const productId = parseInt(parts[0], 10);
        const quantity = parseInt(parts[1], 10);
        await clearAwaitingPromo(chatId);
        await logBotAction("promo_skipped", String(chatId), customer.id, `Skipped promo for product ${productId} x${quantity}`, { productId, quantity });
        await createOrderFromBot(chatId, customer.id, productId, quantity, null);
      } else if (data.startsWith("reuse_promo_")) {
        // One-tap reuse of the customer's most recently applied promo code.
        // We re-validate against the current subtotal — the code may have
        // expired, been disabled, or hit its usage limit since last time.
        const parts = data.replace("reuse_promo_", "").split("_");
        const promotionId = parseInt(parts[0], 10);
        const productId = parseInt(parts[1], 10);
        const quantity = parseInt(parts[2], 10);
        await clearAwaitingPromo(chatId);

        const { sql, count } = await import("drizzle-orm");
        const [product] = await db.select({ price: productsTable.price }).from(productsTable).where(eq(productsTable.id, productId));
        const [stockRow] = await db.select({ c: count() }).from(productStocksTable).where(sql`${productStocksTable.productId} = ${productId} AND ${productStocksTable.status} = 'available'`);
        const stockCount = Number(stockRow?.c ?? 0);
        if (!product || stockCount < quantity) {
          await sendMessage(chatId, "❌ Sản phẩm không còn đủ hàng. Vui lòng chọn lại.");
        } else {
          const [promo] = await db.select({ code: promotionsTable.code }).from(promotionsTable).where(eq(promotionsTable.id, promotionId));
          const code = promo?.code ?? "";
          const subtotal = parseFloat(product.price) * quantity;
          const result = code ? await validatePromoCode(code, subtotal) : { error: "Mã giảm giá không tồn tại." };
          if ("error" in result) {
            await logBotAction("promo_reuse_invalid", String(chatId), customer.id, `Reuse failed for promo ${promotionId}: ${result.error}`, { promotionId, productId, quantity, error: result.error }, "warn");
            await sendMessage(chatId, `❌ Mã <code>${code || "?"}</code> không còn dùng được: ${result.error}`);
            await showOrderConfirmScreen(chatId, customer.id, productId, quantity, null, messageId);
          } else {
            await logBotAction("promo_reused", String(chatId), customer.id, `Reused promo ${result.code} (-${result.discountAmount})`, { code: result.code, promotionId: result.id, discountAmount: result.discountAmount, productId, quantity });
            await showOrderConfirmScreen(chatId, customer.id, productId, quantity, result, messageId);
          }
        }
      } else if (data.startsWith("promo_enter_")) {
        // Customer tapped "Nhập mã giảm giá" on the confirm screen
        const parts = data.replace("promo_enter_", "").split("_");
        const productId = parseInt(parts[0], 10);
        const quantity = parseInt(parts[1], 10);
        updateAwaitingQuantity(chatId, { awaitingPromoEntry: true });
        await sendMessage(chatId, `🎟️ <b>Nhập mã giảm giá của bạn</b>\n<i>Gõ mã vào ô chat bên dưới. Nhấn "Bỏ qua" nếu không có mã.</i>`, {
          reply_markup: { inline_keyboard: [[{ text: "⏭️ Bỏ qua", callback_data: `clear_promo_${productId}_${quantity}` }]] },
        });
      } else if (data.startsWith("clear_promo_")) {
        // Customer tapped "Bỏ mã" or "Bỏ qua" — show confirm screen without promo
        const parts = data.replace("clear_promo_", "").split("_");
        const productId = parseInt(parts[0], 10);
        const quantity = parseInt(parts[1], 10);
        await showOrderConfirmScreen(chatId, customer.id, productId, quantity, null, messageId);
      } else if (data.startsWith("confirm_order_")) {
        // Customer confirmed the order from the confirm screen
        // Format: confirm_order_{productId}_{quantity} or confirm_order_{productId}_{quantity}_{promotionId}
        const rest = data.replace("confirm_order_", "");
        const parts = rest.split("_");
        const productId = parseInt(parts[0], 10);
        const quantity = parseInt(parts[1], 10);
        const promotionId = parts[2] ? parseInt(parts[2], 10) : null;
        clearAwaitingQuantity(chatId);

        let promotion: ValidPromotion | null = null;
        if (promotionId) {
          const { sql, count } = await import("drizzle-orm");
          const [product] = await db.select({ price: productsTable.price }).from(productsTable).where(eq(productsTable.id, productId));
          const [promo] = await db.select({ code: promotionsTable.code }).from(promotionsTable).where(eq(promotionsTable.id, promotionId));
          if (product && promo?.code) {
            const subtotal = parseFloat(product.price) * quantity;
            const result = await validatePromoCode(promo.code, subtotal);
            if (!("error" in result)) {
              promotion = result;
            }
          }
        }
        await createOrderFromBot(chatId, customer.id, productId, quantity, promotion);
      } else if (data.startsWith("pay_with_balance_")) {
        const orderId = parseInt(data.replace("pay_with_balance_", ""), 10);
        // Use the combined atomic function: stock claim + balance debit + delivery
        // happen in one transaction so the customer is never charged for goods that
        // are no longer available (race-condition safe).
        const walletResult = await payWithBalanceAndDeliver(orderId, customer.id);

        if (walletResult.outcome === "success") {
          const { stocks, order, item } = walletResult;
          await logBotAction("wallet_payment_delivered", String(chatId), customer.id,
            `Wallet payment+delivery for order ${order.orderCode}`,
            { orderId, productId: item.productId, quantity: item.quantity }
          );

          // Build and send the delivery message
          const orderDiscount = parseFloat(order.discountAmount ?? "0");
          let deliveryMsg = `🎉 <b>Đơn hàng ${order.orderCode} đã giao thành công!</b>\n\n`;
          deliveryMsg += `📦 ${item.productName} x${item.quantity}\n`;

          if (orderDiscount > 0) {
            let promoCode: string | null = null;
            if (order.promotionId) {
              const [promo] = await db.select({ code: promotionsTable.code })
                .from(promotionsTable).where(eq(promotionsTable.id, order.promotionId));
              promoCode = promo?.code ?? null;
            }
            const subtotal = parseFloat(order.totalAmount) + orderDiscount;
            deliveryMsg += `🧾 Tạm tính: <s>${subtotal.toLocaleString("vi-VN")}đ</s>\n`;
            deliveryMsg += promoCode
              ? `🎟️ Mã giảm giá: <code>${promoCode}</code> (−${orderDiscount.toLocaleString("vi-VN")}đ)\n`
              : `🎟️ Giảm giá: −${orderDiscount.toLocaleString("vi-VN")}đ\n`;
            deliveryMsg += `💰 Đã thanh toán: <b>${parseFloat(order.totalAmount).toLocaleString("vi-VN")}đ</b> (ví)\n`;
          } else {
            deliveryMsg += `💰 Đã thanh toán: <b>${parseFloat(order.totalAmount).toLocaleString("vi-VN")}đ</b> (ví)\n`;
          }

          deliveryMsg += `\n<b>Thông tin sản phẩm:</b>\n`;
          stocks.forEach((s, i) => { deliveryMsg += `${i + 1}. <code>${s.content}</code>\n`; });
          deliveryMsg += `\n✅ Cảm ơn bạn đã mua hàng!`;

          await sendMessage(chatId, deliveryMsg);

          // Update customer stats (best-effort, already handled inside payWithBalanceAndDeliver)
          await logBotAction("delivery_sent", String(chatId), customer.id,
            `Delivered order ${order.orderCode} via wallet`, { orderId });

        } else if (walletResult.outcome === "out_of_stock") {
          // Cancel the order — no money was taken. Also release any reserved stock
          // (the transaction already aborted the status update, so rows are still
          // 'reserved'; we must reset them to 'available' for other buyers).
          await db.update(ordersTable)
            .set({ status: "cancelled" })
            .where(and(eq(ordersTable.id, orderId), eq(ordersTable.status, "pending")));
          await db.update(productStocksTable)
            .set({ status: "available", orderId: null })
            .where(and(eq(productStocksTable.orderId, orderId), eq(productStocksTable.status, "reserved")));
          await logBotAction("wallet_payment_cancelled_no_stock", String(chatId), customer.id,
            `Wallet payment cancelled — out of stock for order ${orderId}`, { orderId }, "warn");
          await sendMessage(chatId, "❌ Sản phẩm đã hết hàng. Đơn hàng đã bị hủy và bạn không bị tính phí.", {
            reply_markup: {
              inline_keyboard: [
                [{ text: "🏠 Trang chủ", callback_data: "main_menu" }, { text: "🛒 Xem sản phẩm khác", callback_data: "browse_products" }],
              ],
            },
          });
        } else if (walletResult.outcome === "insufficient_balance") {
          await sendMessage(chatId, "❌ Số dư ví không đủ. Vui lòng nạp thêm hoặc chuyển khoản ngân hàng.");
        } else {
          await sendMessage(chatId, "❌ Đơn hàng không còn hợp lệ để thanh toán bằng ví.");
        }
      } else if (data.startsWith("cancel_order_")) {
        const orderId = parseInt(data.replace("cancel_order_", ""), 10);
        if (!isNaN(orderId)) await cancelOrderByCustomer(chatId, orderId, customer.id, messageId);
      } else if (data.startsWith("show_bank_transfer_")) {
        const orderId = parseInt(data.replace("show_bank_transfer_", ""), 10);
        await sendBankTransferForOrder(chatId, orderId, customer.id);
      } else if (data.startsWith("topup_amount_")) {
        const amount = parseInt(data.replace("topup_amount_", ""), 10);
        if (isNaN(amount) || amount <= 0) {
          await sendMessage(chatId, "❌ Số tiền không hợp lệ.");
        } else {
          await executeTopup(chatId, customer, amount);
        }
      } else if (data === "wallet_history") {
        await showWalletHistory(chatId, customer, messageId);
      } else if (data === "my_orders") {
        await showMyOrders(chatId, customer.id, messageId);
      }
    }
  } catch (err) {
    logger.error({ err }, "Error handling Telegram update");
    await logBotAction("bot_error", undefined, undefined, String(err), { stack: (err as Error).stack }, "error");
  }
}
