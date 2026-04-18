import { Router, type IRouter } from "express";
import { db, paymentConfigsTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { requireAuth } from "../middlewares/auth";
import { desc, eq } from "drizzle-orm";

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

router.get("/payments/config", requireAuth, async (_req, res): Promise<void> => {
  const config = await getConfig();
  if (!config) {
    res.json({ provider: "sepay", isActive: false });
    return;
  }
  res.json({
    id: config.id,
    provider: config.provider,
    bankName: config.bankName,
    accountNumber: config.accountNumber,
    accountHolder: config.accountHolder,
    webhookSecret: maskSecret(config.webhookSecret),
    apiKey: maskSecret(config.apiKey),
    isActive: config.isActive,
    updatedAt: config.updatedAt,
  });
});

router.post("/payments/config", requireAuth, async (req, res): Promise<void> => {
  const { bankName, accountNumber, accountHolder, webhookSecret, apiKey, isActive } = req.body;
  const existing = await getConfig();

  let config;
  if (existing) {
    const updateData: Record<string, unknown> = { isActive: isActive ?? existing.isActive };
    if (bankName !== undefined) updateData.bankName = bankName;
    if (accountNumber !== undefined) updateData.accountNumber = accountNumber;
    if (accountHolder !== undefined) updateData.accountHolder = accountHolder;
    // Only update secrets if non-masked values provided
    if (webhookSecret && !webhookSecret.startsWith("****")) updateData.webhookSecret = webhookSecret;
    if (apiKey && !apiKey.startsWith("****")) updateData.apiKey = apiKey;

    const [c] = await db.update(paymentConfigsTable).set(updateData).where(eq(paymentConfigsTable.id, existing.id)).returning();
    config = c;
  } else {
    const [c] = await db.insert(paymentConfigsTable).values({
      provider: "sepay", bankName, accountNumber, accountHolder, webhookSecret, apiKey, isActive: isActive ?? false,
    }).returning();
    config = c;
  }

  res.json({
    id: config.id,
    provider: config.provider,
    bankName: config.bankName,
    accountNumber: config.accountNumber,
    accountHolder: config.accountHolder,
    webhookSecret: maskSecret(config.webhookSecret),
    apiKey: maskSecret(config.apiKey),
    isActive: config.isActive,
    updatedAt: config.updatedAt,
  });
});

// SePay webhook — no auth (called by SePay)
router.post("/payments/sepay/webhook", async (req, res): Promise<void> => {
  try {
    const { handleSepayWebhook } = await import("../lib/payments");
    await handleSepayWebhook(req.body);
    res.json({ message: "ok" });
  } catch (err) {
    logger.error({ err }, "Error handling SePay webhook");
    res.json({ message: "ok" }); // Return 200 to prevent retries
  }
});

export default router;
