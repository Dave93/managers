// Показатели и настройки балла филиала (спека 7.7). Общие настройки KPI (settings.ts) этих ключей не знают.
import type { DrizzleDB } from "@backend/lib/db";
import { kpi_branch_indicators, kpi_settings } from "backend/drizzle/schema";
import { asc, eq, sql } from "drizzle-orm";
import type { DbLike } from "./access";
import { DEFAULT_BRANCH_SETTINGS, validateBranchSettingsPatch, validateIndicators } from "./branch-rules";
import { KpiError } from "./errors";
import type { BranchConfig, BranchIndicator, BranchIndicatorCode, BranchSettings } from "./types";

export const BRANCH_SETTING_KEYS = Object.keys(DEFAULT_BRANCH_SETTINGS) as (keyof BranchSettings)[];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export async function loadIndicators(db: DbLike): Promise<BranchIndicator[]> {
  const rows = await db.select().from(kpi_branch_indicators).orderBy(asc(kpi_branch_indicators.sort));
  return rows.map((r) => ({
    code: r.code as BranchIndicatorCode,
    title_ru: r.title_ru,
    weight: r.weight,
    floor: Number(r.floor),
    target: Number(r.target),
    max: Number(r.max),
    direction: r.direction as BranchIndicator["direction"],
    active: r.active,
    sort: r.sort,
  }));
}

// Значения по умолчанию плюс строки kpi_settings с нашими ключами; значение не того вида пропускаем.
export async function loadBranchSettings(db: DbLike): Promise<BranchSettings> {
  const rows = await db.select({ key: kpi_settings.key, value: kpi_settings.value }).from(kpi_settings);
  const out: Record<string, unknown> = { ...DEFAULT_BRANCH_SETTINGS };
  for (const r of rows) {
    if ((BRANCH_SETTING_KEYS as string[]).includes(r.key) && validateBranchSettingsPatch({ [r.key]: r.value }) === null) {
      out[r.key] = r.value;
    }
  }
  return out as unknown as BranchSettings;
}

export async function loadBranchConfig(db: DbLike): Promise<BranchConfig> {
  return { indicators: await loadIndicators(db), settings: await loadBranchSettings(db) };
}

// Показатели и настройки одним вызовом. Лок на всю транзакцию: два HR не перемешают правки.
export async function saveBranchConfig(db: DrizzleDB, body: Record<string, unknown>, userId: string): Promise<BranchConfig> {
  const { indicators, settings } = body;
  if (indicators === undefined && settings === undefined) throw new KpiError(422, "invalid_input");
  if (settings !== undefined && !isObj(settings)) throw new KpiError(422, "invalid_input");
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('kpi_branch_config'))`);
    if (indicators !== undefined) {
      const v = validateIndicators(indicators, await loadIndicators(tx));
      if ("error" in v) throw new KpiError(422, v.error, v.extra);
      for (const i of v.ok) {
        await tx
          .update(kpi_branch_indicators)
          .set({
            weight: i.weight,
            floor: String(i.floor),
            target: String(i.target),
            max: String(i.max),
            active: i.active,
            updated_by: userId,
            updated_at: sql`now()`,
          })
          .where(eq(kpi_branch_indicators.code, i.code));
      }
    }
    if (settings !== undefined) {
      const patch = settings as Record<string, unknown>;
      const bad = validateBranchSettingsPatch(patch);
      if (bad) throw new KpiError(422, bad);
      for (const [key, raw] of Object.entries(patch)) {
        const value = key === "sanitary_items" ? (raw as string[]).map((s) => s.trim()) : raw;
        await tx
          .insert(kpi_settings)
          .values({ key, value, updated_by: userId })
          .onConflictDoUpdate({ target: kpi_settings.key, set: { value, updated_by: userId, updated_at: sql`now()` } });
      }
    }
    return loadBranchConfig(tx);
  });
}
