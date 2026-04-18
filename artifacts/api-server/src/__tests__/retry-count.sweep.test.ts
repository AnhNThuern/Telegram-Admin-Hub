import { describe, it, expect, beforeAll, afterEach, beforeEach, vi } from "vitest";
import { db, ordersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import {
  createOrderFixture,
  cleanupFixture,
  cleanupBotLogsForCustomer,
  ensureSystemSettings,
  stubFetch,
  getOrderRetryCount,
  getOrderStatus,
} from "./helpers";

// Replace bot.deliverOrder so we can deterministically exercise the
// success / failure / exception branches of the sweep without depending on
// stock state, Telegram, or other side effects of the real deliverOrder.
// The mock mimics deliverOrder's contract: when isRetry=true, it MUST
// increment ordersTable.retryCount by exactly 1 before returning OR throwing.
const deliverBehavior: { mode: "success" | "failure" | "throw" } = { mode: "success" };

vi.mock("../lib/bot", async () => {
  const actual = await vi.importActual<typeof import("../lib/bot")>("../lib/bot");
  return {
    ...actual,
    deliverOrder: vi.fn(async (orderId: number, opts?: { isRetry?: boolean }) => {
      if (opts?.isRetry) {
        await db
          .update(ordersTable)
          .set({ retryCount: sql`${ordersTable.retryCount} + 1` })
          .where(eq(ordersTable.id, orderId));
      }
      if (deliverBehavior.mode === "throw") {
        throw new Error("simulated deliverOrder failure");
      }
      if (deliverBehavior.mode === "failure") {
        // Real deliverOrder resets status back to needs_manual_action when
        // it can't fulfil; mirror that so the sweep's post-conditions match.
        await db
          .update(ordersTable)
          .set({ status: "needs_manual_action" })
          .where(eq(ordersTable.id, orderId));
        return false;
      }
      // success
      await db
        .update(ordersTable)
        .set({ status: "delivered" })
        .where(eq(ordersTable.id, orderId));
      return true;
    }),
    sendAdminAlert: vi.fn(async () => {}),
    sendMessageToCustomer: vi.fn(async () => {}),
    sendAdminNotification: vi.fn(async () => {}),
  };
});

// Import AFTER vi.mock so the sweep picks up the mocked deliverOrder.
const { runStuckOrderRetrySweep } = await import("../lib/scheduledRetry");

describe("retry_count behavior in scheduled retry sweep", () => {
  beforeAll(async () => {
    // High retry limit + long age window so the test order is never
    // pre-emptively marked retry_exhausted.
    await ensureSystemSettings(100, 365);
  });

  beforeEach(() => {
    stubFetch();
  });

  const fixtures: Awaited<ReturnType<typeof createOrderFixture>>[] = [];
  afterEach(async () => {
    while (fixtures.length) {
      const fx = fixtures.pop()!;
      await cleanupBotLogsForCustomer(fx.customerId);
      await cleanupFixture(fx);
    }
  });

  it("success path: retry_count goes up by exactly 1", async () => {
    deliverBehavior.mode = "success";
    const fx = await createOrderFixture({ status: "needs_manual_action" });
    fixtures.push(fx);

    await runStuckOrderRetrySweep();

    expect(await getOrderRetryCount(fx.orderId)).toBe(1);
    expect(await getOrderStatus(fx.orderId)).toBe("delivered");
  });

  it("failure path: retry_count goes up by exactly 1", async () => {
    deliverBehavior.mode = "failure";
    const fx = await createOrderFixture({ status: "needs_manual_action" });
    fixtures.push(fx);

    await runStuckOrderRetrySweep();

    expect(await getOrderRetryCount(fx.orderId)).toBe(1);
    expect(await getOrderStatus(fx.orderId)).toBe("needs_manual_action");
  });

  it("exception path: retry_count goes up by exactly 1 and status is restored", async () => {
    deliverBehavior.mode = "throw";
    const fx = await createOrderFixture({ status: "needs_manual_action" });
    fixtures.push(fx);

    await runStuckOrderRetrySweep();

    expect(await getOrderRetryCount(fx.orderId)).toBe(1);
    // Sweep's catch block restores the previous stuck status.
    expect(await getOrderStatus(fx.orderId)).toBe("needs_manual_action");
  });
});
