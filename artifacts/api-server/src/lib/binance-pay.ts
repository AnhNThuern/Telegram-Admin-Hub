import { createHmac, createVerify } from "crypto";
import { db, paymentConfigsTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import { logger } from "./logger";

export interface BinancePayConfig {
  apiKey: string;
  apiSecret: string;
  merchantTradeNoPrefix: string;
  isActive: boolean;
  usdtRate: number | null;
}

export interface BinancePayOrderResult {
  prepayId: string;
  qrcodeLink: string;
  qrContent: string;
  checkoutUrl: string;
  expireTime: number;
  universalUrl: string;
}

const BINANCE_PAY_BASE = "https://bpay.binanceapi.com";
const BINANCE_CERT_URL = "https://public.bnbstatic.com/static/binancepay/prod/pay-001.pem";

let cachedCert: string | null = null;
let certFetchedAt = 0;
const CERT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export async function getBinancePayConfig(): Promise<BinancePayConfig | null> {
  const [config] = await db.select().from(paymentConfigsTable).orderBy(desc(paymentConfigsTable.id)).limit(1);
  if (!config || !config.binanceApiKey || !config.binanceApiSecret) return null;
  return {
    apiKey: config.binanceApiKey,
    apiSecret: config.binanceApiSecret,
    merchantTradeNoPrefix: config.binanceMerchantTradeNoPrefix ?? "SHOP",
    isActive: config.binanceIsActive,
    usdtRate: config.usdtRate ? parseFloat(config.usdtRate) : null,
  };
}

function generateNonce(length = 32): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function buildBinancePayHeaders(apiKey: string, apiSecret: string, body: string): Record<string, string> {
  const timestamp = Date.now().toString();
  const nonce = generateNonce(32);
  const payload = `${timestamp}\n${nonce}\n${body}\n`;
  const signature = createHmac("sha512", apiSecret).update(payload).digest("hex").toUpperCase();

  return {
    "Content-Type": "application/json",
    "BinancePay-Timestamp": timestamp,
    "BinancePay-Nonce": nonce,
    "BinancePay-Certificate-SN": apiKey,
    "BinancePay-Signature": signature,
  };
}

export async function createBinancePayOrder(params: {
  apiKey: string;
  apiSecret: string;
  merchantTradeNo: string;
  orderAmount: string;
  goodsName: string;
  goodsId: string;
}): Promise<BinancePayOrderResult> {
  const { apiKey, apiSecret, merchantTradeNo, orderAmount, goodsName, goodsId } = params;

  const body = JSON.stringify({
    env: { terminalType: "WEB" },
    merchantTradeNo,
    orderAmount,
    currency: "USDT",
    goods: {
      goodsType: "02",
      goodsCategory: "Z000",
      referenceGoodsId: goodsId,
      goodsName: goodsName.substring(0, 256),
    },
  });

  const headers = buildBinancePayHeaders(apiKey, apiSecret, body);

  const res = await fetch(`${BINANCE_PAY_BASE}/binancepay/openapi/v3/order`, {
    method: "POST",
    headers,
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Binance Pay API error ${res.status}: ${text}`);
  }

  const data = await res.json() as {
    status: string;
    code: string;
    errorMessage?: string;
    data?: {
      prepayId: string;
      terminalType: string;
      expireTime: number;
      qrcodeLink: string;
      qrContent: string;
      checkoutUrl: string;
      deeplink: string;
      universalUrl: string;
    };
  };

  if (data.status !== "SUCCESS" || !data.data) {
    throw new Error(`Binance Pay order failed: ${data.errorMessage ?? data.code}`);
  }

  logger.info({ merchantTradeNo, prepayId: data.data.prepayId }, "Binance Pay order created");

  return {
    prepayId: data.data.prepayId,
    qrcodeLink: data.data.qrcodeLink,
    qrContent: data.data.qrContent,
    checkoutUrl: data.data.checkoutUrl,
    expireTime: data.data.expireTime,
    universalUrl: data.data.universalUrl ?? data.data.checkoutUrl,
  };
}

async function getBinanceCert(): Promise<string> {
  const now = Date.now();
  if (cachedCert && now - certFetchedAt < CERT_CACHE_TTL_MS) return cachedCert;

  const res = await fetch(BINANCE_CERT_URL);
  if (!res.ok) throw new Error(`Failed to fetch Binance cert: ${res.status}`);
  cachedCert = await res.text();
  certFetchedAt = now;
  return cachedCert;
}

export async function verifyBinanceWebhookSignature(
  headers: Record<string, string | string[] | undefined>,
  rawBody: string,
): Promise<boolean> {
  try {
    const timestamp = String(headers["binancepay-timestamp"] ?? headers["BinancePay-Timestamp"] ?? "");
    const nonce = String(headers["binancepay-nonce"] ?? headers["BinancePay-Nonce"] ?? "");
    const signature = String(headers["binancepay-signature"] ?? headers["BinancePay-Signature"] ?? "");

    if (!timestamp || !nonce || !signature) {
      logger.warn("Binance webhook missing signature headers");
      return false;
    }

    const payload = `${timestamp}\n${nonce}\n${rawBody}\n`;
    const cert = await getBinanceCert();

    const verify = createVerify("SHA256");
    verify.update(payload);
    const isValid = verify.verify(cert, signature, "base64");

    if (!isValid) {
      logger.warn({ timestamp, nonce }, "Binance webhook signature invalid");
    }
    return isValid;
  } catch (err) {
    logger.error({ err }, "Error verifying Binance webhook signature");
    return false;
  }
}

export async function testBinancePayConnection(apiKey: string, apiSecret: string): Promise<{ success: boolean; error?: string }> {
  try {
    await createBinancePayOrder({
      apiKey,
      apiSecret,
      merchantTradeNo: `TEST${Date.now()}`,
      orderAmount: "0.01",
      goodsName: "Connection Test",
      goodsId: "test",
    });
    return { success: true };
  } catch (err) {
    const msg = (err as Error).message ?? "Unknown error";
    if (msg.includes("TOO_SMALL_AMOUNT") || msg.includes("MINIMUM_ORDER") || msg.includes("ORDER_AMOUNT")) {
      return { success: true };
    }
    return { success: false, error: msg };
  }
}
