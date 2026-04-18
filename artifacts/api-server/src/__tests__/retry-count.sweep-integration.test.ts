import { describe, it, expect, beforeAll, afterEach, beforeEach } from "vitest";
import { runStuckOrderRetrySweep } from "../lib/scheduledRetry";
import {
  createOrderFixture,
  cleanupFixture,
  cleanupBotLogsForCustomer,
  ensureSystemSettings,
  stubFetch,
  getOrderRetryCount,
  getOrderStatus,
} from "./helpers";

// Integration test: drives the real sweep against the REAL deliverOrder
// (no module mocks). Binds the sweep + deliverOrder retry-count contract
// end-to-end so a future change that drops the increment from real
// deliverOrder would fail here even if the mocked-sweep tests still pass.
describe("retry_count sweep + real deliverOrder integration", () => {
  beforeAll(async () => {
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

  it("real sweep + real deliverOrder: stuck order with stock => retry_count=1, delivered", async () => {
    const fx = await createOrderFixture({
      status: "needs_manual_action",
      withStock: true,
    });
    fixtures.push(fx);

    await runStuckOrderRetrySweep();

    expect(await getOrderRetryCount(fx.orderId)).toBe(1);
    expect(await getOrderStatus(fx.orderId)).toBe("delivered");
  });
});
