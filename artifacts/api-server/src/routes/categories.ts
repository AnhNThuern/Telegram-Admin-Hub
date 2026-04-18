import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, categoriesTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

router.get("/categories", requireAuth, async (_req, res): Promise<void> => {
  const data = await db.select().from(categoriesTable).orderBy(categoriesTable.name);
  res.json({ data });
});

router.post("/categories", requireAuth, async (req, res): Promise<void> => {
  const { name, icon, isActive } = req.body;
  if (!name) {
    res.status(400).json({ error: "Name is required" });
    return;
  }
  const [category] = await db.insert(categoriesTable).values({ name, icon, isActive: isActive ?? true }).returning();
  res.status(201).json(category);
});

router.get("/categories/:id", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const [category] = await db.select().from(categoriesTable).where(eq(categoriesTable.id, id));
  if (!category) {
    res.status(404).json({ error: "Category not found" });
    return;
  }
  res.json(category);
});

router.patch("/categories/:id", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const { name, icon, isActive } = req.body;
  const [category] = await db.update(categoriesTable).set({ name, icon, isActive }).where(eq(categoriesTable.id, id)).returning();
  if (!category) {
    res.status(404).json({ error: "Category not found" });
    return;
  }
  res.json(category);
});

router.delete("/categories/:id", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const [category] = await db.delete(categoriesTable).where(eq(categoriesTable.id, id)).returning();
  if (!category) {
    res.status(404).json({ error: "Category not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
