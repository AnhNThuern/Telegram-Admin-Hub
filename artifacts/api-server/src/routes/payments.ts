import { Router, type IRouter } from "express";
import type { Request, Response } from "express";
import { db, paymentConfigsTable, transactionsTable, ordersTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { requireAuth } from "../middlewares/auth";
import { validateBody } from "../middlewares/validate";
import { SavePaymentConfigBody } from "@workspace/api-zod";
import { desc, eq, and } from "drizzle-orm";
import type z from "zod";

const router: IRouter = Router();

function maskSecret(s: string | null | undefined): string | null {
  if (!s) return null;
  if (s.length <= 4) return "****";
  return "****" + s.substring(s.length - 4);
}

async function getConfig() {
  const [config] = await db.select().from(paymentConfigsTable).orderBy(desc(paymentConfigsTable.id)).limit(1);
  return config ?? null;
}

/**
 * Verify SePay webhook authenticity.
 * SePay sends the API key via `Authorization: Apikey <key>` header.
 */
async function verifySepaySignature(req: Request): Promise<boolean> {
  const config = await getConfig();
  if (!config?.apiKey) {
    logger.warn("SePay webhook received but no API key configured — rejecting");
    return false;
  }

  const authHeader = req.headers["authorization"] ?? "";
  const match = /^Apikey\s+(.+)$/i.exec(String(authHeader));
  if (!match) {
    logger.warn("SePay webhook missing or malformed Authorization header");
    return false;
  }

  const providedKey = match[1].trim();
  return providedKey === config.apiKey;
}

function getSepayWebhookUrl(): string | null {
  const domain = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
  if (!domain) return null;
  return `https://${domain}/api/payments/sepay/webhook`;
}

function getBinanceWebhookUrl(): string | null {
  const domain = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
  if (!domain) return null;
  return `https://${domain}/api/payments/binance/webhook`;
}

function buildConfigResponse(config: Awaited<ReturnType<typeof getConfig>>, webhookUrl: string | null) {
  if (!config) return { provider: "sepay", isActive: false, webhookUrl, binanceIsActive: false };
  return {
    id: config.id,
    provider: config.provider,
    bankName: config.bankName,
    bankCode: config.bankCode,
    accountNumber: config.accountNumber,
    accountHolder: config.accountHolder,
    webhookSecret: maskSecret(config.webhookSecret),
    apiKey: maskSecret(config.apiKey),
    webhookUrl,
    isActive: config.isActive,
    binanceApiKey: maskSecret(config.binanceApiKey),
    binanceApiSecret: config.binanceApiSecret ? "****" : null,
    binanceMerchantTradeNoPrefix: config.binanceMerchantTradeNoPrefix,
    binanceIsActive: config.binanceIsActive,
    binanceWebhookUrl: getBinanceWebhookUrl(),
    updatedAt: config.updatedAt,
  };
}

router.get("/payments/config", requireAuth, async (_req, res): Promise<void> => {
  const webhookUrl = getSepayWebhookUrl();
  const config = await getConfig();
  res.json(buildConfigResponse(config, webhookUrl));
});

router.post("/payments/config", requireAuth, validateBody(SavePaymentConfigBody), async (req, res): Promise<void> => {
  const body = req.body as z.infer<typeof SavePaymentConfigBody>;
  const {
    bankName, bankCode, accountNumber, accountHolder, webhookSecret, apiKey, isActive,
    binanceApiKey, binanceApiSecret, binanceMerchantTradeNoPrefix, binanceIsActive,
  } = body as typeof body & {
    binanceApiKey?: string;
    binanceApiSecret?: string;
    binanceMerchantTradeNoPrefix?: string;
    binanceIsActive?: boolean;
  };

  const existing = await getConfig();

  let config;
  if (existing) {
    const updateData: Record<string, unknown> = {};
    if (isActive !== undefined) updateData.isActive = isActive;
    if (bankName !== undefined) updateData.bankName = bankName;
    if (bankCode !== undefined) updateData.bankCode = bankCode;
    if (accountNumber !== undefined) updateData.accountNumber = accountNumber;
    if (accountHolder !== undefined) updateData.accountHolder = accountHolder;
    if (webhookSecret && !webhookSecret.startsWith("****")) updateData.webhookSecret = webhookSecret;
    if (apiKey && !apiKey.startsWith("****")) updateData.apiKey = apiKey;

    if (binanceIsActive !== undefined) updateData.binanceIsActive = binanceIsActive;
    if (binanceMerchantTradeNoPrefix !== undefined) updateData.binanceMerchantTradeNoPrefix = binanceMerchantTradeNoPrefix;
    if (binanceApiKey && !binanceApiKey.startsWith("****")) updateData.binanceApiKey = binanceApiKey;
    if (binanceApiSecret && !binanceApiSecret.startsWith("****")) updateData.binanceApiSecret = binanceApiSecret;

    const [c] = await db.update(paymentConfigsTable).set(updateData).where(eq(paymentConfigsTable.id, existing.id)).returning();
    config = c;
  } else {
    const [c] = await db.insert(paymentConfigsTable).values({
      provider: "sepay",
      bankName, bankCode, accountNumber, accountHolder, webhookSecret, apiKey,
      isActive: isActive ?? false,
      binanceApiKey: binanceApiKey && !binanceApiKey.startsWith("****") ? binanceApiKey : undefined,
      binanceApiSecret: binanceApiSecret && !binanceApiSecret.startsWith("****") ? binanceApiSecret : undefined,
      binanceMerchantTradeNoPrefix: binanceMerchantTradeNoPrefix ?? "SHOP",
      binanceIsActive: binanceIsActive ?? false,
    }).returning();
    config = c;
  }

  const webhookUrl = getSepayWebhookUrl();
  res.json(buildConfigResponse(config, webhookUrl));
});

/**
 * Test Binance Pay credentials by attempting to create a minimal order.
 */
router.post("/payments/binance/test-connection", requireAuth, async (_req, res): Promise<void> => {
  const config = await getConfig();
  if (!config?.binanceApiKey || !config?.binanceApiSecret) {
    res.json({ success: false, error: "Chưa cấu hình API Key / API Secret Binance Pay." });
    return;
  }
  try {
    const { testBinancePayConnection } = await import("../lib/binance-pay");
    const result = await testBinancePayConnection(config.binanceApiKey, config.binanceApiSecret);
    res.json(result);
  } catch (err) {
    res.json({ success: false, error: (err as Error).message });
  }
});

/**
 * SePay webhook — publicly accessible.
 */
router.post("/payments/sepay/webhook", async (req: Request, res: Response): Promise<void> => {
  const isValid = await verifySepaySignature(req);
  if (!isValid) {
    logger.warn({ ip: req.ip }, "Rejected unauthenticated SePay webhook request");
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const { handleSepayWebhook } = await import("../lib/payments");
    await handleSepayWebhook(req.body);
    res.json({ message: "ok" });
  } catch (err) {
    logger.error({ err }, "Error handling SePay webhook");
    res.json({ message: "ok" });
  }
});

/**
 * Binance Pay webhook — publicly accessible.
 * Binance signs the request with RSA; we verify before processing.
 */
router.post("/payments/binance/webhook", async (req: Request, res: Response): Promise<void> => {
  const BINANCE_SUCCESS = { returnCode: "SUCCESS", returnMessage: null };

  try {
    const rawBody = JSON.stringify(req.body);

    const { verifyBinanceWebhookSignature } = await import("../lib/binance-pay");
    const isValid = await verifyBinanceWebhookSignature(
      req.headers as Record<string, string | string[] | undefined>,
      rawBody,
    );

    if (!isValid) {
      logger.warn({ ip: req.ip }, "Rejected Binance Pay webhook — invalid signature");
      res.status(400).json({ returnCode: "FAIL", returnMessage: "Invalid signature" });
      return;
    }

    const payload = req.body as {
      bizType?: string;
      bizStatus?: string;
      bizIdStr?: string;
      data?: string;
    };

    if (payload.bizStatus !== "PAY_SUCCESS") {
      logger.info({ bizStatus: payload.bizStatus }, "Binance webhook: non-success status, ignoring");
      res.json(BINANCE_SUCCESS);
      return;
    }

    let orderData: { merchantTradeNo?: string; prepayId?: string } = {};
    try {
      if (payload.data) orderData = JSON.parse(payload.data);
    } catch {
      logger.warn({ data: payload.data }, "Failed to parse Binance webhook data field");
    }

    const { merchantTradeNo, prepayId } = orderData;
    if (!merchantTradeNo && !prepayId) {
      logger.warn({ payload }, "Binance webhook: missing merchantTradeNo and prepayId");
      res.json(BINANCE_SUCCESS);
      return;
    }

    // Find the pending transaction — match by binancePrepayId or paymentReference
    const [transaction] = await db
      .select()
      .from(transactionsTable)
      .where(
        prepayId
          ? eq(transactionsTable.binancePrepayId, prepayId)
          : eq(transactionsTable.paymentReference, merchantTradeNo!),
      );

    if (!transaction) {
      logger.warn({ merchantTradeNo, prepayId }, "Binance webhook: no matching transaction found");
      res.json(BINANCE_SUCCESS);
      return;
    }

    // Atomic confirm — only act if still pending
    const [confirmed] = await db.update(transactionsTable).set({
      status: "confirmed",
      confirmedAt: new Date(),
      rawPayload: rawBody,
    }).where(and(
      eq(transactionsTable.id, transaction.id),
      eq(transactionsTable.status, "pending"),
    )).returning({ id: transactionsTable.id });

    if (!confirmed) {
      logger.info({ transactionId: transaction.id }, "Binance webhook already processed — skipping");
      res.json(BINANCE_SUCCESS);
      return;
    }

    logger.info({ merchantTradeNo, prepayId, orderId: transaction.orderId }, "Binance Pay payment confirmed");

    if (transaction.orderId) {
      const [currentOrder] = await db.select({ id: ordersTable.id, status: ordersTable.status })
        .from(ordersTable).where(eq(ordersTable.id, transaction.orderId));

      const terminalStatuses = ["paid", "delivered", "retry_exhausted"];
      if (currentOrder && !terminalStatuses.includes(currentOrder.status)) {
        await db.update(ordersTable).set({ status: "paid", paidAt: new Date() })
          .where(eq(ordersTable.id, transaction.orderId));
        try {
          const { deliverOrder } = await import("../lib/bot");
          await deliverOrder(transaction.orderId);
        } catch (err) {
          logger.error({ err, orderId: transaction.orderId }, "Auto delivery failed after Binance payment");
        }
      }
    }

    res.json(BINANCE_SUCCESS);
  } catch (err) {
    logger.error({ err }, "Error handling Binance Pay webhook");
    res.json({ returnCode: "SUCCESS", returnMessage: null });
  }
});

export default router;
