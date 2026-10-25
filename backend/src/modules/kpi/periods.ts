import { kpi_periods } from "backend/drizzle/schema";
import { and, eq } from "drizzle-orm";
import type { DbLike } from "./access";
import type { Period } from "./time";

// Месяц закрыт, если есть строка kpi_periods со статусом closed.
export async function isPeriodClosed(db: DbLike, period: Period): Promise<boolean> {
  const rows = await db
    .select({ period: kpi_periods.period })
    .from(kpi_periods)
    .where(and(eq(kpi_periods.period, period), eq(kpi_periods.status, "closed")))
    .limit(1);
  return rows.length > 0;
}
