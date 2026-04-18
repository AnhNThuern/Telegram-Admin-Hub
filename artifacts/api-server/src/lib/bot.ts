import { db, botLogsTable, customersTable, ordersTable, orderItemsTable, productStocksTable, transactionsTable, productsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "./logger";

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
  if (product.stockCount > 0) {
    const qtys = [];
    for (let q = product.minQuantity; q <= Math.min(product.maxQuantity, product.stockCount, 5); q++) {
      qtys.push({ text: `${q}`, callback_data: `qty_${productId}_${q}` });
    }
    if (qtys.length > 0) keyboard.push(qtys);
  }
  keyboard.push([{ text: "⬅️ Quay lại", callback_data: `back_to_cat_${productId}` }]);

  await sendMessage(chatId, msg, { reply_markup: { inline_keyboard: keyboard } });
}

async function createOrderFromBot(chatId: number | string, customerId: number, productId: number, quantity: number): Promise<void> {
  const { sql } = await import("drizzle-orm");
  const [product] = await db.select({
    id: productsTable.id,
    name: productsTable.name,
    price: productsTable.price,
    minQuantity: productsTable.minQuantity,
    maxQuantity: productsTable.maxQuantity,
    stockCount: sql<number>`(SELECT COUNT(*) FROM product_stocks WHERE product_id = ${productsTable.id} AND status = 'available')::int`,
  }).from(productsTable).where(eq(productsTable.id, productId));

  if (!product) {
    await sendMessage(chatId, "❌ Sản phẩm không còn tồn tại.");
    return;
  }

  if (quantity < product.minQuantity || quantity > product.maxQuantity) {
    await sendMessage(chatId, `❌ Số lượng không hợp lệ. Mua từ ${product.minQuantity} đến ${product.maxQuantity}.`);
    return;
  }

  if (product.stockCount < quantity) {
    await sendMessage(chatId, `❌ Không đủ hàng. Chỉ còn ${product.stockCount} sản phẩm.`);
    return;
  }

  const totalAmount = (parseFloat(product.price) * quantity).toFixed(2);
  const orderCode = `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

  const [order] = await db.insert(ordersTable).values({
    orderCode,
    customerId,
    totalAmount,
    status: "pending",
  }).returning();

  await db.insert(orderItemsTable).values({
    orderId: order.id,
    productId: product.id,
    productName: product.name,
    quantity,
    unitPrice: product.price,
    totalPrice: totalAmount,
  });

  // Update customer total orders
  const { sql: sqlFn } = await import("drizzle-orm");
  await db.update(customersTable).set({ totalOrders: sqlFn`total_orders + 1` }).where(eq(customersTable.id, customerId));

  await logBotAction("create_order", String(chatId), customerId, `Order ${orderCode} created`, { orderId: order.id, productId, quantity });

  // Send payment instructions
  const { createPaymentRequest } = await import("./payments");
  const paymentInfo = await createPaymentRequest(order.id);

  if (paymentInfo) {
    const amountFormatted = parseFloat(totalAmount).toLocaleString("vi-VN");
    let msg = `✅ <b>Đơn hàng #${orderCode} đã tạo!</b>\n\n`;
    msg += `📦 Sản phẩm: ${product.name} x${quantity}\n`;
    msg += `💰 Tổng tiền: <b>${amountFormatted}đ</b>\n\n`;
    msg += `🏦 <b>Thông tin thanh toán:</b>\n`;
    msg += `Ngân hàng: <b>${paymentInfo.bankName}</b>\n`;
    msg += `Số tài khoản: <code>${paymentInfo.accountNumber}</code>\n`;
    msg += `Chủ TK: <b>${paymentInfo.accountHolder}</b>\n`;
    msg += `Số tiền: <b>${amountFormatted}đ</b>\n`;
    msg += `Nội dung CK: <code>${paymentInfo.reference}</code>\n\n`;
    msg += `⚠️ <i>Vui lòng chuyển khoản đúng nội dung để đơn hàng được xử lý tự động.</i>`;

    await sendMessage(chatId, msg);
    await logBotAction("payment_initiated", String(chatId), customerId, `Payment for order ${orderCode}`, { orderId: order.id, reference: paymentInfo.reference });
  } else {
    await sendMessage(chatId, `✅ Đơn hàng <b>${orderCode}</b> đã tạo! Vui lòng liên hệ admin để thanh toán.`);
  }
}

export async function deliverOrder(orderId: number): Promise<boolean> {
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId));
  if (!order || order.status !== "paid") return false;

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
  deliveryMsg += `\n✅ Cảm ơn bạn đã mua hàng!`;

  await sendMessage(parseInt(customer.chatId), deliveryMsg);

  // Update order status
  await db.update(ordersTable).set({ status: "delivered", deliveredAt: new Date() }).where(eq(ordersTable.id, orderId));

  // Update customer total spent
  const { sql } = await import("drizzle-orm");
  await db.update(customersTable).set({ totalSpent: sql`total_spent + ${parseFloat(order.totalAmount)}` }).where(eq(customersTable.id, customer.id));

  await logBotAction("delivery_sent", customer.chatId, customer.id, `Delivered order ${order.orderCode}`, { orderId });
  return true;
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
        await logBotAction("start", String(chatId), customer.id, "/start command");
        await showMainMenu(chatId, from.first_name);
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
      } else if (data.startsWith("qty_")) {
        const parts = data.split("_");
        const productId = parseInt(parts[1], 10);
        const quantity = parseInt(parts[2], 10);
        await createOrderFromBot(chatId, customer.id, productId, quantity);
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
