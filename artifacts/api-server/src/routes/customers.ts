import { Router, type IRouter } from "express";
import { eq, or, ilike, desc, count, sql } from "drizzle-orm";
import { db, customersTable, ordersTable, transactionsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { validateBody, validateParams, validateQuery } from "../middlewares/validate";
import {
  ListCustomersQueryParams,
  GetCustomerParams,
  GetCustomerOrdersParams,
  GetCustomerOrdersQueryParams,
  GetCustomerTransactionsParams,
  GetCustomerTransactionsQueryParams,
  DisableCustomerParams,
  AddCustomerBalanceParams,
  AddCustomerBalanceBody,
} from "@workspace/api-zod";
import { sendMessageToCustomer } from "../lib/bot";
import type z from "zod";

const router: IRouter = Router();

router.get("/customers", requireAuth, validateQuery(ListCustomersQueryParams), async (req, res): Promise<void> => {
  const { page, limit, search } = res.locals["query"] as z.infer<typeof ListCustomersQueryParams>;
  const offset = (page - 1) * limit;

  const where = search
    ? or(
        ilike(customersTable.chatId, `%${search}%`),
        ilike(customersTable.username, `%${search}%`),
        ilike(customersTable.firstName, `%${search}%`),
      )
    : undefined;

  const [totalRow] = await db.select({ count: count() }).from(customersTable).where(where);
  const data = await db.select().from(customersTable).where(where).orderBy(desc(customersTable.createdAt)).limit(limit).offset(offset);

  res.json({ data, total: totalRow?.count ?? 0, page, limit });
});

router.get("/customers/:id", requireAuth, validateParams(GetCustomerParams), async (req, res): Promise<void> => {
  const { id } = req.params as unknown as z.infer<typeof GetCustomerParams>;
  const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, id));
  if (!customer) {
    res.status(404).json({ error: "Customer not found" });
    return;
  }
  res.json(customer);
});

router.get("/customers/:id/orders", requireAuth, validateParams(GetCustomerOrdersParams), validateQuery(GetCustomerOrdersQueryParams), async (req, res): Promise<void> => {
  const { id } = req.params as unknown as z.infer<typeof GetCustomerOrdersParams>;
  const { page, limit } = res.locals["query"] as z.infer<typeof GetCustomerOrdersQueryParams>;
  const offset = (page - 1) * limit;

  const [totalRow] = await db.select({ count: count() }).from(ordersTable).where(eq(ordersTable.customerId, id));
  const data = await db.select().from(ordersTable).where(eq(ordersTable.customerId, id)).orderBy(desc(ordersTable.createdAt)).limit(limit).offset(offset);

  res.json({ data, total: totalRow?.count ?? 0, page, limit });
});

router.get("/customers/:id/transactions", requireAuth, validateParams(GetCustomerTransactionsParams), validateQuery(GetCustomerTransactionsQueryParams), async (req, res): Promise<void> => {
  const { id } = req.params as unknown as z.infer<typeof GetCustomerTransactionsParams>;
  const { page, limit } = res.locals["query"] as z.infer<typeof GetCustomerTransactionsQueryParams>;
  const offset = (page - 1) * limit;

  const [totalRow] = await db.select({ count: count() }).from(transactionsTable).where(eq(transactionsTable.customerId, id));
  const data = await db.select().from(transactionsTable).where(eq(transactionsTable.customerId, id)).orderBy(desc(transactionsTable.createdAt)).limit(limit).offset(offset);

  res.json({ data, total: totalRow?.count ?? 0, page, limit });
});

router.post("/customers/:id/disable", requireAuth, validateParams(DisableCustomerParams), async (req, res): Promise<void> => {
  const { id } = req.params as unknown as z.infer<typeof DisableCustomerParams>;
  const [customer] = await db.update(customersTable).set({ isActive: false }).where(eq(customersTable.id, id)).returning();
  if (!customer) {
    res.status(404).json({ error: "Customer not found" });
    return;
  }
  res.json(customer);
});

router.post("/customers/:id/add-balance", requireAuth, validateParams(AddCustomerBalanceParams), validateBody(AddCustomerBalanceBody), async (req, res): Promise<void> => {
  const { id } = req.params as unknown as z.infer<typeof AddCustomerBalanceParams>;
  const { amount, note } = req.body as z.infer<typeof AddCustomerBalanceBody>;
  const parsedAmount = parseFloat(String(amount));

  const [customer] = await db
    .update(customersTable)
    .set({ balance: sql`balance + ${parsedAmount}` })
    .where(eq(customersTable.id, id))
    .returning();

  if (!customer) {
    res.status(404).json({ error: "Customer not found" });
    return;
  }

  const transactionCode = `ADJ-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  await db.insert(transactionsTable).values({
    transactionCode,
    customerId: id,
    amount: parsedAmount.toFixed(2),
    type: "adjustment",
    status: "completed",
    notes: note ?? null,
    confirmedAt: new Date(),
  });

  const amountFormatted = Math.abs(parsedAmount).toLocaleString("vi-VN");
  const isCredit = parsedAmount >= 0;
  let notifMsg = isCredit
    ? `💰 <b>Số dư ví của bạn đã được cộng thêm ${amountFormatted}đ</b>`
    : `💸 <b>Số dư ví của bạn đã bị trừ ${amountFormatted}đ</b>`;
  notifMsg += `\n💼 Số dư hiện tại: <b>${parseFloat(customer.balance).toLocaleString("vi-VN")}đ</b>`;
  if (note) notifMsg += `\n📝 Lý do: ${note}`;
  await sendMessageToCustomer(customer.chatId, notifMsg);

  res.json(customer);
});

export default router;
