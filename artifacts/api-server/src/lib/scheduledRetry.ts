import { db, botLogsTable, ordersTable } from "@workspace/db";
import { or, eq, and, lt, sql } from "drizzle-orm";
import { deliverOrder, sendAdminAlert } from "./bot";
import { logger } from "./logger";

const _sweepIntervalMinutes = Math.max(1, parseInt(process.env.RETRY_SWEEP_INTERVAL_MINUTES ?? "20", 10) || 20);
const RETRY_INTERVAL_MS = _sweepIntervalMinutes * 60 * 1000;
const MAX_RETRY_COUNT = 10;
const MAX_ORDER_AGE_DAYS = 7;

const STUCK_STATUSES = ["needs_manual_action", "confirmed_not_delivered"] as const;
type StuckStatus = typeof STUCK_STATUSES[number];

let sweepRunning = false;

export interface RetrySweepResult {
  alreadyRunning: boolean;
  swept: number;
  delivered: number;
  failed: number;
  errored: number;
  exhausted: number;
}

export async function runStuckOrderRetrySweep(): Promise<RetrySweepResult> {
  if (sweepRunning) {
    logger.warn("Scheduled retry sweep skipped: previous sweep still running");
    return { alreadyRunning: true, swept: 0, delivered: 0, failed: 0, errored: 0, exhausted: 0 };
  }
  sweepRunning = true;
  try {
    const ageThreshold = new Date(Date.now() - MAX_ORDER_AGE_DAYS * 24 * 60 * 60 * 1000);

    // Step 1: Identify orders that have hit the retry limit and exhaust them
    const toExhaust = await db
      .select({ id: ordersTable.id, orderCode: ordersTable.orderCode, retryCount: ordersTable.retryCount, createdAt: ordersTable.createdAt })
      .from(ordersTable)
      .where(
        and(
          or(...STUCK_STATUSES.map(s => eq(ordersTable.status, s))),
          or(
            sql`${ordersTable.retryCount} >= ${MAX_RETRY_COUNT}`,
            lt(ordersTable.createdAt, ageThreshold)
          )
        )
      );

    for (const order of toExhaust) {
      const [exhausted] = await db
        .update(ordersTable)
        .set({ status: "retry_exhausted", retryExhaustedAt: new Date() })
        .where(and(eq(ordersTable.id, order.id), or(...STUCK_STATUSES.map(s => eq(ordersTable.status, s)))))
        .returning({ id: ordersTable.id });

      if (!exhausted) continue;

      const reason = order.retryCount >= MAX_RETRY_COUNT
        ? `đã thử ${order.retryCount} lần (giới hạn ${MAX_RETRY_COUNT})`
        : `đơn hàng quá ${MAX_ORDER_AGE_DAYS} ngày tuổi`;

      await db.insert(botLogsTable).values({
        action: "retry_exhausted",
        content: `Order ${order.orderCode} (id=${order.id}) marked retry_exhausted: ${reason}`,
        metadata: { orderId: order.id, orderCode: order.orderCode, retryCount: order.retryCount, reason },
        level: "warn",
      });

      const adminBaseUrl = process.env.ADMIN_BASE_URL
        || (process.env.REPLIT_DOMAINS ? `https://${process.env.REPLIT_DOMAINS.split(",")[0].trim()}` : "")
        || (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "");
      const orderLink = adminBaseUrl ? `\n🔗 <a href="${adminBaseUrl}/orders/${order.id}">Xem đơn hàng trong Admin Panel</a>` : "";

      await sendAdminAlert(
        `🚫 <b>Đơn hàng đã hết lượt thử giao</b>\n\n` +
        `📦 Đơn hàng: <code>${order.orderCode}</code>\n` +
        `📊 Lý do: ${reason}\n` +
        `🔢 Số lần đã thử: ${order.retryCount}\n\n` +
        `Đơn hàng đã được đánh dấu là "retry_exhausted". Cần xử lý thủ công.` +
        orderLink,
        { orderId: order.id, orderCode: order.orderCode, retryCount: order.retryCount }
      );

      logger.warn({ orderId: order.id, orderCode: order.orderCode, retryCount: order.retryCount }, "Order marked retry_exhausted");
    }

    // Step 2: Fetch remaining stuck orders (within limits) for retry
    const stuckOrders = await db
      .select({ id: ordersTable.id, orderCode: ordersTable.orderCode, status: ordersTable.status, retryCount: ordersTable.retryCount })
      .from(ordersTable)
      .where(
        and(
          or(...STUCK_STATUSES.map(s => eq(ordersTable.status, s))),
          sql`${ordersTable.retryCount} < ${MAX_RETRY_COUNT}`,
          sql`${ordersTable.createdAt} >= ${ageThreshold.toISOString()}`
        )
      );

    await db.insert(botLogsTable).values({
      action: "scheduled_retry_sweep_started",
      content: `Scheduled retry sweep started: ${toExhaust.length} exhausted, ${stuckOrders.length} retrying`,
      metadata: { exhausted: toExhaust.length, retrying: stuckOrders.length, orderIds: stuckOrders.map(o => o.id) },
      level: "info",
    });

    if (stuckOrders.length === 0) {
      logger.info({ exhausted: toExhaust.length }, "Scheduled retry sweep: no eligible stuck orders to retry");
      await db.insert(botLogsTable).values({
        action: "scheduled_retry_sweep_completed",
        content: "Scheduled retry sweep completed: no stuck orders to retry",
        metadata: { swept: 0, delivered: 0, failed: 0, errored: 0, exhausted: toExhaust.length },
        level: "info",
      });
      return { alreadyRunning: false, swept: 0, delivered: 0, failed: 0, errored: 0, exhausted: toExhaust.length };
    }

    logger.info({ count: stuckOrders.length }, "Scheduled retry sweep: attempting delivery for stuck orders");

    let delivered = 0;
    let failed = 0;
    let errored = 0;
    const deliveredCodes: string[] = [];
    const failedCodes: string[] = [];
    const erroredCodes: string[] = [];

    for (const { id: orderId, orderCode, status, retryCount } of stuckOrders) {
      try {
        const previousStatus = status as StuckStatus;

        const [updated] = await db
          .update(ordersTable)
          .set({ status: "paid" })
          .where(and(eq(ordersTable.id, orderId), or(...STUCK_STATUSES.map(s => eq(ordersTable.status, s)))))
          .returning({ id: ordersTable.id });

        if (!updated) continue;

        let success: boolean;
        try {
          success = await deliverOrder(orderId);
        } catch (deliverErr) {
          logger.error({ err: deliverErr, orderId, orderCode }, "deliverOrder threw unexpectedly during sweep; restoring stuck status");

          await db
            .update(ordersTable)
            .set({ status: previousStatus, retryCount: retryCount + 1 })
            .where(and(eq(ordersTable.id, orderId), eq(ordersTable.status, "paid")));

          await db.insert(botLogsTable).values({
            action: "scheduled_retry_exception",
            content: `Scheduled retry for order ${orderCode} (id=${orderId}) threw an error: ${deliverErr instanceof Error ? deliverErr.message : String(deliverErr)}`,
            metadata: { orderId, orderCode, previousStatus, retryCount: retryCount + 1, error: deliverErr instanceof Error ? deliverErr.message : String(deliverErr) },
            level: "error",
          });

          errored++;
          erroredCodes.push(orderCode);
          continue;
        }

        await db.insert(botLogsTable).values({
          action: success ? "scheduled_retry_delivered" : "scheduled_retry_failed",
          content: `Scheduled retry for order ${orderCode} (id=${orderId}): ${success ? "delivered" : "failed"} (attempt ${retryCount + 1})`,
          metadata: { orderId, orderCode, previousStatus, retryCount: success ? retryCount : retryCount + 1 },
          level: success ? "info" : "warn",
        });

        if (success) {
          delivered++;
          deliveredCodes.push(orderCode);
        } else {
          // deliverOrder resets status to needs_manual_action internally; increment retryCount
          await db
            .update(ordersTable)
            .set({ retryCount: retryCount + 1 })
            .where(eq(ordersTable.id, orderId));

          failed++;
          failedCodes.push(orderCode);
        }
      } catch (orderErr) {
        logger.error({ err: orderErr, orderId, orderCode }, "Unexpected error processing order during sweep");
        errored++;
        erroredCodes.push(orderCode);
      }
    }

    const summaryLines = [
      `🔄 <b>Quét định kỳ đơn hàng bị kẹt</b>`,
      ``,
      `📊 Tổng số đơn hàng bị kẹt: <b>${stuckOrders.length}</b>`,
      `✅ Giao thành công: <b>${delivered}</b>`,
      `❌ Thất bại (chưa đủ hàng): <b>${failed}</b>`,
      `⚠️ Lỗi ngoại lệ: <b>${errored}</b>`,
    ];

    if (deliveredCodes.length > 0) {
      summaryLines.push(``, `Đơn giao được: ${deliveredCodes.map(c => `<code>${c}</code>`).join(", ")}`);
    }
    if (failedCodes.length > 0) {
      summaryLines.push(``, `Đơn chưa giao được: ${failedCodes.map(c => `<code>${c}</code>`).join(", ")}`);
    }
    if (erroredCodes.length > 0) {
      summaryLines.push(``, `Đơn gặp lỗi (đã hoàn trạng thái): ${erroredCodes.map(c => `<code>${c}</code>`).join(", ")}`);
    }

    if (delivered > 0 || failed > 0 || errored > 0 || toExhaust.length > 0) {
      await sendAdminAlert(summaryLines.join("\n"), {
        swept: stuckOrders.length,
        delivered,
        failed,
        errored,
        exhausted: toExhaust.length,
        deliveredCodes,
        failedCodes,
        erroredCodes,
      });
    }

    await db.insert(botLogsTable).values({
      action: "scheduled_retry_sweep_completed",
      content: `Sweep completed: ${delivered} delivered, ${failed} failed, ${errored} errored, ${toExhaust.length} exhausted out of ${stuckOrders.length} stuck`,
      metadata: { swept: stuckOrders.length, delivered, failed, errored, exhausted: toExhaust.length },
      level: errored > 0 || failed > 0 ? "warn" : "info",
    });

    logger.info({ swept: stuckOrders.length, delivered, failed, errored, exhausted: toExhaust.length }, "Scheduled retry sweep completed");
    return { alreadyRunning: false, swept: stuckOrders.length, delivered, failed, errored, exhausted: toExhaust.length };
  } catch (err) {
    logger.error({ err }, "Scheduled retry sweep encountered an error");
    await db.insert(botLogsTable).values({
      action: "scheduled_retry_sweep_error",
      content: `Scheduled retry sweep error: ${err instanceof Error ? err.message : String(err)}`,
      metadata: { error: err instanceof Error ? err.message : String(err) },
      level: "error",
    }).catch(() => {});
    throw err;
  } finally {
    sweepRunning = false;
  }
}

export function startScheduledRetrySweep(): void {
  logger.info({ intervalMinutes: _sweepIntervalMinutes, intervalMs: RETRY_INTERVAL_MS, maxRetryCount: MAX_RETRY_COUNT, maxOrderAgeDays: MAX_ORDER_AGE_DAYS }, "Starting scheduled retry sweep");
  setInterval(() => {
    runStuckOrderRetrySweep().catch(err => {
      logger.error({ err }, "Unhandled error in scheduled retry sweep");
    });
  }, RETRY_INTERVAL_MS);
}
