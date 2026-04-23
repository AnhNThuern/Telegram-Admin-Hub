import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, promotionsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { validateBody, validateParams } from "../middlewares/validate";
import {
  CreatePromotionBody,
  GetPromotionParams,
  UpdatePromotionParams,
  UpdatePromotionBody,
  DeletePromotionParams,
} from "@workspace/api-zod";
import type z from "zod";

const router: IRouter = Router();

router.get("/promotions", requireAuth, async (_req, res): Promise<void> => {
  const data = await db.select().from(promotionsTable).orderBy(promotionsTable.priority);
  res.json({ data });
});

router.post("/promotions", requireAuth, validateBody(CreatePromotionBody), async (req, res): Promise<void> => {
  const { name, description, code, type, discountValue, usageLimit, appliesTo, categoryId, productId, customerTarget, customerId, tiers, startDate, endDate, priority, isActive } = req.body as z.infer<typeof CreatePromotionBody>;
  const normalizedCode = code?.trim() ? code.trim().toUpperCase() : undefined;
  const [promotion] = await db.insert(promotionsTable).values({
    name,
    description,
    code: normalizedCode,
    type,
    discountValue: discountValue ?? undefined,
    usageLimit: usageLimit ?? undefined,
    appliesTo: appliesTo ?? "all",
    categoryId,
    productId,
    customerTarget: customerTarget ?? "all",
    customerId,
    tiers,
    startDate: startDate ? new Date(startDate) : undefined,
    endDate: endDate ? new Date(endDate) : undefined,
    priority: priority ?? 0,
    isActive: isActive ?? true,
  }).returning();
  res.status(201).json(promotion);
});

router.get("/promotions/:id", requireAuth, validateParams(GetPromotionParams), async (req, res): Promise<void> => {
  const { id } = req.params as unknown as z.infer<typeof GetPromotionParams>;
  const [promotion] = await db.select().from(promotionsTable).where(eq(promotionsTable.id, id));
  if (!promotion) {
    res.status(404).json({ error: "Promotion not found" });
    return;
  }
  res.json(promotion);
});

router.patch("/promotions/:id", requireAuth, validateParams(UpdatePromotionParams), validateBody(UpdatePromotionBody), async (req, res): Promise<void> => {
  const { id } = req.params as unknown as z.infer<typeof UpdatePromotionParams>;
  const { name, description, code, type, discountValue, usageLimit, appliesTo, categoryId, productId, customerTarget, customerId, tiers, startDate, endDate, priority, isActive } = req.body as z.infer<typeof UpdatePromotionBody>;

  const updateData: Record<string, unknown> = {};
  if (name !== undefined) updateData.name = name;
  if (description !== undefined) updateData.description = description;
  if (code !== undefined) updateData.code = code.trim() ? code.trim().toUpperCase() : null;
  if (type !== undefined) updateData.type = type;
  if (discountValue !== undefined) updateData.discountValue = discountValue;
  if (usageLimit !== undefined) updateData.usageLimit = usageLimit;
  if (appliesTo !== undefined) updateData.appliesTo = appliesTo;
  if (categoryId !== undefined) updateData.categoryId = categoryId;
  if (productId !== undefined) updateData.productId = productId;
  if (customerTarget !== undefined) updateData.customerTarget = customerTarget;
  if (customerId !== undefined) updateData.customerId = customerId;
  if (tiers !== undefined) updateData.tiers = tiers;
  if (startDate !== undefined) updateData.startDate = new Date(startDate);
  if (endDate !== undefined) updateData.endDate = new Date(endDate);
  if (priority !== undefined) updateData.priority = priority;
  if (isActive !== undefined) updateData.isActive = isActive;

  const [promotion] = await db.update(promotionsTable).set(updateData).where(eq(promotionsTable.id, id)).returning();
  if (!promotion) {
    res.status(404).json({ error: "Promotion not found" });
    return;
  }
  res.json(promotion);
});

router.delete("/promotions/:id", requireAuth, validateParams(DeletePromotionParams), async (req, res): Promise<void> => {
  const { id } = req.params as unknown as z.infer<typeof DeletePromotionParams>;
  const [promotion] = await db.delete(promotionsTable).where(eq(promotionsTable.id, id)).returning();
  if (!promotion) {
    res.status(404).json({ error: "Promotion not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
