import { Router, type IRouter } from "express";
import type { Request, Response } from "express";
import { db, paymentConfigsTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { requireAuth } from "../middlewares/auth";
import { validateBody } from "../middlewares/validate";
import { SavePaymentConfigBody } from "@workspace/api-zod";
import { desc, eq } from "drizzle-orm";
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
 * We validate this against the stored apiKey to ensure the webhook
 * originates from SePay and not from a forged request.
 */
async function verifySepaySignature(req: Request): Promise<boolean> {
  const config = await getConfig();
  if (!config?.apiKey) {
    // If no API key configured, reject all webhooks for safety
    logger.warn("SePay webhook received but no API key configured — rejecting");
    return false;
  }

  const authHeader = req.headers["authorization"] ?? "";
  // SePay format: "Apikey <your-api-key>"
  const match = /^Apikey\s+(.+)$/i.exec(String(authHeader));
  if (!match) {
    logger.warn("SePay webhook missing or malformed Authorization header");
    return false;
  }

  const providedKey = match[1].trim();
  return providedKey === config.apiKey;
}

// Compute the public URL admins should paste into SePay's webhook settings.
// Falls back to null when REPLIT_DOMAINS isn't set (e.g., local dev outside
// Replit) so the UI can show a helpful message instead of a broken URL.
function getSepayWebhookUrl(): string | null {
  const domain = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
  if (!domain) return null;
  return `https://${domain}/api/payments/sepay/webhook`;
}

router.get("/payments/config", requireAuth, async (_req, res): Promise<void> => {
  const webhookUrl = getSepayWebhookUrl();
  const config = await getConfig();
  if (!config) {
    res.json({ provider: "sepay", isActive: false, webhookUrl });
    return;
  }
  res.json({
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
    updatedAt: config.updatedAt,
  });
});

router.post("/payments/config", requireAuth, validateBody(SavePaymentConfigBody), async (req, res): Promise<void> => {
  const { bankName, bankCode, accountNumber, accountHolder, webhookSecret, apiKey, isActive } = req.body as z.infer<typeof SavePaymentConfigBody>;
  const existing = await getConfig();

  let config;
  if (existing) {
    const updateData: Record<string, unknown> = { isActive: isActive ?? existing.isActive };
    if (bankName !== undefined) updateData.bankName = bankName;
    if (bankCode !== undefined) updateData.bankCode = bankCode;
    if (accountNumber !== undefined) updateData.accountNumber = accountNumber;
    if (accountHolder !== undefined) updateData.accountHolder = accountHolder;
    // Only update secrets if non-masked values are provided
    if (webhookSecret && !webhookSecret.startsWith("****")) updateData.webhookSecret = webhookSecret;
    if (apiKey && !apiKey.startsWith("****")) updateData.apiKey = apiKey;

    const [c] = await db.update(paymentConfigsTable).set(updateData).where(eq(paymentConfigsTable.id, existing.id)).returning();
    config = c;
  } else {
    const [c] = await db.insert(paymentConfigsTable).values({
      provider: "sepay", bankName, bankCode, accountNumber, accountHolder, webhookSecret, apiKey, isActive: isActive ?? false,
    }).returning();
    config = c;
  }

  res.json({
    id: config.id,
    provider: config.provider,
    bankName: config.bankName,
    bankCode: config.bankCode,
    accountNumber: config.accountNumber,
    accountHolder: config.accountHolder,
    webhookSecret: maskSecret(config.webhookSecret),
    apiKey: maskSecret(config.apiKey),
    isActive: config.isActive,
    updatedAt: config.updatedAt,
  });
});

/**
 * SePay webhook endpoint — publicly accessible by SePay servers.
 * Security: requests are authenticated via the `Authorization: Apikey <key>` header.
 * Requests without a valid API key are rejected with 401.
 * Amount is validated against the expected transaction amount before confirming.
 */
router.post("/payments/sepay/webhook", async (req: Request, res: Response): Promise<void> => {
  // Authenticate the webhook request
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
    // Return 200 to prevent retries for malformed payloads; real errors are logged
    res.json({ message: "ok" });
  }
});

export default router;
