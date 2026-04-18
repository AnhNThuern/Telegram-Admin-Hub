import { Router, type IRouter } from "express";
import { eq, or, ilike, desc, count, sql } from "drizzle-orm";
import { db, customersTable, ordersTable, transactionsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

router.get("/customers", requireAuth, async (req, res): Promise<void> => {
  const page = parseInt(String(req.query.page ?? "1"), 10);
  const limit = parseInt(String(req.query.limit ?? "20"), 10);
  const search = req.query.search as string | undefined;
  const offset = (page - 1) * limit;

  let where = undefined;
  if (search) {
    where = or(
      ilike(customersTable.chatId, `%${search}%`),
      ilike(customersTable.username, `%${search}%`),
      ilike(customersTable.firstName, `%${search}%`),
    );
  }

  const [totalRow] = await db.select({ count: count() }).from(customersTable).where(where);
  const data = await db.select().from(customersTable).where(where).orderBy(desc(customersTable.createdAt)).limit(limit).offset(offset);

  res.json({ data, total: totalRow?.count ?? 0, page, limit });
});

router.get("/customers/:id", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, id));
  if (!customer) {
    res.status(404).json({ error: "Customer not found" });
    return;
  }
  res.json(customer);
});

router.get("/customers/:id/orders", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const page = parseInt(String(req.query.page ?? "1"), 10);
  const limit = parseInt(String(req.query.limit ?? "20"), 10);
  const offset = (page - 1) * limit;

  const [totalRow] = await db.select({ count: count() }).from(ordersTable).where(eq(ordersTable.customerId, id));
  const data = await db.select().from(ordersTable).where(eq(ordersTable.customerId, id)).orderBy(desc(ordersTable.createdAt)).limit(limit).offset(offset);

  res.json({ data, total: totalRow?.count ?? 0, page, limit });
});

router.get("/customers/:id/transactions", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const page = parseInt(String(req.query.page ?? "1"), 10);
  const limit = parseInt(String(req.query.limit ?? "20"), 10);
  const offset = (page - 1) * limit;

  const [totalRow] = await db.select({ count: count() }).from(transactionsTable).where(eq(transactionsTable.customerId, id));
  const data = await db.select().from(transactionsTable).where(eq(transactionsTable.customerId, id)).orderBy(desc(transactionsTable.createdAt)).limit(limit).offset(offset);

  res.json({ data, total: totalRow?.count ?? 0, page, limit });
});

router.post("/customers/:id/disable", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const [customer] = await db.update(customersTable).set({ isActive: false }).where(eq(customersTable.id, id)).returning();
  if (!customer) {
    res.status(404).json({ error: "Customer not found" });
    return;
  }
  res.json(customer);
});

router.post("/customers/:id/add-balance", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const { amount } = req.body;
  if (!amount) {
    res.status(400).json({ error: "Amount is required" });
    return;
  }
  const [customer] = await db
    .update(customersTable)
    .set({ balance: sql`balance + ${parseFloat(String(amount))}` })
    .where(eq(customersTable.id, id))
    .returning();
  if (!customer) {
    res.status(404).json({ error: "Customer not found" });
    return;
  }
  res.json(customer);
});

export default router;
