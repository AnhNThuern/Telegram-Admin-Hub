import { db, ordersTable, transactionsTable, customersTable, botLogsTable, productStocksTable } from "@workspace/db";
import { and, eq, lt } from "drizzle-orm";
import { logger } from "./logger";
import { sendMessageToCustomer, cleanupExpiredBotPendingActions } from "./bot";

const EXPIRY_MINUTES = Math.max(1, parseInt(process.env.PENDING_ORDER_EXPIRY_MINUTES ?? "15", 10) || 15);
const SWEEP_INTERVAL_MS = 60 * 1000;

let sweepRunning = false;

export async function expireStalePendingOrders(): Promise<{ expired: number }> {
  if (sweepRunning) return { expired: 0 };
  sweepRunning = true;
  try {
    // Always prune expired bot pending actions, even when there are no stale
    // orders to cancel — abandoned promo prompts must be cleaned up on every
    // tick, not only on ticks that happen to find an expired order.
    try {
      const prunedActions = await cleanupExpiredBotPendingActions();
      if (prunedActions > 0) {
        logger.info({ pruned: prunedActions }, "Cleaned up expired bot pending actions");
      }
    } catch (cleanupErr) {
      logger.warn({ cleanupErr }, "Failed to clean up expired bot pending actions");
    }

    const cutoff = new Date(Date.now() - EXPIRY_MINUTES * 60 * 1000);
    const stale = await db
      .select({
        id: ordersTable.id,
        orderCode: ordersTable.orderCode,
        customerId: ordersTable.customerId,
        totalAmount: ordersTable.totalAmount,
        createdAt: ordersTable.createdAt,
      })
      .from(ordersTable)
      .where(and(eq(ordersTable.status, "pending"), lt(ordersTable.createdAt, cutoff)));

    if (stale.length === 0) return { expired: 0 };

    let expiredCount = 0;
    for (const order of stale) {
      const [updated] = await db
        .update(ordersTable)
        .set({ status: "cancelled" })
        .where(and(eq(ordersTable.id, order.id), eq(ordersTable.status, "pending")))
        .returning({ id: ordersTable.id });

      if (!updated) continue;
      expiredCount++;

      // Cancel any pending bank-payment transactions tied to this order so the SePay
      // webhook will not retroactively process payment for an expired order.
      await db
        .update(transactionsTable)
        .set({ status: "cancelled" })
        .where(and(eq(transactionsTable.orderId, order.id), eq(transactionsTable.status, "pending")));

      // Release any stock rows that were reserved for this order at creation time
      // back to 'available' so they can be purchased by other customers.
      await db
        .update(productStocksTable)
        .set({ status: "available", orderId: null })
        .where(and(eq(productStocksTable.orderId, order.id), eq(productStocksTable.status, "reserved")));

      await db.insert(botLogsTable).values({
        action: "pending_order_expired",
        content: `Order ${order.orderCode} (id=${order.id}) auto-cancelled after ${EXPIRY_MINUTES} minutes without payment`,
        metadata: { orderId: order.id, orderCode: order.orderCode, totalAmount: order.totalAmount, ageMinutes: Math.round((Date.now() - new Date(order.createdAt).getTime()) / 60000) },
        level: "info",
      }).catch(() => {});

      try {
        const [customer] = await db.select({ chatId: customersTable.chatId }).from(customersTable).where(eq(customersTable.id, order.customerId));
        if (customer?.chatId) {
          const amount = parseFloat(order.totalAmount).toLocaleString("vi-VN");
          await sendMessageToCustomer(
            customer.chatId,
            `⏰ <b>Đơn hàng đã hết hạn</b>\n\n` +
            `Đơn hàng <code>${order.orderCode}</code> (${amount}đ) đã quá ${EXPIRY_MINUTES} phút mà chưa nhận được thanh toán nên đã tự động huỷ.\n\n` +
            `Nếu bạn vẫn muốn mua, vui lòng tạo đơn mới. Cảm ơn bạn!`
          );
        }
      } catch (notifyErr) {
        logger.warn({ notifyErr, orderId: order.id }, "Failed to notify customer about expired pending order");
      }
    }

    if (expiredCount > 0) {
      logger.info({ expired: expiredCount, expiryMinutes: EXPIRY_MINUTES }, "Pending order expiry sweep completed");
    }

    return { expired: expiredCount };
  } catch (err) {
    logger.error({ err }, "Pending order expiry sweep failed");
    return { expired: 0 };
  } finally {
    sweepRunning = false;
  }
}

export function startPendingOrderExpirySweep(): void {
  logger.info({ expiryMinutes: EXPIRY_MINUTES, intervalMs: SWEEP_INTERVAL_MS }, "Starting pending-order expiry sweep");
  setInterval(() => {
    expireStalePendingOrders().catch(err => {
      logger.error({ err }, "Unhandled error in pending-order expiry sweep");
    });
  }, SWEEP_INTERVAL_MS);
}
