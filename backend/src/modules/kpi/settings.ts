import { kpi_settings } from "backend/drizzle/schema";
import { sql } from "drizzle-orm";
import type { DbLike } from "./access";
import { KpiError } from "./errors";
import { DEFAULT_SETTINGS, validateSettingsPatch, type KpiSettings } from "./rules";

// Значения по умолчанию плюс строки kpi_settings; чужие ключи и значения не того типа пропускаем.
export async function loadSettings(db: DbLike): Promise<KpiSettings> {
  const rows = await db.select({ key: kpi_settings.key, value: kpi_settings.value }).from(kpi_settings);
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) {
    if (r.key in DEFAULT_SETTINGS && typeof r.value === typeof (DEFAULT_SETTINGS as any)[r.key]) out[r.key] = r.value;
  }
  return out as unknown as KpiSettings;
}

export async function saveSettings(db: DbLike, patch: Partial<KpiSettings>, userId: string): Promise<KpiSettings> {
  // Сначала ключи, типы и диапазоны самого патча, затем связь дней на объединении.
  const bad = validateSettingsPatch(patch as Record<string, unknown>);
  if (bad) throw new KpiError(422, bad);
  const current = await loadSettings(db);
  const bad2 = validateSettingsPatch({ ...current, ...patch });
  if (bad2) throw new KpiError(422, bad2);
  for (const [key, value] of Object.entries(patch)) {
    await db
      .insert(kpi_settings)
      .values({ key, value, updated_by: userId })
      .onConflictDoUpdate({
        target: kpi_settings.key,
        set: { value, updated_by: userId, updated_at: sql`now()` },
      });
  }
  return loadSettings(db);
}
