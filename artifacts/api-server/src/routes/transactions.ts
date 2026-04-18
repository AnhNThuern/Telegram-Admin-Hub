import { Router, type IRouter } from "express";
import { eq, and, or, ilike, desc, count } from "drizzle-orm";
import { db, transactionsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

router.get("/transactions", requireAuth, async (req, res): Promise<void> => {
  const page = parseInt(String(req.query.page ?? "1"), 10);
  const limit = parseInt(String(req.query.limit ?? "20"), 10);
  const type = req.query.type as string | undefined;
  const status = req.query.status as string | undefined;
  const search = req.query.search as string | undefined;
  const offset = (page - 1) * limit;

  const conditions = [];
  if (type) conditions.push(eq(transactionsTable.type, type));
  if (status) conditions.push(eq(transactionsTable.status, status));
  if (search) {
    conditions.push(
      or(
        ilike(transactionsTable.transactionCode, `%${search}%`),
        ilike(transactionsTable.paymentReference, `%${search}%`)
      )!
    );
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [totalRow] = await db.select({ count: count() }).from(transactionsTable).where(where);
  const data = await db.select().from(transactionsTable).where(where).orderBy(desc(transactionsTable.createdAt)).limit(limit).offset(offset);

  res.json({ data, total: totalRow?.count ?? 0, page, limit });
});

router.get("/transactions/:id", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const [transaction] = await db.select().from(transactionsTable).where(eq(transactionsTable.id, id));
  if (!transaction) {
    res.status(404).json({ error: "Transaction not found" });
    return;
  }
  res.json(transaction);
});

export default router;
