import { db, ordersTable, transactionsTable, paymentConfigsTable, customersTable, orderItemsTable } from "@workspace/db";
import { eq, desc, and, sql } from "drizzle-orm";
import { logger } from "./logger";

export async function getPaymentConfig() {
  const [config] = await db.select().from(paymentConfigsTable).orderBy(desc(paymentConfigsTable.id)).limit(1);
  return config ?? null;
}

export function buildSepayQrUrl(params: {
  bankCode: string;
  accountNumber: string;
  amount: number;
  description: string;
  accountHolder?: string;
}): string {
  const { bankCode, accountNumber, amount, description, accountHolder } = params;
  const base = `https://img.vietqr.io/image/${encodeURIComponent(bankCode)}-${encodeURIComponent(accountNumber)}-compact2.jpg`;
  const query = new URLSearchParams({
    amount: String(Math.round(amount)),
    addInfo: description,
    ...(accountHolder ? { accountName: accountHolder } : {}),
  });
  return `${base}?${query.toString()}`;
}

export async function createPaymentRequest(orderId: number): Promise<{
  bankName: string;
  accountNumber: string;
  accountHolder: string;
  amount: string;
  reference: string;
  qrUrl: string | null;
} | null> {
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId));
  if (!order) return null;

  const config = await getPaymentConfig();

  // Use the order code itself as the payment reference so customers (and
  // admins) can match a SePay transfer back to the order at a glance. The
  // order code already follows the SePay-friendly "DH" + alphanumeric format
  // and is unique per order, so no extra suffix is needed. Fall back to the
  // legacy SHOP{id}{ts} format only if a code is somehow missing.
  const reference = order.orderCode && order.orderCode.length > 0
    ? order.orderCode
    : `SHOP${orderId}${Date.now().toString(36).toUpperCase()}`;

  await db.update(ordersTable).set({ paymentReference: reference }).where(eq(ordersTable.id, orderId));

  const transactionCode = `TXN-${Date.now()}-${orderId}`;
  await db.insert(transactionsTable).values({
    transactionCode,
    paymentReference: reference,
    type: "payment",
    orderId,
    customerId: order.customerId,
    amount: order.totalAmount,
    status: "pending",
    provider: "sepay",
  });

  const accountNumber = config?.accountNumber ?? "1234567890";
  const bankCode = config?.bankCode ?? config?.bankName ?? "VCB";
  const accountHolder = config?.accountHolder ?? "SHOP OWNER";
  const amount = parseFloat(order.totalAmount);

  const qrUrl = (config?.accountNumber && (config?.bankCode || config?.bankName))
    ? buildSepayQrUrl({ bankCode, accountNumber, amount, description: reference, accountHolder })
    : null;

  return {
    bankName: config?.bankName ?? "Vietcombank",
    accountNumber,
    accountHolder,
    amount: order.totalAmount,
    reference,
    qrUrl,
  };
}

export async function createTopupRequest(customerId: number, amount: number): Promise<{
  bankName: string;
  bankCode: string;
  accountNumber: string;
  accountHolder: string;
  amount: number;
  reference: string;
  qrUrl: string | null;
} | null> {
  const config = await getPaymentConfig();

  // Fail fast if payment config is not set up
  if (!config || !config.accountNumber || (!config.bankCode && !config.bankName)) {
    logger.warn({ customerId, amount }, "Cannot create topup request — payment config is incomplete");
    return null;
  }

  const reference = `TOPUP${customerId}${Date.now().toString(36).toUpperCase()}`;
  const transactionCode = `TXN-TOPUP-${Date.now()}-${customerId}`;

  await db.insert(transactionsTable).values({
    transactionCode,
    paymentReference: reference,
    type: "topup",
    orderId: null,
    customerId,
    amount: amount.toFixed(2),
    status: "pending",
    provider: "sepay",
  });

  const accountNumber = config.accountNumber;
  const bankCode = config.bankCode ?? config.bankName ?? "VCB";
  const accountHolder = config.accountHolder ?? "SHOP OWNER";

  const qrUrl = buildSepayQrUrl({ bankCode, accountNumber, amount, description: reference, accountHolder });

  return {
    bankName: config.bankName ?? bankCode,
    bankCode,
    accountNumber,
    accountHolder,
    amount,
    reference,
    qrUrl,
  };
}

export async function handleSepayWebhook(payload: Record<string, unknown>): Promise<void> {
  logger.info({ payload }, "Processing SePay webhook");

  // SePay sends: transferAmount, description (contains reference), transactionDate, etc.
  const description = String(payload.description ?? payload.content ?? "");
  const receivedAmount = parseFloat(String(payload.transferAmount ?? payload.amount ?? "0"));

  if (isNaN(receivedAmount) || receivedAmount <= 0) {
    logger.warn({ payload }, "SePay webhook has invalid or zero amount — ignoring");
    return;
  }

  // Extract payment reference from description. Supported formats:
  //   - DH{8 alphanumeric} — current order code (also used as payment ref)
  //   - SHOP{orderId}{base36timestamp} — legacy order reference
  //   - TOPUP{customerId}{base36timestamp} — wallet top-up reference
  const refMatch = description.match(/DH[A-Z0-9]{8}|(?:SHOP|TOPUP)\d+[A-Z0-9]+/);
  if (!refMatch) {
    logger.warn({ description }, "No payment reference found in SePay webhook description");
    return;
  }

  const reference = refMatch[0];

  // Find the transaction by reference
  const [transaction] = await db
    .select()
    .from(transactionsTable)
    .where(eq(transactionsTable.paymentReference, reference));

  if (!transaction) {
    logger.warn({ reference }, "No transaction found for payment reference");
    return;
  }

  // Amount validation: received amount must match expected amount (allow ±1 VND for rounding)
  const expectedAmount = parseFloat(transaction.amount);
  const tolerance = 1;
  if (Math.abs(receivedAmount - expectedAmount) > tolerance) {
    logger.warn({ reference, receivedAmount, expectedAmount }, "SePay webhook amount mismatch — rejecting");
    // Mark as failed only if still pending (idempotent)
    await db.update(transactionsTable).set({
      status: "failed",
      rawPayload: JSON.stringify(payload),
    }).where(and(eq(transactionsTable.id, transaction.id), eq(transactionsTable.status, "pending")));

    // Alert admin about the payment mismatch with full context
    const [failedOrder] = transaction.orderId
      ? await db.select().from(ordersTable).where(eq(ordersTable.id, transaction.orderId))
      : [null];

    let customerLine = "";
    let productLine = "";
    if (failedOrder) {
      const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, failedOrder.customerId));
      if (customer) {
        const displayName = [customer.firstName, customer.lastName].filter(Boolean).join(" ") || customer.username || `ID:${customer.id}`;
        customerLine = `👤 Khách hàng: ${displayName}${customer.username ? ` (@${customer.username})` : ""}\n`;
      }
      const items = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, failedOrder.id));
      if (items.length > 0) {
        productLine = `🛍️ Sản phẩm: ${items.map(i => `${i.productName} x${i.quantity}`).join(", ")}\n`;
      }
    } else if (transaction.customerId && transaction.type === "topup") {
      const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, transaction.customerId));
      if (customer) {
        const displayName = [customer.firstName, customer.lastName].filter(Boolean).join(" ") || customer.username || `ID:${customer.id}`;
        customerLine = `👤 Khách hàng: ${displayName}${customer.username ? ` (@${customer.username})` : ""}\n`;
      }
    }

    const adminBaseUrl = process.env.ADMIN_BASE_URL
      || (process.env.REPLIT_DOMAINS ? `https://${process.env.REPLIT_DOMAINS.split(",")[0].trim()}` : "")
      || (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "");
    const orderLink = failedOrder && adminBaseUrl ? `\n🔗 <a href="${adminBaseUrl}/orders/${failedOrder.id}">Xem đơn hàng trong Admin Panel</a>` : "";

    const typeLabel = transaction.type === "topup" ? "Nạp tiền" : "Thanh toán";
    const adminMsg =
      `💸 <b>${typeLabel} sai số tiền</b>\n\n` +
      `📦 Mã giao dịch: <code>${reference}</code>\n` +
      `${failedOrder ? `🛒 Đơn hàng: <code>${failedOrder.orderCode}</code>\n` : ""}` +
      customerLine +
      productLine +
      `💰 Số tiền nhận: <b>${receivedAmount.toLocaleString("vi-VN")}đ</b>\n` +
      `✅ Số tiền cần: <b>${expectedAmount.toLocaleString("vi-VN")}đ</b>\n` +
      `📊 Chênh lệch: ${(receivedAmount - expectedAmount).toLocaleString("vi-VN")}đ\n\n` +
      `Cần xử lý thủ công giao dịch này.` +
      orderLink;
    try {
      const { sendAdminAlert } = await import("./bot");
      await sendAdminAlert(adminMsg, { reference, receivedAmount, expectedAmount, orderId: transaction.orderId });
    } catch (err) {
      logger.error({ err }, "Failed to send admin alert for payment mismatch");
    }
    return;
  }

  // Atomically confirm the transaction: only proceed if it's still pending.
  // This prevents double-processing from concurrent duplicate webhook deliveries.
  const [confirmed] = await db.update(transactionsTable).set({
    status: "confirmed",
    confirmedAt: new Date(),
    rawPayload: JSON.stringify(payload),
  }).where(and(
    eq(transactionsTable.id, transaction.id),
    eq(transactionsTable.status, "pending"),
  )).returning({ id: transactionsTable.id });

  if (!confirmed) {
    logger.info({ reference, transactionId: transaction.id }, "Webhook already processed — atomic update found non-pending status, skipping");
    return;
  }

  logger.info({ reference, type: transaction.type, amount: receivedAmount }, "Payment confirmed");

  // Handle based on transaction type
  if (transaction.type === "topup" && transaction.customerId) {
    // Credit the customer's balance atomically in the same operation
    await db.update(customersTable)
      .set({ balance: sql`balance + ${receivedAmount}` })
      .where(eq(customersTable.id, transaction.customerId));

    // Fetch updated customer to send confirmation
    const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, transaction.customerId));
    if (customer) {
      const newBalance = parseFloat(customer.balance).toLocaleString("vi-VN");
      const addedAmount = receivedAmount.toLocaleString("vi-VN");
      const confirmMsg =
        `✅ <b>Nạp tiền thành công!</b>\n\n` +
        `💰 Số tiền nạp: <b>${addedAmount}đ</b>\n` +
        `👛 Số dư hiện tại: <b>${newBalance}đ</b>\n\n` +
        `Cảm ơn bạn đã nạp tiền. Số dư sẽ được dùng cho các đơn hàng tiếp theo.`;
      try {
        const { sendMessageToCustomer } = await import("./bot");
        await sendMessageToCustomer(customer.chatId, confirmMsg);
      } catch (err) {
        logger.error({ err, customerId: transaction.customerId }, "Failed to send topup confirmation");
      }
    }

    logger.info({ reference, customerId: transaction.customerId, amount: receivedAmount }, "Balance topped up");
    return;
  }

  // Update order to paid and trigger auto delivery
  if (transaction.orderId) {
    const [currentOrder] = await db.select({ id: ordersTable.id, status: ordersTable.status })
      .from(ordersTable).where(eq(ordersTable.id, transaction.orderId));

    if (!currentOrder) {
      logger.warn({ reference, orderId: transaction.orderId }, "SePay webhook: order not found, skipping delivery");
      return;
    }

    const terminalStatuses = ["paid", "delivered", "retry_exhausted"];
    if (terminalStatuses.includes(currentOrder.status)) {
      logger.info({ reference, orderId: transaction.orderId, orderStatus: currentOrder.status },
        "SePay webhook: order already in terminal state — recording payment but skipping re-delivery");
      return;
    }

    await db.update(ordersTable).set({ status: "paid", paidAt: new Date() }).where(eq(ordersTable.id, transaction.orderId));

    try {
      const { deliverOrder } = await import("./bot");
      await deliverOrder(transaction.orderId);
    } catch (err) {
      logger.error({ err, orderId: transaction.orderId }, "Auto delivery failed after payment confirmation");
    }
  }
}

/**
 * Deduct from customer wallet balance and mark the order as paid — atomically.
 * All three operations (order claim, balance deduction, transaction insert) run in
 * a single DB transaction; any failure rolls back all of them.
 * Returns "success", "insufficient" (not enough balance), or "error" (order not eligible / already claimed).
 */
export async function payWithBalance(orderId: number, customerId: number): Promise<"success" | "insufficient" | "error"> {
  const [order] = await db.select().from(ordersTable).where(
    and(eq(ordersTable.id, orderId), eq(ordersTable.customerId, customerId))
  );
  if (!order || order.status !== "pending") return "error";

  const totalAmount = parseFloat(order.totalAmount).toFixed(2);

  const INSUFFICIENT = "INSUFFICIENT_BALANCE";

  try {
    await db.transaction(async (tx) => {
      // 1. Claim the order (pending → paid) — prevents concurrent double-payment
      const claimed = await tx.update(ordersTable)
        .set({ status: "paid", paidAt: new Date() })
        .where(and(eq(ordersTable.id, orderId), eq(ordersTable.status, "pending")))
        .returning({ id: ordersTable.id });

      if (claimed.length === 0) throw new Error("ORDER_ALREADY_CLAIMED");

      // 2. Deduct balance — rolls back order claim if balance is insufficient
      const deducted = await tx.update(customersTable)
        .set({ balance: sql`balance - ${totalAmount}::numeric` })
        .where(and(
          eq(customersTable.id, customerId),
          sql`balance >= ${totalAmount}::numeric`
        ))
        .returning({ newBalance: customersTable.balance });

      if (deducted.length === 0) throw new Error(INSUFFICIENT);

      // 3. Record the wallet transaction
      const transactionCode = `TXN-WALLET-${Date.now()}-${orderId}`;
      await tx.insert(transactionsTable).values({
        transactionCode,
        type: "balance_payment",
        orderId,
        customerId,
        amount: order.totalAmount,
        status: "confirmed",
        provider: "wallet",
        confirmedAt: new Date(),
      });
    });

    return "success";
  } catch (err) {
    const message = (err as Error).message;
    if (message === INSUFFICIENT) return "insufficient";
    if (message === "ORDER_ALREADY_CLAIMED") return "error";
    throw err;
  }
}
