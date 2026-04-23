import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, categoriesTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { validateBody, validateParams } from "../middlewares/validate";
import {
  CreateCategoryBody,
  GetCategoryParams,
  UpdateCategoryParams,
  UpdateCategoryBody,
  DeleteCategoryParams,
} from "@workspace/api-zod";
import type z from "zod";

const router: IRouter = Router();

router.get("/categories", requireAuth, async (_req, res): Promise<void> => {
  const data = await db.select().from(categoriesTable).orderBy(categoriesTable.name);
  res.json({ data });
});

router.post("/categories", requireAuth, validateBody(CreateCategoryBody), async (req, res): Promise<void> => {
  const { name, icon, isActive } = req.body as z.infer<typeof CreateCategoryBody>;
  const [category] = await db.insert(categoriesTable).values({ name, icon, isActive: isActive ?? true }).returning();
  res.status(201).json(category);
});

router.get("/categories/:id", requireAuth, validateParams(GetCategoryParams), async (req, res): Promise<void> => {
  const { id } = req.params as unknown as z.infer<typeof GetCategoryParams>;
  const [category] = await db.select().from(categoriesTable).where(eq(categoriesTable.id, id));
  if (!category) {
    res.status(404).json({ error: "Category not found" });
    return;
  }
  res.json(category);
});

router.patch("/categories/:id", requireAuth, validateParams(UpdateCategoryParams), validateBody(UpdateCategoryBody), async (req, res): Promise<void> => {
  const { id } = req.params as unknown as z.infer<typeof UpdateCategoryParams>;
  const { name, icon, isActive } = req.body as z.infer<typeof UpdateCategoryBody>;
  const [category] = await db.update(categoriesTable)
    .set({ ...(name !== undefined && { name }), ...(icon !== undefined && { icon }), ...(isActive !== undefined && { isActive }) })
    .where(eq(categoriesTable.id, id))
    .returning();
  if (!category) {
    res.status(404).json({ error: "Category not found" });
    return;
  }
  res.json(category);
});

router.delete("/categories/:id", requireAuth, validateParams(DeleteCategoryParams), async (req, res): Promise<void> => {
  const { id } = req.params as unknown as z.infer<typeof DeleteCategoryParams>;
  const [category] = await db.delete(categoriesTable).where(eq(categoriesTable.id, id)).returning();
  if (!category) {
    res.status(404).json({ error: "Category not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
