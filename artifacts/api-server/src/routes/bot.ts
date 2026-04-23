import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { randomBytes } from "crypto";
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

const BOT_COMMANDS_VI = [
  { command: "start",    description: "Mở menu chính" },
  { command: "naptien",  description: "Nạp tiền vào ví" },
  { command: "lichsu",   description: "Lịch sử giao dịch ví" },
  { command: "cancel",   description: "Hủy đơn đang chờ thanh toán" },
  { command: "language", description: "Đổi ngôn ngữ / Change language" },
];

const BOT_COMMANDS_EN = [
  { command: "start",    description: "Open main menu" },
  { command: "naptien",  description: "Top up wallet" },
  { command: "lichsu",   description: "Wallet transaction history" },
  { command: "cancel",   description: "Cancel pending order" },
  { command: "language", description: "Change language / Đổi ngôn ngữ" },
];

/**
 * Register bot commands with Telegram so they appear in the "/" autocomplete
 * menu. Called after a successful setWebhook and on server startup.
 * Registers both the default (Vietnamese) list and the English-locale list.
 */
export async function registerBotCommands(botToken: string): Promise<void> {
  const base = `https://api.telegram.org/bot${botToken}/setMyCommands`;

  const calls = [
    fetch(base, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commands: BOT_COMMANDS_VI }),
    }),
    fetch(base, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commands: BOT_COMMANDS_EN, language_code: "en" }),
    }),
  ];

  const results = await Promise.allSettled(calls);
  const errors: string[] = [];
  for (const result of results) {
    if (result.status === "rejected") {
      logger.warn({ err: result.reason }, "setMyCommands call failed");
      errors.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
    } else {
      const data = await result.value.json() as { ok: boolean; description?: string };
      if (!data.ok) {
        logger.warn({ description: data.description }, "setMyCommands returned not-ok");
        errors.push(data.description ?? "Telegram returned not-ok");
      }
    }
  }
  if (errors.length > 0) {
    throw new Error(errors.join("; "));
  }
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
    adminChatId: config.adminChatId,
    warrantyText: config.warrantyText,
    supportText: config.supportText,
    infoText: config.infoText,
    shopName: config.shopName,
    welcomeMessage: config.welcomeMessage,
    updatedAt: config.updatedAt,
  });
});

router.post("/bot/config", requireAuth, validateBody(SaveBotConfigBody), async (req, res): Promise<void> => {
  const { botToken, adminChatId, warrantyText, supportText, infoText, shopName, welcomeMessage } = req.body as z.infer<typeof SaveBotConfigBody>;

  const existing = await getConfig();
  let config;

  // Detect masked token (returned by GET /bot/config) — if unchanged, skip token update and preserve connection state
  const isMaskedToken = botToken?.includes("****") ?? false;
  const tokenChanged = !isMaskedToken;

  if (existing) {
    const updateData: Record<string, unknown> = {};
    if (tokenChanged) {
      // New real token provided: update token and reset bot connection
      updateData.botToken = botToken;
      updateData.isConnected = false;
      updateData.webhookStatus = "not_set";
      updateData.botUsername = null;
      updateData.webhookUrl = null;
      updateData.webhookSecretToken = null;
    }
    if (adminChatId !== undefined) updateData.adminChatId = adminChatId;
    if (warrantyText !== undefined) updateData.warrantyText = warrantyText;
    if (supportText !== undefined) updateData.supportText = supportText;
    if (infoText !== undefined) updateData.infoText = infoText;
    if (shopName !== undefined) updateData.shopName = shopName;
    if (welcomeMessage !== undefined) updateData.welcomeMessage = welcomeMessage;

    if (Object.keys(updateData).length === 0) {
      // Nothing to change — return existing config without a DB write
      config = existing;
    } else {
      const [c] = await db.update(botConfigsTable)
        .set(updateData)
        .where(eq(botConfigsTable.id, existing.id))
        .returning();
      config = c;
    }
  } else {
    const [c] = await db.insert(botConfigsTable)
      .values({
        botToken: isMaskedToken ? null : botToken,
        isConnected: false,
        webhookStatus: "not_set",
        adminChatId: adminChatId ?? null,
        warrantyText: warrantyText ?? null,
        supportText: supportText ?? null,
        infoText: infoText ?? null,
        shopName: shopName ?? null,
        welcomeMessage: welcomeMessage ?? null,
      })
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
    adminChatId: config.adminChatId,
    shopName: config.shopName,
    welcomeMessage: config.welcomeMessage,
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

  // Generate a new random secret token for Telegram webhook verification
  const secretToken = randomBytes(32).toString("hex");

  try {
    const response = await fetch(`https://api.telegram.org/bot${config.botToken}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: webhookUrl, secret_token: secretToken }),
    });
    const data = await response.json() as { ok: boolean; description?: string };

    if (data.ok) {
      await db.update(botConfigsTable)
        .set({ webhookUrl, webhookStatus: "active", isConnected: true, webhookSecretToken: secretToken })
        .where(eq(botConfigsTable.id, config.id));

      // Register bot commands in the background — non-critical, don't block the response
      registerBotCommands(config.botToken).catch(err =>
        logger.warn({ err }, "registerBotCommands failed after setWebhook")
      );

      res.json({ message: "Webhook set successfully", webhookUrl });
    } else {
      res.status(400).json({ error: data.description ?? "Failed to set webhook" });
    }
  } catch (err) {
    logger.error({ err }, "Error setting webhook");
    res.status(500).json({ error: "Failed to set webhook" });
  }
});

router.post("/bot/register-commands", requireAuth, async (_req, res): Promise<void> => {
  const config = await getConfig();
  if (!config?.botToken) {
    res.status(400).json({ error: "Bot chưa được cấu hình" });
    return;
  }
  if (!config.isConnected) {
    res.status(400).json({ error: "Bot chưa kết nối" });
    return;
  }
  try {
    await registerBotCommands(config.botToken);
    res.json({ message: "Đã cập nhật lệnh bot thành công" });
  } catch (err) {
    logger.error({ err }, "registerBotCommands failed via admin endpoint");
    res.status(500).json({ error: "Cập nhật lệnh bot thất bại" });
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
    .set({ isConnected: false, webhookStatus: "not_set", webhookUrl: null, webhookSecretToken: null })
    .where(eq(botConfigsTable.id, config.id));
  res.json({ message: "Bot disconnected" });
});

/**
 * Telegram webhook endpoint — publicly accessible by Telegram servers only.
 * Security: Telegram sends X-Telegram-Bot-Api-Secret-Token on every request.
 * We verify this against the stored webhookSecretToken generated during setWebhook.
 * Requests without a valid secret are rejected with 401.
 */
router.post("/bot/webhook", validateBody(HandleBotWebhookBody), async (req, res): Promise<void> => {
  // Verify the request originated from Telegram using the shared secret token
  const providedSecret = req.headers["x-telegram-bot-api-secret-token"];
  const config = await getConfig();

  if (!config?.webhookSecretToken || !providedSecret || providedSecret !== config.webhookSecretToken) {
    logger.warn({ ip: req.ip }, "Rejected unauthenticated Telegram webhook request");
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const { handleTelegramUpdate } = await import("../lib/bot");
    await handleTelegramUpdate(req.body);
  } catch (err) {
    logger.error({ err }, "Error handling Telegram update");
  }
  // Always return 200 to Telegram to prevent retries
  res.json({ message: "ok" });
});

export default router;
