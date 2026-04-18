import { db, adminsTable, categoriesTable, productsTable, productStocksTable, customersTable, ordersTable, orderItemsTable, transactionsTable } from "@workspace/db";
import { eq, count } from "drizzle-orm";
import bcrypt from "bcrypt";
import { logger } from "./logger";

export async function seed(): Promise<void> {
  // Check if already seeded
  const [adminCount] = await db.select({ count: count() }).from(adminsTable);
  if ((adminCount?.count ?? 0) > 0) {
    logger.info("Database already seeded, skipping");
    return;
  }

  logger.info("Seeding database...");

  // Create admin
  const passwordHash = await bcrypt.hash("admin123", 10);
  const [admin] = await db.insert(adminsTable).values({
    username: "admin",
    passwordHash,
    displayName: "Administrator",
  }).returning();
  logger.info({ adminId: admin.id }, "Admin created");

  // Create categories
  const [cat1] = await db.insert(categoriesTable).values({ name: "Tài khoản Game", icon: "🎮", isActive: true }).returning();
  const [cat2] = await db.insert(categoriesTable).values({ name: "Phần mềm & Key", icon: "💻", isActive: true }).returning();
  logger.info("Categories created");

  // Create products
  const [prod1] = await db.insert(productsTable).values({
    name: "Account PUBG Mobile VIP",
    description: "Tài khoản PUBG Mobile rank cao, nhiều skin hiếm",
    categoryId: cat1.id,
    categoryIcon: "🎮",
    productIcon: "🔑",
    price: "150000",
    originalPrice: "200000",
    productType: "digital",
    minQuantity: 1,
    maxQuantity: 5,
    isActive: true,
  }).returning();

  const [prod2] = await db.insert(productsTable).values({
    name: "Account Genshin Impact AR55+",
    description: "Tài khoản Genshin Impact nhiều nhân vật 5 sao",
    categoryId: cat1.id,
    categoryIcon: "🎮",
    productIcon: "⚔️",
    price: "250000",
    originalPrice: "300000",
    productType: "digital",
    minQuantity: 1,
    maxQuantity: 3,
    isActive: true,
  }).returning();

  const [prod3] = await db.insert(productsTable).values({
    name: "Windows 11 Pro License Key",
    description: "Key bản quyền Windows 11 Pro - Kích hoạt vĩnh viễn",
    categoryId: cat2.id,
    categoryIcon: "💻",
    productIcon: "🪟",
    price: "99000",
    originalPrice: "150000",
    productType: "digital",
    minQuantity: 1,
    maxQuantity: 10,
    isActive: true,
  }).returning();
  logger.info("Products created");

  // Create stock lines
  const stockLines1 = [
    "pubg_user1@gmail.com:Pass123!|UID:123456|Rank:Conqueror",
    "pubg_user2@gmail.com:Pass456!|UID:234567|Rank:Ace",
    "pubg_user3@gmail.com:Pass789!|UID:345678|Rank:Crown",
    "pubg_user4@gmail.com:PassABC!|UID:456789|Rank:Ace",
    "pubg_user5@gmail.com:PassDEF!|UID:567890|Rank:Conqueror",
    "pubg_user6@gmail.com:PassGHI!|UID:678901|Rank:Crown",
    "pubg_user7@gmail.com:PassJKL!|UID:789012|Rank:Ace",
  ];
  await db.insert(productStocksTable).values(stockLines1.map(content => ({ productId: prod1.id, content, status: "available" })));

  const stockLines2 = [
    "genshin_user1@gmail.com:GPass123|UID:888001|AR:58|5Stars:Ayaka,Hu Tao,Venti",
    "genshin_user2@gmail.com:GPass456|UID:888002|AR:56|5Stars:Raiden,Zhongli",
    "genshin_user3@gmail.com:GPass789|UID:888003|AR:55|5Stars:Ganyu,Xiao",
    "genshin_user4@gmail.com:GPassABC|UID:888004|AR:59|5Stars:Kazuha,Yelan,Kokomi",
    "genshin_user5@gmail.com:GPassDEF|UID:888005|AR:57|5Stars:Neuvilette,Furina",
  ];
  await db.insert(productStocksTable).values(stockLines2.map(content => ({ productId: prod2.id, content, status: "available" })));

  const stockLines3 = [
    "WXXX1-YYYYY-ZZZZZ-AAAAA-BBBBB",
    "WXXX2-YYYYY-ZZZZZ-AAAAA-CCCCC",
    "WXXX3-YYYYY-ZZZZZ-AAAAA-DDDDD",
    "WXXX4-YYYYY-ZZZZZ-AAAAA-EEEEE",
    "WXXX5-YYYYY-ZZZZZ-AAAAA-FFFFF",
    "WXXX6-YYYYY-ZZZZZ-AAAAA-GGGGG",
    "WXXX7-YYYYY-ZZZZZ-AAAAA-HHHHH",
    "WXXX8-YYYYY-ZZZZZ-AAAAA-IIIII",
  ];
  await db.insert(productStocksTable).values(stockLines3.map(content => ({ productId: prod3.id, content, status: "available" })));
  logger.info("Stock lines created (20 total)");

  // Create demo customers
  const [cust1] = await db.insert(customersTable).values({
    chatId: "100000001",
    firstName: "Nguyễn",
    lastName: "Văn A",
    username: "nguyenvana",
    balance: "0",
    totalSpent: "399000",
    totalOrders: 2,
    lastActiveAt: new Date(),
    isActive: true,
  }).returning();

  const [cust2] = await db.insert(customersTable).values({
    chatId: "100000002",
    firstName: "Trần",
    lastName: "Thị B",
    username: "tranthib",
    balance: "50000",
    totalSpent: "150000",
    totalOrders: 1,
    lastActiveAt: new Date(Date.now() - 86400000),
    isActive: true,
  }).returning();
  logger.info("Customers created");

  // Create sample orders and transactions
  const orderCode1 = "ORD-DEMO-001";
  const [order1] = await db.insert(ordersTable).values({
    orderCode: orderCode1,
    customerId: cust1.id,
    totalAmount: "250000",
    status: "delivered",
    paymentReference: "SHOP1DEMO001",
    paidAt: new Date(Date.now() - 3600000),
    deliveredAt: new Date(Date.now() - 3500000),
  }).returning();

  await db.insert(orderItemsTable).values({
    orderId: order1.id,
    productId: prod2.id,
    productName: prod2.name,
    quantity: 1,
    unitPrice: "250000",
    totalPrice: "250000",
  });

  await db.insert(transactionsTable).values({
    transactionCode: "TXN-DEMO-001",
    paymentReference: "SHOP1DEMO001",
    type: "payment",
    orderId: order1.id,
    customerId: cust1.id,
    amount: "250000",
    status: "confirmed",
    provider: "sepay",
    confirmedAt: new Date(Date.now() - 3600000),
  });

  const orderCode2 = "ORD-DEMO-002";
  const [order2] = await db.insert(ordersTable).values({
    orderCode: orderCode2,
    customerId: cust2.id,
    totalAmount: "150000",
    status: "paid",
    paymentReference: "SHOP2DEMO002",
    paidAt: new Date(Date.now() - 7200000),
  }).returning();

  await db.insert(orderItemsTable).values({
    orderId: order2.id,
    productId: prod1.id,
    productName: prod1.name,
    quantity: 1,
    unitPrice: "150000",
    totalPrice: "150000",
  });

  await db.insert(transactionsTable).values({
    transactionCode: "TXN-DEMO-002",
    paymentReference: "SHOP2DEMO002",
    type: "payment",
    orderId: order2.id,
    customerId: cust2.id,
    amount: "150000",
    status: "confirmed",
    provider: "sepay",
    confirmedAt: new Date(Date.now() - 7200000),
  });

  // Pending order
  const orderCode3 = "ORD-DEMO-003";
  const [order3] = await db.insert(ordersTable).values({
    orderCode: orderCode3,
    customerId: cust1.id,
    totalAmount: "99000",
    status: "pending",
    paymentReference: "SHOP3DEMO003",
  }).returning();

  await db.insert(orderItemsTable).values({
    orderId: order3.id,
    productId: prod3.id,
    productName: prod3.name,
    quantity: 1,
    unitPrice: "99000",
    totalPrice: "99000",
  });

  await db.insert(transactionsTable).values({
    transactionCode: "TXN-DEMO-003",
    paymentReference: "SHOP3DEMO003",
    type: "payment",
    orderId: order3.id,
    customerId: cust1.id,
    amount: "99000",
    status: "pending",
    provider: "sepay",
  });

  logger.info("Demo orders and transactions created");
  logger.info("✅ Database seeding complete!");
}
