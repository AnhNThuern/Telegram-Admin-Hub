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

  // Update order with reference
  await db.update(ordersTable).set({ paymentReference: reference }).where(eq(ordersTable.id, orderId));

  // Create pending transaction
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
  logger.info({ payload }, "Received SePay webhook");

  // SePay sends: transferAmount, description (contains reference), transactionDate, etc.
  const description = String(payload.description ?? payload.content ?? "");
  const amount = String(payload.transferAmount ?? payload.amount ?? "0");

  // Extract payment reference from description
  // Reference format: SHOP{orderId}{timestamp}
  const refMatch = description.match(/SHOP\d+[A-Z0-9]+/);
  if (!refMatch) {
    logger.warn({ description }, "No payment reference found in SePay webhook");
    return;
  }

  const reference = refMatch[0];

  // Find the transaction
  const [transaction] = await db.select().from(transactionsTable).where(eq(transactionsTable.paymentReference, reference));
  if (!transaction) {
    logger.warn({ reference }, "No transaction found for payment reference");
    return;
  }

  // Idempotency check
  if (transaction.status === "confirmed" || transaction.status === "delivered") {
    logger.info({ reference }, "Webhook already processed, skipping");
    return;
  }

  // Mark transaction as confirmed
  await db.update(transactionsTable).set({
    status: "confirmed",
    confirmedAt: new Date(),
    rawPayload: JSON.stringify(payload),
  }).where(eq(transactionsTable.id, transaction.id));

  // Update order to paid
  if (transaction.orderId) {
    await db.update(ordersTable).set({ status: "paid", paidAt: new Date() }).where(eq(ordersTable.id, transaction.orderId));

    // Trigger auto delivery
    try {
      const { deliverOrder } = await import("./bot");
      await deliverOrder(transaction.orderId);
    } catch (err) {
      logger.error({ err, orderId: transaction.orderId }, "Auto delivery failed after payment");
    }
  }
}
