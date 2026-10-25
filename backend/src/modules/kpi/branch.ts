// Балл филиала за месяц (спека 7.7): расчёт новой версии, «Сеть» и разбор филиала.
// Версии не перезаписываются: расчёт только добавляет, чтение берёт последнюю.
import type { DrizzleDB } from "@backend/lib/db";
import { kpi_branch_results, kpi_branch_scores, terminals } from "backend/drizzle/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { seesNetwork, viewsTerminal, type Actor, type DbLike } from "./access";
import {
  attendanceByTerminal,
  plansByTerminal,
  reconciliationsByStores,
  revenueByGroups,
  sanitaryByTerminal,
  serviceByGroups,
  sumOver,
  terminalLinks,
} from "./branch-facts";
import { nextTier, scoreTerminal, terminalFacts, type TerminalInputs } from "./branch-rules";
import { loadBranchSettings, loadIndicators } from "./branch-settings";
import { now } from "./clock";
import { terminalNames } from "./directory";
import { UUID_RE } from "./employees";
import { KpiError } from "./errors";
import { iso } from "./iso";
import { checksFor } from "./sanitary";
import { periodOf, type Period } from "./time";
import type {
  BranchBreakdown,
  BranchCell,
  BranchComputeResult,
  BranchIndicatorCode,
  BranchIndicatorResult,
  BranchNetwork,
  BranchScoreRow,
  NoDataReason,
} from "./types";

const INSERT_CHUNK = 500;

export async function latestVersion(db: DbLike, period: Period): Promise<number | null> {
  const [r] = await db
    .select({ v: sql<number | null>`max(${kpi_branch_scores.version})` })
    .from(kpi_branch_scores)
    .where(eq(kpi_branch_scores.period, period));
  return r?.v === null || r?.v === undefined ? null : Number(r.v);
}

// Время расчёта версии (одно на все строки версии)
async function versionComputedAt(db: DbLike, period: Period, version: number): Promise<string | null> {
  const [r] = await db
    .select({ at: kpi_branch_scores.computed_at })
    .from(kpi_branch_scores)
    .where(and(eq(kpi_branch_scores.period, period), eq(kpi_branch_scores.version, version)))
    .limit(1);
  return r ? iso(r.at) : null;
}

// Новая версия за месяц. Набор филиалов строится из данных (решение 7), не из terminals.
export async function computeBranch(db: DrizzleDB, actor: Actor, period: Period): Promise<BranchComputeResult> {
  const nowTs = now();
  if (period > periodOf(nowTs)) throw new KpiError(422, "future_period");

  return db.transaction(async (tx) => {
    // Первым: два одновременных расчёта идут по очереди и получают разные версии
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"kpi_branch:" + period}))`);
    // Время расчёта берём после лока: у более поздней версии оно не меньше, чем у ранней
    const computedAt = now().toISOString();

    const indicators = await loadIndicators(tx);
    if (!indicators.some((i) => i.active)) throw new KpiError(409, "no_indicators");
    const settings = await loadBranchSettings(tx);

    // Источники читаются пачкой, по одному запросу на источник
    const links = await terminalLinks(tx);
    const plans = await plansByTerminal(tx, period);
    const sanitary = await sanitaryByTerminal(tx, period);
    const attendance = await attendanceByTerminal(tx, period);
    const ids = new Set<string>([...links.keys(), ...plans.keys(), ...sanitary.keys(), ...attendance.keys()]);

    const groups = [...links.values()].flatMap((l) => l.iiko);
    const stores = [...links.values()].flatMap((l) => l.stores);
    const norms = { hall_min: settings.service_norm_hall_min, delivery_min: settings.service_norm_delivery_min };
    const revenue = await revenueByGroups(tx, groups, period);
    const service = await serviceByGroups(tx, groups, period, norms);
    const recons = await reconciliationsByStores(tx, stores, period);

    const scored: { id: string; res: ReturnType<typeof scoreTerminal> }[] = [];
    for (const id of [...ids].sort()) {
      const l = links.get(id) ?? { iiko: [], stores: [] };
      const sv = { orders: 0, on_time: 0 };
      for (const g of new Set(l.iiko)) {
        const x = service.get(g);
        if (x) {
          sv.orders += x.orders;
          sv.on_time += x.on_time;
        }
      }
      const san = sanitary.get(id);
      const input: TerminalInputs = {
        has_iiko: l.iiko.length > 0,
        has_store: l.stores.length > 0,
        revenue: sumOver(l.iiko, revenue),
        plan: plans.get(id) ?? null,
        stores_total: l.stores.length,
        recons: l.stores.flatMap((s) => {
          const r = recons.get(s);
          return r ? [r] : [];
        }),
        service: { ...sv, ...norms },
        sanitary: { checks: san?.checks ?? 0, avg: san?.avg ?? null },
        attendance: attendance.get(id) ?? { days: 0, on_time: 0, late: 0, absent: 0 },
      };
      const res = scoreTerminal(indicators, terminalFacts(input));
      // Ни одного показателя с данными: филиала в версии нет, нуля вместо «нет данных» не бывает
      if (res.score === null) continue;
      scored.push({ id, res });
    }

    if (scored.length === 0) return { period, version: null, terminals: 0, computed_at: computedAt };

    const [{ v }] = await tx
      .select({ v: sql<number | null>`max(${kpi_branch_scores.version})` })
      .from(kpi_branch_scores)
      .where(eq(kpi_branch_scores.period, period));
    const version = Number(v ?? 0) + 1;
    const byCode = new Map(indicators.map((i) => [i.code, i]));

    const resultRows = scored.flatMap(({ id, res }) =>
      res.rows.map((r) => {
        const ind = byCode.get(r.code)!;
        return {
          period,
          terminal_id: id,
          indicator_code: r.code,
          version,
          fact: r.fact === null ? null : String(r.fact),
          points: r.points === null ? null : String(r.points),
          weight: ind.weight,
          weighted: r.weighted === null ? null : String(r.weighted),
          floor: String(ind.floor),
          target: String(ind.target),
          max: String(ind.max),
          direction: ind.direction,
          data_status: r.data_status,
          reason: r.reason,
          details: r.details,
          computed_at: computedAt,
          computed_by: actor.userId,
        };
      })
    );
    for (let i = 0; i < resultRows.length; i += INSERT_CHUNK) {
      await tx.insert(kpi_branch_results).values(resultRows.slice(i, i + INSERT_CHUNK));
    }
    const scoreRows = scored.map(({ id, res }) => ({
      period,
      terminal_id: id,
      version,
      score: String(res.score),
      tier_pct: res.tier_pct as number,
      computed_at: computedAt,
      computed_by: actor.userId,
    }));
    for (let i = 0; i < scoreRows.length; i += INSERT_CHUNK) {
      await tx.insert(kpi_branch_scores).values(scoreRows.slice(i, i + INSERT_CHUNK));
    }
    return { period, version, terminals: scored.length, computed_at: computedAt };
  });
}

// «Сеть»: последняя версия, филиалы, видимые актору. Балл по убыванию, затем имя.
export async function branchNetwork(db: DbLike, actor: Actor, period: Period): Promise<BranchNetwork> {
  const indicators = (await loadIndicators(db)).filter((i) => i.active);
  const version = await latestVersion(db, period);
  if (version === null) return { period, version: null, computed_at: null, indicators, rows: [] };

  const computed_at = await versionComputedAt(db, period, version);
  // Не вся сеть: читаем строки только видимых филиалов
  const all = seesNetwork(actor);
  const scope = all ? undefined : [...new Set(actor.terminals.filter((t) => UUID_RE.test(t)).map((t) => t.toLowerCase()))];
  if (scope && scope.length === 0) return { period, version, computed_at, indicators, rows: [] };
  const scores = await db
    .select()
    .from(kpi_branch_scores)
    .where(and(eq(kpi_branch_scores.period, period), eq(kpi_branch_scores.version, version), scope ? inArray(kpi_branch_scores.terminal_id, scope) : undefined));
  const visible = scores.filter((s) => viewsTerminal(actor, s.terminal_id));
  if (visible.length === 0) return { period, version, computed_at, indicators, rows: [] };

  const results = await db
    .select({
      terminal_id: kpi_branch_results.terminal_id,
      code: kpi_branch_results.indicator_code,
      fact: kpi_branch_results.fact,
      points: kpi_branch_results.points,
      data_status: kpi_branch_results.data_status,
    })
    .from(kpi_branch_results)
    .where(
      and(
        eq(kpi_branch_results.period, period),
        eq(kpi_branch_results.version, version),
        scope ? inArray(kpi_branch_results.terminal_id, visible.map((s) => s.terminal_id)) : undefined
      )
    );
  const cells = new Map<string, Partial<Record<BranchIndicatorCode, BranchCell>>>();
  for (const r of results) {
    const m = cells.get(r.terminal_id) ?? {};
    m[r.code as BranchIndicatorCode] = {
      fact: r.fact === null ? null : Number(r.fact),
      points: r.points === null ? null : Number(r.points),
      data_status: r.data_status as BranchCell["data_status"],
    };
    cells.set(r.terminal_id, m);
  }
  const names = await terminalNames(db, visible.map((s) => s.terminal_id));
  const rows: BranchScoreRow[] = visible
    .map((s) => ({
      terminal_id: s.terminal_id,
      terminal_name: names.get(s.terminal_id) ?? null,
      score: Number(s.score),
      tier_pct: s.tier_pct,
      cells: cells.get(s.terminal_id) ?? {},
    }))
    .sort((a, b) => b.score - a.score || (a.terminal_name ?? "").localeCompare(b.terminal_name ?? "", "ru"));
  return { period, version, computed_at, indicators, rows };
}

// «Филиал»: разбор по показателям последней версии
export async function branchBreakdown(db: DbLike, actor: Actor, terminalId: string, period: Period): Promise<BranchBreakdown> {
  if (!UUID_RE.test(terminalId)) throw new KpiError(404, "not_found");
  const id = terminalId.toLowerCase();
  if (!viewsTerminal(actor, id)) throw new KpiError(403, "out_of_scope");

  const current = await loadIndicators(db);
  const sortOf = new Map(current.map((i) => [i.code as string, i]));
  const version = await latestVersion(db, period);
  const computed_at = version === null ? null : await versionComputedAt(db, period, version);
  const [t] = await db.select({ name: terminals.name }).from(terminals).where(eq(terminals.id, id)).limit(1);
  const base = { period, terminal_id: id, terminal_name: t?.name ?? null, version, computed_at };
  const sanitary_checks = await checksFor(db, id, period);

  const [scoreRow] =
    version === null
      ? []
      : await db
          .select()
          .from(kpi_branch_scores)
          .where(and(eq(kpi_branch_scores.period, period), eq(kpi_branch_scores.terminal_id, id), eq(kpi_branch_scores.version, version)));
  const rows =
    version === null || !scoreRow
      ? []
      : await db
          .select()
          .from(kpi_branch_results)
          .where(and(eq(kpi_branch_results.period, period), eq(kpi_branch_results.terminal_id, id), eq(kpi_branch_results.version, version)));

  if (!scoreRow || rows.length === 0) {
    const indicators: BranchIndicatorResult[] = current
      .filter((i) => i.active)
      .map((i) => ({
        code: i.code,
        title_ru: i.title_ru,
        direction: i.direction,
        weight: i.weight,
        floor: i.floor,
        target: i.target,
        max: i.max,
        fact: null,
        points: null,
        weighted: null,
        data_status: "no_data" as const,
        reason: "not_computed" as NoDataReason,
        details: {},
      }));
    return { ...base, score: null, tier_pct: null, next_tier: null, indicators, sanitary_checks };
  }

  const indicators: BranchIndicatorResult[] = rows
    .map((r) => ({
      code: r.indicator_code as BranchIndicatorCode,
      title_ru: sortOf.get(r.indicator_code)?.title_ru ?? r.indicator_code,
      direction: r.direction as BranchIndicatorResult["direction"],
      weight: r.weight,
      floor: Number(r.floor),
      target: Number(r.target),
      max: Number(r.max),
      fact: r.fact === null ? null : Number(r.fact),
      points: r.points === null ? null : Number(r.points),
      weighted: r.weighted === null ? null : Number(r.weighted),
      data_status: r.data_status as BranchIndicatorResult["data_status"],
      reason: r.reason as NoDataReason | null,
      details: r.details as Record<string, number | null>,
    }))
    .sort((a, b) => (sortOf.get(a.code)?.sort ?? 999) - (sortOf.get(b.code)?.sort ?? 999));
  const score = Number(scoreRow.score);
  return { ...base, score, tier_pct: scoreRow.tier_pct, next_tier: nextTier(score), indicators, sanitary_checks };
}
