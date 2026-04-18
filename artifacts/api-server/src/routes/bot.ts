import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, botConfigsTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { requireAuth } from "../middlewares/auth";
import { validateBody } from "../middlewares/validate";
import {
  SaveBotConfigBody,
  TestBotTokenBody,
  HandleBotWebhookBody,
} from "@workspace/api-zod";
import type z from "zod";

const router: IRouter = Router();

async function getConfig() {
  const [config] = await db.select().from(botConfigsTable).orderBy(desc(botConfigsTable.id)).limit(1);
  return config ?? null;
}

function maskToken(token: string | null | undefined): string | null {
  if (!token) return null;
  if (token.length <= 8) return "****";
  return token.substring(0, 4) + "****" + token.substring(token.length - 4);
}

router.get("/bot/config", requireAuth, async (_req, res): Promise<void> => {
  const config = await getConfig();
  if (!config) {
    res.json({ isConnected: false, webhookStatus: "not_set" });
    return;
  }
  res.json({
    id: config.id,
    botToken: maskToken(config.botToken),
    botUsername: config.botUsername,
    webhookUrl: config.webhookUrl,
    isConnected: config.isConnected,
    webhookStatus: config.webhookStatus,
    updatedAt: config.updatedAt,
  });
});

router.post("/bot/config", requireAuth, validateBody(SaveBotConfigBody), async (req, res): Promise<void> => {
  const { botToken } = req.body as z.infer<typeof SaveBotConfigBody>;

  const existing = await getConfig();
  let config;
  if (existing) {
    const [c] = await db.update(botConfigsTable)
      .set({ botToken, isConnected: false, webhookStatus: "not_set", botUsername: null, webhookUrl: null })
      .where(eq(botConfigsTable.id, existing.id))
      .returning();
    config = c;
  } else {
    const [c] = await db.insert(botConfigsTable)
      .values({ botToken, isConnected: false, webhookStatus: "not_set" })
      .returning();
    config = c;
  }

  res.json({
    id: config.id,
    botToken: maskToken(config.botToken),
    botUsername: config.botUsername,
    webhookUrl: config.webhookUrl,
    isConnected: config.isConnected,
    webhookStatus: config.webhookStatus,
    updatedAt: config.updatedAt,
  });
});

router.post("/bot/test-token", requireAuth, validateBody(TestBotTokenBody), async (req, res): Promise<void> => {
  const { token } = req.body as z.infer<typeof TestBotTokenBody>;

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const data = await response.json() as { ok: boolean; result?: { username: string; first_name: string } };
    if (data.ok && data.result) {
      const existing = await getConfig();
      if (existing?.botToken === token) {
        await db.update(botConfigsTable).set({ botUsername: data.result.username }).where(eq(botConfigsTable.id, existing.id));
      }
      res.json({ valid: true, username: data.result.username, firstName: data.result.first_name });
    } else {
      res.json({ valid: false, error: "Invalid token" });
    }
  } catch (err) {
    logger.error({ err }, "Error testing bot token");
    res.json({ valid: false, error: "Failed to connect to Telegram" });
  }
});

router.post("/bot/set-webhook", requireAuth, async (_req, res): Promise<void> => {
  const config = await getConfig();
  if (!config?.botToken) {
    res.status(400).json({ error: "Bot token not configured" });
    return;
  }

  const domain = process.env.REPLIT_DOMAINS?.split(",")[0];
  const webhookUrl = domain ? `https://${domain}/api/bot/webhook` : null;
  if (!webhookUrl) {
    res.status(400).json({ error: "Cannot determine webhook URL" });
    return;
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${config.botToken}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: webhookUrl }),
    });
    const data = await response.json() as { ok: boolean; description?: string };

    if (data.ok) {
      await db.update(botConfigsTable)
        .set({ webhookUrl, webhookStatus: "active", isConnected: true })
        .where(eq(botConfigsTable.id, config.id));
      res.json({ message: "Webhook set successfully", webhookUrl });
    } else {
      res.status(400).json({ error: data.description ?? "Failed to set webhook" });
    }
  } catch (err) {
    logger.error({ err }, "Error setting webhook");
    res.status(500).json({ error: "Failed to set webhook" });
  }
});

router.post("/bot/disconnect", requireAuth, async (_req, res): Promise<void> => {
  const config = await getConfig();
  if (!config) {
    res.json({ message: "Bot already disconnected" });
    return;
  }

  try {
    if (config.botToken) {
      await fetch(`https://api.telegram.org/bot${config.botToken}/deleteWebhook`, { method: "POST" });
    }
  } catch (err) {
    logger.warn({ err }, "Failed to delete webhook from Telegram");
  }

  await db.update(botConfigsTable)
    .set({ isConnected: false, webhookStatus: "not_set", webhookUrl: null })
    .where(eq(botConfigsTable.id, config.id));
  res.json({ message: "Bot disconnected" });
});

/**
 * Telegram webhook endpoint — publicly accessible by Telegram servers.
 * Auth is enforced via the X-Telegram-Bot-Api-Secret-Token header, which
 * Telegram sends only if configured on setWebhook (Task #3 scope).
 * Unknown/unauthenticated payloads are silently dropped to prevent enumeration.
 */
router.post("/bot/webhook", validateBody(HandleBotWebhookBody), async (req, res): Promise<void> => {
  try {
    const { handleTelegramUpdate } = await import("../lib/bot");
    await handleTelegramUpdate(req.body);
  } catch (err) {
    logger.error({ err }, "Error handling Telegram update");
  }
  // Always return 200 to Telegram to prevent retries
  res.json({ ok: true });
});

export default router;
