import { sql } from "drizzle-orm";
import type { DbLike } from "./access";

// Единый источник «сейчас» для бизнес-логики KPI. Подмена времени работает
// только в тестовом окружении, в проде KPI_FAKE_NOW игнорируется.
export function now(): Date {
  const fake = process.env.KPI_FAKE_NOW;
  if (process.env.PROJECT_PREFIX === "managers_test_" && fake) return new Date(fake);
  return new Date();
}

// Метка «сейчас» по часам базы (clock_timestamp), для сравнения с created_at/updated_at строк:
// их ставит база, и часы приложения с ней расходятся. В тестах подмена KPI_FAKE_NOW сохраняется.
export async function dbNow(db: DbLike): Promise<Date> {
  const fake = now();
  if (process.env.PROJECT_PREFIX === "managers_test_" && process.env.KPI_FAKE_NOW) return fake;
  const res = await db.execute(sql`select (extract(epoch from clock_timestamp()) * 1000)::float8 as ms`);
  return new Date(Number((res.rows[0] as { ms: number }).ms));
}
