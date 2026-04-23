import { Router, type IRouter } from "express";
import { db, systemSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { validateBody } from "../middlewares/validate";
import { UpdateSystemSettingsBody } from "@workspace/api-zod";
import type { z } from "zod";
import { logger } from "../lib/logger";
import { getOrCreateSystemSettings } from "../lib/systemSettings";

const router: IRouter = Router();

router.get("/admin/system-settings", requireAuth, async (_req, res): Promise<void> => {
  const settings = await getOrCreateSystemSettings();
  res.json({
    maxRetryCount: settings.maxRetryCount,
    maxOrderAgeDays: settings.maxOrderAgeDays,
    stockRequestWindowHours: settings.stockRequestWindowHours,
    updatedAt: settings.updatedAt,
  });
});

router.put("/admin/system-settings", requireAuth, validateBody(UpdateSystemSettingsBody), async (req, res): Promise<void> => {
  const { maxRetryCount, maxOrderAgeDays, stockRequestWindowHours } = req.body as z.infer<typeof UpdateSystemSettingsBody>;
  const existing = await getOrCreateSystemSettings();
  const [updated] = await db.update(systemSettingsTable)
    .set({ maxRetryCount, maxOrderAgeDays, stockRequestWindowHours })
    .where(eq(systemSettingsTable.id, existing.id))
    .returning();
  logger.info({ maxRetryCount, maxOrderAgeDays, stockRequestWindowHours }, "System settings updated");
  res.json({
    maxRetryCount: updated.maxRetryCount,
    maxOrderAgeDays: updated.maxOrderAgeDays,
    stockRequestWindowHours: updated.stockRequestWindowHours,
    updatedAt: updated.updatedAt,
  });
});

export default router;
