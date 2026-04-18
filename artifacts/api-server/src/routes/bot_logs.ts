import { Router, type IRouter } from "express";
import { eq, and, or, ilike, desc, count } from "drizzle-orm";
import { db, botLogsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

router.get("/bot-logs", requireAuth, async (req, res): Promise<void> => {
  const page = parseInt(String(req.query.page ?? "1"), 10);
  const limit = parseInt(String(req.query.limit ?? "50"), 10);
  const search = req.query.search as string | undefined;
  const action = req.query.action as string | undefined;
  const level = req.query.level as string | undefined;
  const offset = (page - 1) * limit;

  const conditions = [];
  if (action) conditions.push(eq(botLogsTable.action, action));
  if (level) conditions.push(eq(botLogsTable.level, level));
  if (search) {
    conditions.push(
      or(
        ilike(botLogsTable.content, `%${search}%`),
        ilike(botLogsTable.chatId, `%${search}%`),
      )!
    );
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [totalRow] = await db.select({ count: count() }).from(botLogsTable).where(where);
  const data = await db.select().from(botLogsTable).where(where).orderBy(desc(botLogsTable.createdAt)).limit(limit).offset(offset);

  res.json({ data, total: totalRow?.count ?? 0, page, limit });
});

export default router;
