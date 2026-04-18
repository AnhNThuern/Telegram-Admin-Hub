import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, botConfigsTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { requireAuth } from "../middlewares/auth";

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

router.post("/bot/config", requireAuth, async (req, res): Promise<void> => {
  const { botToken } = req.body;
  if (!botToken) {
    res.status(400).json({ error: "Bot token is required" });
    return;
  }

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

router.post("/bot/test-token", requireAuth, async (req, res): Promise<void> => {
  const { token } = req.body;
  if (!token) {
    res.status(400).json({ error: "Token is required" });
    return;
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const data = await response.json() as { ok: boolean; result?: { username: string; first_name: string } };
    if (data.ok && data.result) {
      // Save the username to config
      const existing = await getConfig();
      if (existing?.botToken && (existing.botToken === token || maskToken(existing.botToken) === maskToken(token))) {
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

router.post("/bot/set-webhook", requireAuth, async (req, res): Promise<void> => {
  const config = await getConfig();
  if (!config?.botToken) {
    res.status(400).json({ error: "Bot token not configured" });
    return;
  }

  const domains = process.env.REPLIT_DOMAINS?.split(",")[0];
  const webhookUrl = domains ? `https://${domains}/api/bot/webhook` : null;
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
      res.json({ message: "Webhook set successfully" });
    } else {
      res.status(400).json({ error: data.description ?? "Failed to set webhook" });
    }
  } catch (err) {
    logger.error({ err }, "Error setting webhook");
    res.status(500).json({ error: "Failed to set webhook" });
  }
});

router.post("/bot/disconnect", requireAuth, async (req, res): Promise<void> => {
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

// Webhook handler — no auth (called by Telegram)
router.post("/bot/webhook", async (req, res): Promise<void> => {
  try {
    const { handleTelegramUpdate } = await import("../lib/bot");
    await handleTelegramUpdate(req.body);
  } catch (err) {
    logger.error({ err }, "Error handling Telegram update");
  }
  res.json({ message: "ok" });
});

export default router;
