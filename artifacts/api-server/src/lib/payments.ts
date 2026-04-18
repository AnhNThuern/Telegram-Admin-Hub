import { db, ordersTable, transactionsTable, paymentConfigsTable, customersTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { logger } from "./logger";

export async function getPaymentConfig() {
  const [config] = await db.select().from(paymentConfigsTable).orderBy(desc(paymentConfigsTable.id)).limit(1);
  return config ?? null;
}

export async function createPaymentRequest(orderId: number): Promise<{
  bankName: string;
  accountNumber: string;
  accountHolder: string;
  amount: string;
  reference: string;
} | null> {
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId));
  if (!order) return null;

  const config = await getPaymentConfig();

  const reference = `SHOP${orderId}${Date.now().toString(36).toUpperCase()}`;

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

  return {
    bankName: config?.bankName ?? "Vietcombank",
    accountNumber: config?.accountNumber ?? "1234567890",
    accountHolder: config?.accountHolder ?? "SHOP OWNER",
    amount: order.totalAmount,
    reference,
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

  // Extract payment reference from description
  // Reference format: SHOP{orderId}{base36timestamp}
  const refMatch = description.match(/SHOP\d+[A-Z0-9]+/);
  if (!refMatch) {
    logger.warn({ description }, "No payment reference found in SePay webhook description");
    return;
  }

  const reference = refMatch[0];

  // Find the pending transaction
  const [transaction] = await db
    .select()
    .from(transactionsTable)
    .where(eq(transactionsTable.paymentReference, reference));

  if (!transaction) {
    logger.warn({ reference }, "No transaction found for payment reference");
    return;
  }

  // Idempotency: skip already-processed transactions
  if (transaction.status === "confirmed" || transaction.status === "delivered") {
    logger.info({ reference, status: transaction.status }, "Webhook already processed — skipping");
    return;
  }

  // Amount validation: received amount must match expected amount (allow ±1 VND for rounding)
  const expectedAmount = parseFloat(transaction.amount);
  const tolerance = 1;
  if (Math.abs(receivedAmount - expectedAmount) > tolerance) {
    logger.warn({ reference, receivedAmount, expectedAmount }, "SePay webhook amount mismatch — rejecting");
    await db.update(transactionsTable).set({
      status: "failed",
      rawPayload: JSON.stringify(payload),
    }).where(eq(transactionsTable.id, transaction.id));

    // Alert admin about the payment mismatch
    const [failedOrder] = transaction.orderId
      ? await db.select().from(ordersTable).where(eq(ordersTable.id, transaction.orderId))
      : [null];
    const adminMsg =
      `💸 <b>Thanh toán sai số tiền</b>\n\n` +
      `📦 Mã giao dịch: <code>${reference}</code>\n` +
      `${failedOrder ? `🛒 Đơn hàng: <code>${failedOrder.orderCode}</code>\n` : ""}` +
      `💰 Số tiền nhận: <b>${receivedAmount.toLocaleString("vi-VN")}đ</b>\n` +
      `✅ Số tiền cần: <b>${expectedAmount.toLocaleString("vi-VN")}đ</b>\n` +
      `📊 Chênh lệch: ${(receivedAmount - expectedAmount).toLocaleString("vi-VN")}đ\n\n` +
      `Cần xử lý thủ công giao dịch này.`;
    try {
      const { sendAdminAlert } = await import("./bot");
      await sendAdminAlert(adminMsg, { reference, receivedAmount, expectedAmount, orderId: transaction.orderId });
    } catch (err) {
      logger.error({ err }, "Failed to send admin alert for payment mismatch");
    }
    return;
  }

  // Confirm the transaction
  await db.update(transactionsTable).set({
    status: "confirmed",
    confirmedAt: new Date(),
    rawPayload: JSON.stringify(payload),
  }).where(eq(transactionsTable.id, transaction.id));

  logger.info({ reference, orderId: transaction.orderId, amount: receivedAmount }, "Payment confirmed");

  // Update order to paid and trigger auto delivery
  if (transaction.orderId) {
    await db.update(ordersTable).set({ status: "paid", paidAt: new Date() }).where(eq(ordersTable.id, transaction.orderId));

    try {
      const { deliverOrder } = await import("./bot");
      await deliverOrder(transaction.orderId);
    } catch (err) {
      logger.error({ err, orderId: transaction.orderId }, "Auto delivery failed after payment confirmation");
    }
  }
}
