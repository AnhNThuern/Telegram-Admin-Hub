import { Router, type IRouter } from "express";
import { db, i18nStringsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { invalidateI18nCache } from "../lib/i18n";
import { z } from "zod";

const router: IRouter = Router();

router.get("/i18n/strings", requireAuth, async (_req, res): Promise<void> => {
  const rows = await db.select().from(i18nStringsTable).orderBy(i18nStringsTable.key);
  res.json({ data: rows });
});

const UpdateI18nStringBody = z.object({
  vi: z.string().optional(),
  en: z.string().optional(),
});

router.patch("/i18n/strings/:key", requireAuth, async (req, res): Promise<void> => {
  const key = String(req.params["key"]);
  const parseResult = UpdateI18nStringBody.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: "Invalid body", issues: parseResult.error.issues });
    return;
  }
  const { vi, en } = parseResult.data;
  const updates: Record<string, string> = {};
  if (vi !== undefined) updates["vi"] = vi;
  if (en !== undefined) updates["en"] = en;

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  const [updated] = await db
    .update(i18nStringsTable)
    .set(updates)
    .where(eq(i18nStringsTable.key, key))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "String key not found" });
    return;
  }

  invalidateI18nCache();
  res.json(updated);
});

router.patch("/i18n/strings", requireAuth, async (req, res): Promise<void> => {
  const BulkBody = z.object({
    updates: z.array(z.object({
      key: z.string(),
      vi: z.string().optional(),
      en: z.string().optional(),
    })),
  });

  const parseResult = BulkBody.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: "Invalid body", issues: parseResult.error.issues });
    return;
  }

  const { updates } = parseResult.data;
  const results = [];
  for (const u of updates) {
    const fields: Record<string, string> = {};
    if (u.vi !== undefined) fields["vi"] = u.vi;
    if (u.en !== undefined) fields["en"] = u.en;
    if (Object.keys(fields).length === 0) continue;

    const [updated] = await db
      .update(i18nStringsTable)
      .set(fields)
      .where(eq(i18nStringsTable.key, u.key))
      .returning();
    if (updated) results.push(updated);
  }

  invalidateI18nCache();
  res.json({ updated: results.length, data: results });
});

export default router;
