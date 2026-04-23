import { describe, it, expect, afterEach } from "vitest";
import {
  db,
  categoriesTable,
  productsTable,
  productStocksTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  queryCategoriesWithStock,
  queryProductsWithStock,
  queryProductDetail,
} from "../lib/bot";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

interface BrowseFixture {
  categoryId: number;
  productId: number;
  stockIds: number[];
  marker: string;
}

let counter = 0;

async function createBrowseFixture(opts: {
  stockCount: number;
  inactive?: boolean;
}): Promise<BrowseFixture> {
  counter += 1;
  const marker = `browsetest_${Date.now()}_${counter}_${Math.random().toString(36).slice(2, 8)}`;

  const [category] = await db
    .insert(categoriesTable)
    .values({ name: marker, icon: "🧪", isActive: !opts.inactive })
    .returning();

  const [product] = await db
    .insert(productsTable)
    .values({
      name: `${marker}_prod`,
      price: "99000",
      productType: "digital",
      categoryId: category.id,
      isActive: !opts.inactive,
      minQuantity: 1,
      maxQuantity: 10,
    })
    .returning();

  const stockIds: number[] = [];
  for (let i = 0; i < opts.stockCount; i++) {
    const [stock] = await db
      .insert(productStocksTable)
      .values({
        productId: product.id,
        content: `${marker}_stock_${i}`,
        status: "available",
      })
      .returning();
    stockIds.push(stock.id);
  }

  return { categoryId: category.id, productId: product.id, stockIds, marker };
}

async function addSoldStock(productId: number, count: number): Promise<number[]> {
  const ids: number[] = [];
  for (let i = 0; i < count; i++) {
    const [stock] = await db
      .insert(productStocksTable)
      .values({
        productId,
        content: `sold_stock_${Date.now()}_${i}`,
        status: "sold",
      })
      .returning();
    ids.push(stock.id);
  }
  return ids;
}

async function cleanupBrowseFixture(fx: BrowseFixture): Promise<void> {
  await db.delete(productStocksTable).where(eq(productStocksTable.productId, fx.productId));
  await db.delete(productsTable).where(eq(productsTable.id, fx.productId));
  await db.delete(categoriesTable).where(eq(categoriesTable.id, fx.categoryId));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("product browsing queries (categories → products → detail)", () => {
  const fixtures: BrowseFixture[] = [];
  const extraStockIds: number[][] = [];

  afterEach(async () => {
    for (const ids of extraStockIds.splice(0)) {
      for (const id of ids) {
        await db.delete(productStocksTable).where(eq(productStocksTable.id, id));
      }
    }
    while (fixtures.length) {
      await cleanupBrowseFixture(fixtures.pop()!);
    }
  });

  // -------------------------------------------------------------------------
  // queryCategoriesWithStock
  // -------------------------------------------------------------------------

  it("queryCategoriesWithStock: category with available stock shows correct count", async () => {
    const fx = await createBrowseFixture({ stockCount: 3 });
    fixtures.push(fx);

    const categories = await queryCategoriesWithStock();

    const found = categories.find(c => c.id === fx.categoryId);
    expect(found).toBeDefined();
    expect(found!.stockCount).toBe(3);
  });

  it("queryCategoriesWithStock: category with no stock shows 0", async () => {
    const fx = await createBrowseFixture({ stockCount: 0 });
    fixtures.push(fx);

    const categories = await queryCategoriesWithStock();

    const found = categories.find(c => c.id === fx.categoryId);
    expect(found).toBeDefined();
    expect(found!.stockCount).toBe(0);
  });

  it("queryCategoriesWithStock: sold stock items are not counted", async () => {
    const fx = await createBrowseFixture({ stockCount: 2 });
    fixtures.push(fx);
    const soldIds = await addSoldStock(fx.productId, 5);
    extraStockIds.push(soldIds);

    const categories = await queryCategoriesWithStock();

    const found = categories.find(c => c.id === fx.categoryId);
    expect(found).toBeDefined();
    expect(found!.stockCount).toBe(2);
  });

  it("queryCategoriesWithStock: inactive category is excluded", async () => {
    const fx = await createBrowseFixture({ stockCount: 3, inactive: true });
    fixtures.push(fx);

    const categories = await queryCategoriesWithStock();

    const found = categories.find(c => c.id === fx.categoryId);
    expect(found).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // queryProductsWithStock
  // -------------------------------------------------------------------------

  it("queryProductsWithStock: product with available stock shows correct count", async () => {
    const fx = await createBrowseFixture({ stockCount: 4 });
    fixtures.push(fx);

    const products = await queryProductsWithStock(fx.categoryId);

    const found = products.find(p => p.id === fx.productId);
    expect(found).toBeDefined();
    expect(found!.stockCount).toBe(4);
  });

  it("queryProductsWithStock: product with no stock shows 0", async () => {
    const fx = await createBrowseFixture({ stockCount: 0 });
    fixtures.push(fx);

    const products = await queryProductsWithStock(fx.categoryId);

    const found = products.find(p => p.id === fx.productId);
    expect(found).toBeDefined();
    expect(found!.stockCount).toBe(0);
  });

  it("queryProductsWithStock: sold stock items are not counted", async () => {
    const fx = await createBrowseFixture({ stockCount: 1 });
    fixtures.push(fx);
    const soldIds = await addSoldStock(fx.productId, 7);
    extraStockIds.push(soldIds);

    const products = await queryProductsWithStock(fx.categoryId);

    const found = products.find(p => p.id === fx.productId);
    expect(found).toBeDefined();
    expect(found!.stockCount).toBe(1);
  });

  it("queryProductsWithStock: inactive product is excluded", async () => {
    const fx = await createBrowseFixture({ stockCount: 3, inactive: true });
    fixtures.push(fx);

    const products = await queryProductsWithStock(fx.categoryId);

    const found = products.find(p => p.id === fx.productId);
    expect(found).toBeUndefined();
  });

  it("queryProductsWithStock: returns empty array for unknown categoryId", async () => {
    const products = await queryProductsWithStock(0);
    expect(products).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // queryProductDetail
  // -------------------------------------------------------------------------

  it("queryProductDetail: returns product with correct stock count", async () => {
    const fx = await createBrowseFixture({ stockCount: 5 });
    fixtures.push(fx);

    const detail = await queryProductDetail(fx.productId);

    expect(detail).toBeDefined();
    expect(detail!.id).toBe(fx.productId);
    expect(detail!.stockCount).toBe(5);
  });

  it("queryProductDetail: sold stock items are not counted", async () => {
    const fx = await createBrowseFixture({ stockCount: 2 });
    fixtures.push(fx);
    const soldIds = await addSoldStock(fx.productId, 10);
    extraStockIds.push(soldIds);

    const detail = await queryProductDetail(fx.productId);

    expect(detail).toBeDefined();
    expect(detail!.stockCount).toBe(2);
  });

  it("queryProductDetail: product with no stock has stockCount 0", async () => {
    const fx = await createBrowseFixture({ stockCount: 0 });
    fixtures.push(fx);

    const detail = await queryProductDetail(fx.productId);

    expect(detail).toBeDefined();
    expect(detail!.stockCount).toBe(0);
  });

  it("queryProductDetail: unknown productId returns undefined", async () => {
    const detail = await queryProductDetail(0);
    expect(detail).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // End-to-end browsing path: categories → products → product detail
  // -------------------------------------------------------------------------

  it("full browsing path: categories → products → detail returns consistent stock counts", async () => {
    const fx = await createBrowseFixture({ stockCount: 6 });
    fixtures.push(fx);

    const categories = await queryCategoriesWithStock();
    const cat = categories.find(c => c.id === fx.categoryId);
    expect(cat).toBeDefined();
    expect(cat!.stockCount).toBe(6);

    const products = await queryProductsWithStock(cat!.id);
    const prod = products.find(p => p.id === fx.productId);
    expect(prod).toBeDefined();
    expect(prod!.stockCount).toBe(6);

    const detail = await queryProductDetail(prod!.id);
    expect(detail).toBeDefined();
    expect(detail!.stockCount).toBe(6);
    expect(detail!.categoryId).toBe(fx.categoryId);
  });
});
