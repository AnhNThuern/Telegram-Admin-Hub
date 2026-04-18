import { db, botLogsTable, customersTable, ordersTable, orderItemsTable, productStocksTable, transactionsTable, productsTable, promotionsTable } from "@workspace/db";
import { eq, and, desc, inArray, sql as sqlOp } from "drizzle-orm";
import { logger } from "./logger";

// In-memory conversation state for customers awaiting promo code entry.
// Keyed by chatId. Cleared on skip, valid code entry, or when /start is sent.
interface AwaitingPromo {
  productId: number;
  quantity: number;
  expiresAt: number;
}
const awaitingPromoCode = new Map<string, AwaitingPromo>();
const PROMO_PROMPT_TTL_MS = 10 * 60 * 1000;

function setAwaitingPromo(chatId: number | string, productId: number, quantity: number): void {
  awaitingPromoCode.set(String(chatId), { productId, quantity, expiresAt: Date.now() + PROMO_PROMPT_TTL_MS });
}
function takeAwaitingPromo(chatId: number | string): AwaitingPromo | null {
  const key = String(chatId);
  const entry = awaitingPromoCode.get(key);
  if (!entry) return null;
  awaitingPromoCode.delete(key);
  if (entry.expiresAt < Date.now()) return null;
  return entry;
}
function clearAwaitingPromo(chatId: number | string): void {
  awaitingPromoCode.delete(String(chatId));
}

// In-memory state for customers asked to type a custom quantity.
interface AwaitingQuantity {
  productId: number;
  expiresAt: number;
}
const awaitingQuantity = new Map<string, AwaitingQuantity>();
const QUANTITY_PROMPT_TTL_MS = 10 * 60 * 1000;

function setAwaitingQuantity(chatId: number | string, productId: number): void {
  awaitingQuantity.set(String(chatId), { productId, expiresAt: Date.now() + QUANTITY_PROMPT_TTL_MS });
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

async function getBotConfig(): Promise<{ botToken: string | null; adminChatId: string | null }> {
  const { botConfigsTable } = await import("@workspace/db");
  const { desc } = await import("drizzle-orm");
  const [config] = await db.select().from(botConfigsTable).orderBy(desc(botConfigsTable.id)).limit(1);
  return { botToken: config?.botToken ?? null, adminChatId: config?.adminChatId ?? null };
}

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

async function sendPhoto(chatId: number | string, photoUrl: string, caption?: string): Promise<boolean> {
  const token = await getBotToken();
  if (!token) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, photo: photoUrl, caption, parse_mode: "HTML" }),
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

async function upsertCustomer(from: { id: number; first_name?: string; last_name?: string; username?: string }): Promise<typeof customersTable.$inferSelect> {
  const chatId = String(from.id);
  const [existing] = await db.select().from(customersTable).where(eq(customersTable.chatId, chatId));
  if (existing) {
    const [updated] = await db.update(customersTable).set({
      firstName: from.first_name ?? existing.firstName,
      lastName: from.last_name ?? existing.lastName,
      username: from.username ?? existing.username,
      lastActiveAt: new Date(),
    }).where(eq(customersTable.id, existing.id)).returning();
    return updated;
  }
  const [customer] = await db.insert(customersTable).values({
    chatId,
    firstName: from.first_name,
    lastName: from.last_name,
    username: from.username,
    lastActiveAt: new Date(),
  }).returning();
  return customer;
}

async function showMainMenu(chatId: number | string, customerName?: string): Promise<void> {
  const name = customerName ?? "bạn";
  await sendMessage(chatId, `👋 Chào mừng <b>${name}</b> đến với cửa hàng!\n\nChọn tùy chọn bên dưới:`, {
    reply_markup: {
      inline_keyboard: [
        [{ text: "🛍️ Xem sản phẩm", callback_data: "browse_products" }],
        [{ text: "📦 Đơn hàng của tôi", callback_data: "my_orders" }],
        [{ text: "💳 Lịch sử ví", callback_data: "wallet_history" }],
      ],
    },
  });
}

async function showCategories(chatId: number | string): Promise<void> {
  const { categoriesTable } = await import("@workspace/db");
  const categories = await db.select().from(categoriesTable).where(eq(categoriesTable.isActive, true));
  if (categories.length === 0) {
    await sendMessage(chatId, "❌ Hiện chưa có danh mục nào. Vui lòng quay lại sau.");
    return;
  }
  const keyboard = categories.map(c => [{ text: `${c.icon ?? "📁"} ${c.name}`, callback_data: `cat_${c.id}` }]);
  keyboard.push([{ text: "⬅️ Quay lại", callback_data: "main_menu" }]);
  await sendMessage(chatId, "📂 <b>Danh mục sản phẩm:</b>", { reply_markup: { inline_keyboard: keyboard } });
}

async function showProducts(chatId: number | string, categoryId: number): Promise<void> {
  const { sql } = await import("drizzle-orm");
  const products = await db.select({
    id: productsTable.id,
    name: productsTable.name,
    price: productsTable.price,
    productIcon: productsTable.productIcon,
    stockCount: sql<number>`(SELECT COUNT(*) FROM product_stocks WHERE product_id = ${productsTable.id} AND status = 'available')::int`,
  }).from(productsTable).where(and(eq(productsTable.categoryId, categoryId), eq(productsTable.isActive, true)));

  if (products.length === 0) {
    await sendMessage(chatId, "❌ Danh mục này chưa có sản phẩm.", {
      reply_markup: { inline_keyboard: [[{ text: "⬅️ Quay lại", callback_data: "browse_products" }]] },
    });
    return;
  }
  const keyboard = products.map(p => [{
    text: `${p.productIcon ?? "📦"} ${p.name} - ${parseFloat(p.price).toLocaleString("vi-VN")}đ ${p.stockCount > 0 ? "✅" : "❌"}`,
    callback_data: `prod_${p.id}`,
  }]);
  keyboard.push([{ text: "⬅️ Quay lại", callback_data: "browse_products" }]);
  await sendMessage(chatId, "🛍️ <b>Danh sách sản phẩm:</b>", { reply_markup: { inline_keyboard: keyboard } });
}

async function showProductDetail(chatId: number | string, productId: number): Promise<void> {
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

  if (!product) {
    await sendMessage(chatId, "❌ Sản phẩm không tồn tại.");
    return;
  }

  const priceFormatted = parseFloat(product.price).toLocaleString("vi-VN");
  const originalFormatted = product.originalPrice ? `<s>${parseFloat(product.originalPrice).toLocaleString("vi-VN")}đ</s> ` : "";
  const stockText = product.stockCount > 0 ? `✅ Còn hàng (${product.stockCount})` : "❌ Hết hàng";

  let msg = `📦 <b>${product.name}</b>\n`;
  if (product.description) msg += `\n${product.description}\n`;
  msg += `\n💰 Giá: ${originalFormatted}<b>${priceFormatted}đ</b>`;
  msg += `\n📊 Tồn kho: ${stockText}`;
  msg += `\n🔢 Số lượng: ${product.minQuantity} - ${product.maxQuantity}`;

  const keyboard: Array<Array<{ text: string; callback_data: string }>> = [];
  const minQ = product.minQuantity;
  const maxAvailable = Math.min(product.maxQuantity, product.stockCount);
  // Only show purchase actions when there is enough stock to satisfy the minimum quantity.
  if (maxAvailable >= minQ) {
    const row: Array<{ text: string; callback_data: string }> = [];
    // Option 1: minimum quantity (usually 1)
    row.push({ text: `${minQ}`, callback_data: `qty_${productId}_${minQ}` });
    // Option 2: maximum available — only show if it's larger than the minimum
    if (maxAvailable > minQ) {
      row.push({ text: `Tối đa (${maxAvailable})`, callback_data: `qty_${productId}_${maxAvailable}` });
    }
    keyboard.push(row);
    // Option 3: let the user type a custom quantity — only when there's a real range to pick from
    if (maxAvailable > minQ) {
      keyboard.push([{ text: "✏️ Nhập số lượng", callback_data: `qty_input_${productId}` }]);
    }
  }
  keyboard.push([{ text: "⬅️ Quay lại", callback_data: `back_to_cat_${productId}` }]);

  await sendMessage(chatId, msg, { reply_markup: { inline_keyboard: keyboard } });
}

async function promptForPromoCode(chatId: number | string, customerId: number, productId: number, quantity: number): Promise<void> {
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
    await sendMessage(chatId, `❌ Không đủ hàng. Chỉ còn ${stockCount} sản phẩm.`);
    return;
  }

  const subtotal = parseFloat(product.price) * quantity;
  const subtotalFormatted = subtotal.toLocaleString("vi-VN");

  setAwaitingPromo(chatId, productId, quantity);
  await logBotAction("promo_prompt", String(chatId), customerId, `Promo prompt for ${product.name} x${quantity}`, { productId, quantity });

  const msg =
    `🛒 <b>${product.name}</b> x${quantity} — ${subtotalFormatted}đ\n\n` +
    `🎟️ <b>Nhập mã giảm giá (hoặc bỏ qua)</b>\n` +
    `<i>Gõ mã giảm giá vào ô chat, hoặc bấm "Bỏ qua" để tiếp tục.</i>`;
  await sendMessage(chatId, msg, {
    reply_markup: {
      inline_keyboard: [[{ text: "⏭️ Bỏ qua", callback_data: `skip_promo_${productId}_${quantity}` }]],
    },
  });
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
    await sendMessage(chatId, `❌ Không đủ hàng. Chỉ còn ${stockCount} sản phẩm.`);
    return;
  }

  const subtotal = parseFloat(product.price) * quantity;
  const discount = promotion ? promotion.discountAmount : 0;
  const finalTotal = Math.max(0, subtotal - discount);
  const totalAmount = finalTotal.toFixed(2);
  const discountAmount = discount.toFixed(2);
  const orderCode = `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

  const [order] = await db.insert(ordersTable).values({
    orderCode,
    customerId,
    totalAmount,
    promotionId: promotion ? promotion.id : null,
    discountAmount,
    status: "pending",
  }).returning();

  await db.insert(orderItemsTable).values({
    orderId: order.id,
    productId: product.id,
    productName: product.name,
    quantity,
    unitPrice: product.price,
    totalPrice: subtotal.toFixed(2),
  });

  // Increment promotion use_count atomically (only when a code was applied).
  if (promotion) {
    await db.update(promotionsTable)
      .set({ useCount: sqlOp`use_count + 1` })
      .where(eq(promotionsTable.id, promotion.id));
  }

  // Update customer total orders
  const { sql: sqlFn } = await import("drizzle-orm");
  await db.update(customersTable).set({ totalOrders: sqlFn`total_orders + 1` }).where(eq(customersTable.id, customerId));

  await logBotAction("create_order", String(chatId), customerId, `Order ${orderCode} created`, { orderId: order.id, productId, quantity, promotionId: promotion?.id, discountAmount });

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

    await sendMessage(chatId, msg);
    await logBotAction("payment_initiated", String(chatId), customerId, `Payment for order ${orderCode}`, { orderId: order.id, reference: paymentInfo.reference });
  } else {
    await sendMessage(chatId, `✅ Đơn hàng <b>${orderCode}</b> đã tạo! Vui lòng liên hệ admin để thanh toán.`);
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
  msg += `⚠️ <i>Vui lòng chuyển khoản đúng nội dung để đơn hàng được xử lý tự động.</i>`;

  await sendMessage(chatId, msg);
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

  // Get available stock lines (safe atomic update)
  const availableStocks = await db.select().from(productStocksTable)
    .where(and(eq(productStocksTable.productId, item.productId), eq(productStocksTable.status, "available")))
    .limit(item.quantity);

  if (availableStocks.length < item.quantity) {
    await logBotAction("delivery_failed", customer.chatId, customer.id,
      `Insufficient stock for order ${order.orderCode}`,
      { orderId, available: availableStocks.length, required: item.quantity },
      "error"
    );
    await db.update(ordersTable).set({ status: "needs_manual_action" }).where(eq(ordersTable.id, orderId));
    await sendMessage(parseInt(customer.chatId), `⚠️ Đơn hàng <b>${order.orderCode}</b> cần xử lý thủ công. Admin sẽ liên hệ bạn sớm.`);

    // Alert admin about the out-of-stock situation
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
      `📊 Tồn kho còn: ${availableStocks.length} / cần ${item.quantity}\n\n` +
      `Cần nhập thêm hàng và xử lý thủ công đơn này.` +
      orderLink;
    await sendAdminAlert(adminMsg, { orderId, productId: item.productId, productName: item.productName, available: availableStocks.length, required: item.quantity });

    return false;
  }

  // Mark stocks as delivered
  for (const stock of availableStocks) {
    await db.update(productStocksTable).set({ status: "delivered", orderId }).where(
      and(eq(productStocksTable.id, stock.id), eq(productStocksTable.status, "available"))
    );
  }

  // Send stock content to customer
  let deliveryMsg = `🎉 <b>Đơn hàng ${order.orderCode} đã giao thành công!</b>\n\n`;
  deliveryMsg += `📦 ${item.productName} x${item.quantity}\n\n`;
  deliveryMsg += `<b>Thông tin sản phẩm:</b>\n`;
  availableStocks.forEach((s, i) => {
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

async function showWalletHistory(chatId: number | string, customer: typeof customersTable.$inferSelect): Promise<void> {
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

  await sendMessage(chatId, msg, {
    reply_markup: {
      inline_keyboard: [[{ text: "⬅️ Quay lại", callback_data: "main_menu" }]],
    },
  });
}

async function handleTopup(chatId: number | string, customer: typeof customersTable.$inferSelect, text: string): Promise<void> {
  const parts = text.trim().split(/\s+/);
  const rawAmount = parts[1];

  if (!rawAmount) {
    await sendMessage(chatId,
      `💳 <b>Nạp tiền vào tài khoản</b>\n\n` +
      `Sử dụng lệnh: <code>/naptien [số tiền]</code>\n` +
      `Ví dụ: <code>/naptien 100000</code>\n\n` +
      `👛 Số dư hiện tại: <b>${parseFloat(customer.balance).toLocaleString("vi-VN")}đ</b>`
    );
    return;
  }

  const amount = parseInt(rawAmount.replace(/[.,]/g, ""), 10);
  if (isNaN(amount) || amount <= 0) {
    await sendMessage(chatId, "❌ Số tiền không hợp lệ. Vui lòng nhập số tiền dương.\nVí dụ: <code>/naptien 100000</code>");
    return;
  }

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

      const customer = await upsertCustomer(from);
      if (!customer.isActive) return;

      await logBotAction("message", String(chatId), customer.id, text);

      if (text === "/start") {
        clearAwaitingPromo(chatId);
        clearAwaitingQuantity(chatId);
        await logBotAction("start", String(chatId), customer.id, "/start command");
        await showMainMenu(chatId, from.first_name);
      } else if (text.startsWith("/naptien")) {
        clearAwaitingPromo(chatId);
        clearAwaitingQuantity(chatId);
        await handleTopup(chatId, customer, text);
      } else if (text === "/lichsu") {
        clearAwaitingPromo(chatId);
        clearAwaitingQuantity(chatId);
        await showWalletHistory(chatId, customer);
      } else if (awaitingQuantity.has(String(chatId)) && text.trim().length > 0) {
        // Customer typed a custom quantity while in quantity-prompt state.
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
            const [stockRow] = await db.select({ c: count() }).from(productStocksTable).where(sql`${productStocksTable.productId} = ${pending.productId} AND ${productStocksTable.status} = 'available'`);
            const stockCount = Number(stockRow?.c ?? 0);
            const maxAvailable = Math.min(product.maxQuantity, stockCount);
            const trimmed = text.trim();
            const qty = /^\d+$/.test(trimmed) ? parseInt(trimmed, 10) : NaN;
            if (!Number.isFinite(qty) || qty < product.minQuantity || qty > maxAvailable) {
              // Re-arm so the customer can try again.
              setAwaitingQuantity(chatId, pending.productId);
              await sendMessage(
                chatId,
                `❌ Số lượng không hợp lệ. Vui lòng nhập một số từ <b>${product.minQuantity}</b> đến <b>${maxAvailable}</b>.`,
                { reply_markup: { inline_keyboard: [[{ text: "⬅️ Quay lại", callback_data: `prod_${pending.productId}` }]] } }
              );
            } else {
              await logBotAction("quantity_input", String(chatId), customer.id, `Custom quantity ${qty} for product ${pending.productId}`, { productId: pending.productId, quantity: qty });
              await promptForPromoCode(chatId, customer.id, pending.productId, qty);
            }
          }
        }
      } else if (awaitingPromoCode.has(String(chatId)) && text.trim().length > 0) {
        // Customer typed a promo code while in promo-prompt state.
        const pending = takeAwaitingPromo(chatId);
        if (!pending) {
          await sendMessage(chatId, "⏰ Phiên nhập mã đã hết hạn. Vui lòng đặt hàng lại.");
        } else {
          const { sql, count } = await import("drizzle-orm");
          const [product] = await db.select({
            price: productsTable.price,
          }).from(productsTable).where(eq(productsTable.id, pending.productId));
          const [stockRow] = await db.select({ c: count() }).from(productStocksTable).where(sql`${productStocksTable.productId} = ${pending.productId} AND ${productStocksTable.status} = 'available'`);
          const stockCount = Number(stockRow?.c ?? 0);

          if (!product || stockCount < pending.quantity) {
            await sendMessage(chatId, "❌ Sản phẩm không còn đủ hàng. Vui lòng chọn lại.");
          } else {
            const subtotal = parseFloat(product.price) * pending.quantity;
            const result = await validatePromoCode(text, subtotal);
            if ("error" in result) {
              await logBotAction("promo_invalid", String(chatId), customer.id, `Invalid promo "${text}": ${result.error}`, { code: text, productId: pending.productId, quantity: pending.quantity }, "warn");
              // Re-arm the prompt so the user can try again or skip.
              setAwaitingPromo(chatId, pending.productId, pending.quantity);
              await sendMessage(chatId, `❌ ${result.error}\n\n<i>Hãy thử mã khác hoặc bấm "Bỏ qua".</i>`, {
                reply_markup: {
                  inline_keyboard: [[{ text: "⏭️ Bỏ qua", callback_data: `skip_promo_${pending.productId}_${pending.quantity}` }]],
                },
              });
            } else {
              await logBotAction("promo_applied", String(chatId), customer.id, `Applied promo ${result.code} (-${result.discountAmount})`, { code: result.code, promotionId: result.id, discountAmount: result.discountAmount, productId: pending.productId, quantity: pending.quantity });
              await sendMessage(chatId, `✅ Đã áp dụng mã <code>${result.code}</code> — giảm <b>${result.discountAmount.toLocaleString("vi-VN")}đ</b>`);
              await createOrderFromBot(chatId, customer.id, pending.productId, pending.quantity, result);
            }
          }
        }
      }
    } else if (update.callback_query) {
      const cq = update.callback_query;
      const from = cq.from;
      const chatId = cq.message?.chat.id;
      if (!chatId) return;

      await answerCallbackQuery(cq.id);
      const customer = await upsertCustomer(from);
      if (!customer.isActive) return;

      const data = cq.data ?? "";
      await logBotAction("callback", String(chatId), customer.id, data);

      // Any callback that isn't continuing the quantity-input flow exits it cleanly,
      // so a stray text typed afterwards won't be picked up as a quantity.
      if (!data.startsWith("qty_input_")) {
        clearAwaitingQuantity(chatId);
      }

      if (data === "main_menu") {
        await showMainMenu(chatId, from.first_name);
      } else if (data === "browse_products") {
        await showCategories(chatId);
      } else if (data.startsWith("cat_")) {
        const categoryId = parseInt(data.replace("cat_", ""), 10);
        await showProducts(chatId, categoryId);
        await logBotAction("browse_category", String(chatId), customer.id, `Category ${categoryId}`);
      } else if (data.startsWith("prod_")) {
        const productId = parseInt(data.replace("prod_", ""), 10);
        await showProductDetail(chatId, productId);
        await logBotAction("view_product", String(chatId), customer.id, `Product ${productId}`);
      } else if (data.startsWith("qty_input_")) {
        const productId = parseInt(data.replace("qty_input_", ""), 10);
        const { sql, count } = await import("drizzle-orm");
        const [product] = await db.select({
          name: productsTable.name,
          minQuantity: productsTable.minQuantity,
          maxQuantity: productsTable.maxQuantity,
        }).from(productsTable).where(eq(productsTable.id, productId));
        if (!product) {
          await sendMessage(chatId, "❌ Sản phẩm không còn tồn tại.");
        } else {
          const [stockRow] = await db.select({ c: count() }).from(productStocksTable).where(sql`${productStocksTable.productId} = ${productId} AND ${productStocksTable.status} = 'available'`);
          const stockCount = Number(stockRow?.c ?? 0);
          const maxAvailable = Math.min(product.maxQuantity, stockCount);
          if (maxAvailable < product.minQuantity) {
            await sendMessage(chatId, "❌ Sản phẩm đã hết hàng.");
          } else {
            clearAwaitingPromo(chatId);
            setAwaitingQuantity(chatId, productId);
            await logBotAction("quantity_prompt", String(chatId), customer.id, `Quantity prompt for product ${productId}`, { productId, minQuantity: product.minQuantity, maxAvailable });
            await sendMessage(
              chatId,
              `✏️ <b>Nhập số lượng muốn mua cho ${product.name}</b>\n` +
              `<i>Gõ một số từ ${product.minQuantity} đến ${maxAvailable} vào ô chat.</i>`,
              { reply_markup: { inline_keyboard: [[{ text: "⬅️ Quay lại", callback_data: `prod_${productId}` }]] } }
            );
          }
        }
      } else if (data.startsWith("qty_")) {
        const parts = data.split("_");
        const productId = parseInt(parts[1], 10);
        const quantity = parseInt(parts[2], 10);
        clearAwaitingQuantity(chatId);
        await promptForPromoCode(chatId, customer.id, productId, quantity);
      } else if (data.startsWith("skip_promo_")) {
        const parts = data.replace("skip_promo_", "").split("_");
        const productId = parseInt(parts[0], 10);
        const quantity = parseInt(parts[1], 10);
        clearAwaitingPromo(chatId);
        await logBotAction("promo_skipped", String(chatId), customer.id, `Skipped promo for product ${productId} x${quantity}`, { productId, quantity });
        await createOrderFromBot(chatId, customer.id, productId, quantity, null);
      } else if (data.startsWith("pay_with_balance_")) {
        const orderId = parseInt(data.replace("pay_with_balance_", ""), 10);
        const { payWithBalance } = await import("./payments");
        const result = await payWithBalance(orderId, customer.id);
        if (result === "success") {
          await logBotAction("wallet_payment", String(chatId), customer.id, `Wallet payment for order ${orderId}`, { orderId });
          const delivered = await deliverOrder(orderId);
          if (!delivered) {
            await sendMessage(chatId, `✅ Đã thanh toán bằng số dư ví! Đơn hàng đang được xử lý — chúng tôi sẽ giao hàng ngay khi có hàng.`);
          }
        } else if (result === "insufficient") {
          await sendMessage(chatId, "❌ Số dư ví không đủ. Vui lòng nạp thêm hoặc chuyển khoản ngân hàng.");
        } else {
          await sendMessage(chatId, "❌ Đơn hàng không còn hợp lệ để thanh toán bằng ví.");
        }
      } else if (data.startsWith("show_bank_transfer_")) {
        const orderId = parseInt(data.replace("show_bank_transfer_", ""), 10);
        await sendBankTransferForOrder(chatId, orderId, customer.id);
      } else if (data === "wallet_history") {
        await showWalletHistory(chatId, customer);
      } else if (data === "my_orders") {
        const recentOrders = await db.select().from(ordersTable)
          .where(eq(ordersTable.customerId, customer.id))
          .limit(5);
        if (recentOrders.length === 0) {
          await sendMessage(chatId, "📦 Bạn chưa có đơn hàng nào.");
        } else {
          let msg = "📦 <b>Đơn hàng gần đây:</b>\n\n";
          recentOrders.forEach(o => {
            const statusMap: Record<string, string> = { pending: "⏳ Chờ TT", paid: "✅ Đã TT", delivered: "📬 Đã giao", failed: "❌ Lỗi", cancelled: "🚫 Huỷ", needs_manual_action: "⚠️ Cần xử lý" };
            msg += `• <b>${o.orderCode}</b> - ${parseFloat(o.totalAmount).toLocaleString("vi-VN")}đ - ${statusMap[o.status] ?? o.status}\n`;
          });
          await sendMessage(chatId, msg);
        }
      }
    }
  } catch (err) {
    logger.error({ err }, "Error handling Telegram update");
    await logBotAction("bot_error", undefined, undefined, String(err), { stack: (err as Error).stack }, "error");
  }
}
