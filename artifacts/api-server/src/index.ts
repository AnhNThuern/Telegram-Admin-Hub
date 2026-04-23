import app from "./app";
import { logger } from "./lib/logger";
import { seed } from "./lib/seed";
import { seedDefaultStrings } from "./lib/i18n";
import { startScheduledRetrySweep } from "./lib/scheduledRetry";
import { startPendingOrderExpirySweep } from "./lib/pendingOrderExpiry";
import { registerBotCommands } from "./routes/bot";
import { db, botConfigsTable } from "@workspace/db";
import { desc } from "drizzle-orm";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, async (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Auto-seed on startup
  try {
    await seed();
  } catch (seedErr) {
    logger.error({ err: seedErr }, "Failed to seed database");
  }

  // Seed i18n default strings (idempotent — safe to run every startup)
  try {
    await seedDefaultStrings();
  } catch (i18nErr) {
    logger.error({ err: i18nErr }, "Failed to seed i18n strings");
  }

  startScheduledRetrySweep();
  startPendingOrderExpirySweep();

  // Register bot commands with Telegram on startup (idempotent — safe every restart)
  try {
    const [config] = await db.select({ botToken: botConfigsTable.botToken, isConnected: botConfigsTable.isConnected })
      .from(botConfigsTable)
      .orderBy(desc(botConfigsTable.id))
      .limit(1);
    if (config?.botToken && config.isConnected) {
      await registerBotCommands(config.botToken);
      logger.info("Bot commands registered with Telegram");
    }
  } catch (cmdErr) {
    logger.warn({ err: cmdErr }, "Failed to register bot commands on startup (non-fatal)");
  }
});
