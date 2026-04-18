import { Router, type IRouter } from "express";
import { eq, ilike, and, sql, count } from "drizzle-orm";
import { db, productsTable, productStocksTable, categoriesTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { validateBody, validateParams, validateQuery } from "../middlewares/validate";
import {
  ListProductsQueryParams,
  CreateProductBody,
  GetProductParams,
  UpdateProductParams,
  UpdateProductBody,
  DeleteProductParams,
  ListProductStocksParams,
  ListProductStocksQueryParams,
  AddProductStocksParams,
  AddProductStocksBody,
  DeleteStockParams,
} from "@workspace/api-zod";
import type z from "zod";

const router: IRouter = Router();

router.get("/products", requireAuth, validateQuery(ListProductsQueryParams), async (req, res): Promise<void> => {
  const { page, limit, search, categoryId, isActive } = req.query as unknown as z.infer<typeof ListProductsQueryParams>;
  const offset = (page - 1) * limit;

  const conditions = [];
  if (search) conditions.push(ilike(productsTable.name, `%${search}%`));
  if (categoryId !== undefined) conditions.push(eq(productsTable.categoryId, categoryId));
  if (isActive !== undefined) conditions.push(eq(productsTable.isActive, isActive));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [totalRow] = await db.select({ count: count() }).from(productsTable).where(where);
  const products = await db.select({
    id: productsTable.id,
    name: productsTable.name,
    description: productsTable.description,
    categoryId: productsTable.categoryId,
    categoryIcon: productsTable.categoryIcon,
    productIcon: productsTable.productIcon,
    price: productsTable.price,
    originalPrice: productsTable.originalPrice,
    productType: productsTable.productType,
    minQuantity: productsTable.minQuantity,
    maxQuantity: productsTable.maxQuantity,
    isActive: productsTable.isActive,
    createdAt: productsTable.createdAt,
    updatedAt: productsTable.updatedAt,
    stockCount: sql<number>`(SELECT COUNT(*) FROM product_stocks WHERE product_id = ${productsTable.id} AND status = 'available')::int`,
  }).from(productsTable).where(where).orderBy(productsTable.createdAt).limit(limit).offset(offset);

  res.json({ data: products, total: totalRow?.count ?? 0, page, limit });
});

router.post("/products", requireAuth, validateBody(CreateProductBody), async (req, res): Promise<void> => {
  const { name, description, categoryId, categoryIcon, productIcon, price, originalPrice, productType, minQuantity, maxQuantity, isActive } = req.body as z.infer<typeof CreateProductBody>;
  const [product] = await db.insert(productsTable).values({
    name,
    description,
    categoryId,
    categoryIcon,
    productIcon,
    price: String(price),
    originalPrice: originalPrice ? String(originalPrice) : undefined,
    productType: productType ?? "digital",
    minQuantity: minQuantity ?? 1,
    maxQuantity: maxQuantity ?? 100,
    isActive: isActive ?? true,
  }).returning();
  res.status(201).json({ ...product, stockCount: 0 });
});

router.get("/products/:id", requireAuth, validateParams(GetProductParams), async (req, res): Promise<void> => {
  const { id } = req.params as unknown as z.infer<typeof GetProductParams>;
  const [product] = await db.select({
    id: productsTable.id,
    name: productsTable.name,
    description: productsTable.description,
    categoryId: productsTable.categoryId,
    categoryIcon: productsTable.categoryIcon,
    productIcon: productsTable.productIcon,
    price: productsTable.price,
    originalPrice: productsTable.originalPrice,
    productType: productsTable.productType,
    minQuantity: productsTable.minQuantity,
    maxQuantity: productsTable.maxQuantity,
    isActive: productsTable.isActive,
    createdAt: productsTable.createdAt,
    updatedAt: productsTable.updatedAt,
    stockCount: sql<number>`(SELECT COUNT(*) FROM product_stocks WHERE product_id = ${productsTable.id} AND status = 'available')::int`,
  }).from(productsTable).where(eq(productsTable.id, id));

  if (!product) {
    res.status(404).json({ error: "Product not found" });
    return;
  }

  const category = product.categoryId
    ? (await db.select().from(categoriesTable).where(eq(categoriesTable.id, product.categoryId)))[0] ?? null
    : null;

  res.json({ ...product, category });
});

router.patch("/products/:id", requireAuth, validateParams(UpdateProductParams), validateBody(UpdateProductBody), async (req, res): Promise<void> => {
  const { id } = req.params as unknown as z.infer<typeof UpdateProductParams>;
  const { name, description, categoryId, categoryIcon, productIcon, price, originalPrice, productType, minQuantity, maxQuantity, isActive } = req.body as z.infer<typeof UpdateProductBody>;

  const updateData: Record<string, unknown> = {};
  if (name !== undefined) updateData.name = name;
  if (description !== undefined) updateData.description = description;
  if (categoryId !== undefined) updateData.categoryId = categoryId;
  if (categoryIcon !== undefined) updateData.categoryIcon = categoryIcon;
  if (productIcon !== undefined) updateData.productIcon = productIcon;
  if (price !== undefined) updateData.price = String(price);
  if (originalPrice !== undefined) updateData.originalPrice = String(originalPrice);
  if (productType !== undefined) updateData.productType = productType;
  if (minQuantity !== undefined) updateData.minQuantity = minQuantity;
  if (maxQuantity !== undefined) updateData.maxQuantity = maxQuantity;
  if (isActive !== undefined) updateData.isActive = isActive;

  const [product] = await db.update(productsTable).set(updateData).where(eq(productsTable.id, id)).returning();
  if (!product) {
    res.status(404).json({ error: "Product not found" });
    return;
  }
  const [stockRow] = await db.select({ count: count() }).from(productStocksTable).where(and(eq(productStocksTable.productId, id), eq(productStocksTable.status, "available")));
  res.json({ ...product, stockCount: stockRow?.count ?? 0 });
});

router.delete("/products/:id", requireAuth, validateParams(DeleteProductParams), async (req, res): Promise<void> => {
  const { id } = req.params as unknown as z.infer<typeof DeleteProductParams>;
  const [product] = await db.delete(productsTable).where(eq(productsTable.id, id)).returning();
  if (!product) {
    res.status(404).json({ error: "Product not found" });
    return;
  }
  res.sendStatus(204);
});

// Stock routes
router.get("/products/:id/stocks", requireAuth, validateParams(ListProductStocksParams), validateQuery(ListProductStocksQueryParams), async (req, res): Promise<void> => {
  const { id: productId } = req.params as unknown as z.infer<typeof ListProductStocksParams>;
  const { status } = req.query as unknown as z.infer<typeof ListProductStocksQueryParams>;

  const conditions = [eq(productStocksTable.productId, productId)];
  if (status) conditions.push(eq(productStocksTable.status, status));

  const data = await db.select().from(productStocksTable).where(and(...conditions)).orderBy(productStocksTable.createdAt);
  const [availableCount] = await db.select({ count: count() }).from(productStocksTable).where(and(eq(productStocksTable.productId, productId), eq(productStocksTable.status, "available")));

  res.json({ data, availableCount: availableCount?.count ?? 0, totalCount: data.length });
});

router.post("/products/:id/stocks", requireAuth, validateParams(AddProductStocksParams), validateBody(AddProductStocksBody), async (req, res): Promise<void> => {
  const { id: productId } = req.params as unknown as z.infer<typeof AddProductStocksParams>;
  const { lines } = req.body as z.infer<typeof AddProductStocksBody>;
  const validLines = lines.map((l: string) => l.trim()).filter((l: string) => l.length > 0);
  if (validLines.length === 0) {
    res.status(400).json({ error: "No valid stock lines provided" });
    return;
  }
  await db.insert(productStocksTable).values(validLines.map((content: string) => ({ productId, content, status: "available" })));
  res.status(201).json({ added: validLines.length, message: `Added ${validLines.length} stock lines` });
});

router.delete("/stocks/:id", requireAuth, validateParams(DeleteStockParams), async (req, res): Promise<void> => {
  const { id } = req.params as unknown as z.infer<typeof DeleteStockParams>;
  const [stock] = await db.delete(productStocksTable).where(eq(productStocksTable.id, id)).returning();
  if (!stock) {
    res.status(404).json({ error: "Stock not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
