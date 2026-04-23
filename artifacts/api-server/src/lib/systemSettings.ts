import { db, systemSettingsTable } from "@workspace/db";
import { desc } from "drizzle-orm";

export const DEFAULT_MAX_RETRY_COUNT = 10;
export const DEFAULT_MAX_ORDER_AGE_DAYS = 7;
export const DEFAULT_STOCK_REQUEST_WINDOW_HOURS = 24;

export async function getOrCreateSystemSettings() {
  const [existing] = await db
    .select()
    .from(systemSettingsTable)
    .orderBy(desc(systemSettingsTable.id))
    .limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(systemSettingsTable)
    .values({
      maxRetryCount: DEFAULT_MAX_RETRY_COUNT,
      maxOrderAgeDays: DEFAULT_MAX_ORDER_AGE_DAYS,
      stockRequestWindowHours: DEFAULT_STOCK_REQUEST_WINDOW_HOURS,
    })
    .returning();
  return created;
}
