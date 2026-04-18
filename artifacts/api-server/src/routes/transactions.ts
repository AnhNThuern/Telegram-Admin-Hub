import { Router, type IRouter } from "express";
import { eq, and, or, ilike, desc, count } from "drizzle-orm";
import { db, transactionsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { validateParams, validateQuery } from "../middlewares/validate";
import {
  ListTransactionsQueryParams,
  GetTransactionParams,
} from "@workspace/api-zod";
import type z from "zod";

const router: IRouter = Router();

router.get("/transactions", requireAuth, validateQuery(ListTransactionsQueryParams), async (req, res): Promise<void> => {
  const { page, limit, type, status, search } = req.query as unknown as z.infer<typeof ListTransactionsQueryParams>;
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

router.get("/transactions/:id", requireAuth, validateParams(GetTransactionParams), async (req, res): Promise<void> => {
  const { id } = req.params as unknown as z.infer<typeof GetTransactionParams>;
  const [transaction] = await db.select().from(transactionsTable).where(eq(transactionsTable.id, id));
  if (!transaction) {
    res.status(404).json({ error: "Transaction not found" });
    return;
  }
  res.json(transaction);
});

export default router;
