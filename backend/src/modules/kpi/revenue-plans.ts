// План выручки филиалов на месяц и подсказка «от прошлого года» (спека 7.7, решение плана 13).
import type { DrizzleDB } from "@backend/lib/db";
import { kpi_revenue_plans, terminals } from "backend/drizzle/schema";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { parsePeriod, type DbLike } from "./access";
import { revenueByGroups, sumOver, terminalLinks } from "./branch-facts";
import { planSuggestion } from "./branch-rules";
import { UUID_RE } from "./employees";
import { KpiError } from "./errors";
import { iso } from "./iso";
import { lockPeriodShared } from "./periods";
import { addMonths, type Period } from "./time";
import type { RevenuePlanRow, RevenueSuggestRow } from "./types";

const MAX_ITEMS = 500;
const MAX_AMOUNT = 1e12;

// Активные филиалы плюс закрытые, у которых есть план за месяц. Порядок по названию.
async function listedTerminals(db: DbLike, period: Period): Promise<{ id: string; name: string }[]> {
  const withPlan = db.select({ id: kpi_revenue_plans.terminal_id }).from(kpi_revenue_plans).where(eq(kpi_revenue_plans.period, period));
  const planIds = (await withPlan).map((r) => r.id);
  return db
    .select({ id: terminals.id, name: terminals.name })
    .from(terminals)
    .where(planIds.length ? or(eq(terminals.active, true), inArray(terminals.id, planIds)) : eq(terminals.active, true))
    .orderBy(terminals.name);
}

export async function listPlans(db: DbLike, period: Period): Promise<RevenuePlanRow[]> {
  const list = await listedTerminals(db, period);
  if (list.length === 0) return [];
  const ids = list.map((t) => t.id);
  const plans = await db
    .select({ terminal_id: kpi_revenue_plans.terminal_id, amount: kpi_revenue_plans.amount, updated_at: kpi_revenue_plans.updated_at })
    .from(kpi_revenue_plans)
    .where(and(eq(kpi_revenue_plans.period, period), inArray(kpi_revenue_plans.terminal_id, ids)));
  const byTerminal = new Map(plans.map((p) => [p.terminal_id, p]));
  const links = await terminalLinks(db, ids);
  return list.map((t) => {
    const p = byTerminal.get(t.id);
    return {
      terminal_id: t.id,
      terminal_name: t.name,
      amount: p ? Number(p.amount) : null,
      has_iiko: (links.get(t.id)?.iiko.length ?? 0) > 0,
      updated_at: p ? iso(p.updated_at) : null,
    };
  });
}

// Замена по присланным филиалам: null удаляет план, число — upsert. Остальные не трогаем.
export async function savePlans(db: DrizzleDB, userId: string, body: Record<string, unknown>): Promise<RevenuePlanRow[]> {
  const period = parsePeriod(body.period);
  const items = body.items;
  if (!Array.isArray(items)) throw new KpiError(422, "invalid_input");
  if (items.length > MAX_ITEMS) throw new KpiError(422, "too_many_items");

  const seen = new Set<string>();
  const parsed: { terminal_id: string; amount: number | null }[] = [];
  for (const raw of items) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new KpiError(422, "invalid_input");
    const { terminal_id, amount } = raw as Record<string, unknown>;
    if (typeof terminal_id !== "string" || !UUID_RE.test(terminal_id)) {
      throw new KpiError(422, "unknown_terminal", { terminal_id: terminal_id ?? null });
    }
    const id = terminal_id.toLowerCase();
    if (seen.has(id)) throw new KpiError(422, "duplicate_terminal", { terminal_id });
    seen.add(id);
    if (amount !== null && !(typeof amount === "number" && Number.isSafeInteger(amount) && amount >= 1 && amount <= MAX_AMOUNT)) {
      throw new KpiError(422, "bad_amount", { terminal_id });
    }
    parsed.push({ terminal_id: id, amount: amount as number | null });
  }
  // Единый порядок записи: параллельные PUT не ловят взаимную блокировку
  parsed.sort((a, b) => (a.terminal_id < b.terminal_id ? -1 : 1));

  return db.transaction(async (tx) => {
    // Закрытый месяц KPI заморожен и для плана (R7); закрытие ждёт конца записи
    if (await lockPeriodShared(tx, period)) throw new KpiError(409, "period_closed");
    if (parsed.length) {
      const known = new Set(
        (await tx.select({ id: terminals.id }).from(terminals).where(inArray(terminals.id, parsed.map((p) => p.terminal_id)))).map((r) => r.id)
      );
      for (const p of parsed) if (!known.has(p.terminal_id)) throw new KpiError(422, "unknown_terminal", { terminal_id: p.terminal_id });
    }
    for (const p of parsed) {
      if (p.amount === null) {
        await tx.delete(kpi_revenue_plans).where(and(eq(kpi_revenue_plans.terminal_id, p.terminal_id), eq(kpi_revenue_plans.period, period)));
        continue;
      }
      await tx
        .insert(kpi_revenue_plans)
        .values({ terminal_id: p.terminal_id, period, amount: String(p.amount), updated_by: userId })
        .onConflictDoUpdate({
          target: [kpi_revenue_plans.terminal_id, kpi_revenue_plans.period],
          set: { amount: String(p.amount), updated_by: userId, updated_at: sql`now()` },
        });
    }
    return listPlans(tx, period);
  });
}

// Выручка того же месяца год назад × (1 + рост/100), округление до 1 000 сум.
export async function suggestPlans(db: DbLike, period: Period, growthRaw: unknown): Promise<RevenueSuggestRow[]> {
  const g = typeof growthRaw === "string" && growthRaw.trim() !== "" ? Number(growthRaw) : Number.NaN;
  if (!Number.isFinite(g) || g < -50 || g > 200) throw new KpiError(422, "bad_growth");
  const base = addMonths(period, -12);
  const list = await listedTerminals(db, period);
  const links = await terminalLinks(db, list.map((t) => t.id));
  const groups = list.flatMap((t) => links.get(t.id)?.iiko ?? []);
  const revenue = await revenueByGroups(db, groups, base);
  return list.map((t) => {
    const keys = links.get(t.id)?.iiko ?? [];
    const sum = keys.length ? sumOver(keys, revenue) : 0;
    const baseRevenue = sum > 0 ? sum : null;
    return { terminal_id: t.id, base_period: base, base_revenue: baseRevenue, suggested: planSuggestion(baseRevenue, g) };
  });
}
