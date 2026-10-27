// Балл филиала за месяц (спека 7.7): расчёт новой версии, «Сеть» и разбор филиала.
// Версии не перезаписываются: расчёт только добавляет, чтение берёт последнюю.
import type { DrizzleDB } from "@backend/lib/db";
import {
  inventory_reconciliations,
  kpi_attendance_imports,
  kpi_branch_results,
  kpi_branch_scores,
  kpi_revenue_plans,
  kpi_sanitary_checks,
  terminals,
} from "backend/drizzle/schema";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
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
import {
  BRANCH_SOURCE_INDICATOR,
  branchSuggestion,
  inputsNewerThanVersion,
  isPreliminary,
  monthLastDay,
  nextTier,
  scoreTerminal,
  terminalFacts,
  versionColumns,
  type BranchSource,
  type TerminalInputs,
} from "./branch-rules";
import { loadBranchSettings, loadIndicators } from "./branch-settings";
import { dbNow, now } from "./clock";
import { terminalNames } from "./directory";
import { UUID_RE } from "./employees";
import { KpiError } from "./errors";
import { iso } from "./iso";
import { isPeriodClosed, lockPeriodShared } from "./periods";
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

// Последняя версия месяца и время её расчёта (одно на все строки версии), одним запросом.
// preliminary: версия посчитана до конца месяца.
async function latestVersionInfo(
  db: DbLike,
  period: Period
): Promise<{ version: number | null; computed_at: string | null; preliminary: boolean }> {
  const [r] = await db
    .select({ v: kpi_branch_scores.version, at: kpi_branch_scores.computed_at })
    .from(kpi_branch_scores)
    .where(eq(kpi_branch_scores.period, period))
    .orderBy(desc(kpi_branch_scores.version))
    .limit(1);
  if (!r) return { version: null, computed_at: null, preliminary: false };
  const computed_at = iso(r.at);
  return { version: Number(r.v), computed_at, preliminary: computed_at !== null && isPreliminary(period, computed_at) };
}

// Есть ли за месяц ввод новее последней версии (пометка «Есть новые данные»). Читаем то, что берёт расчёт
// из наших таблиц: санитарные проверки, планы, импорт посещаемости, решения по сверкам склада (себестоимость).
// Продажи и сервис идут из iiko, их не смотрим.
// terminalIds: проверки, планы и сверки только этих филиалов; импорт посещаемости один на месяц.
// Сверка: reviewed_at ставится при каждой смене статуса, в том числе при снятии «принято», а расчёт читает именно статус.
async function inputsNewer(db: DbLike, period: Period, computedAt: string | null, terminalIds?: string[]): Promise<boolean> {
  if (computedAt === null) return false;
  const closed = await isPeriodClosed(db, period);
  if (closed) return false;
  const san = kpi_sanitary_checks;
  const plans = kpi_revenue_plans;
  const stores = [...(await terminalLinks(db, terminalIds)).values()].flatMap((l) => l.stores);
  const [[s], [p], [a], [r]] = await Promise.all([
    db
      .select({ at: sql<string | null>`max(${san.created_at})` })
      .from(san)
      .where(and(eq(san.period, period), terminalIds ? inArray(san.terminal_id, terminalIds) : undefined)),
    db
      .select({ at: sql<string | null>`max(${plans.updated_at})` })
      .from(plans)
      .where(and(eq(plans.period, period), terminalIds ? inArray(plans.terminal_id, terminalIds) : undefined)),
    db
      .select({ at: sql<string | null>`max(${kpi_attendance_imports.created_at})` })
      .from(kpi_attendance_imports)
      .where(eq(kpi_attendance_imports.period, period)),
    stores.length === 0
      ? Promise.resolve([{ at: null as string | null }])
      : db
          .select({ at: sql<string | null>`max(${inventory_reconciliations.reviewed_at})` })
          .from(inventory_reconciliations)
          .where(
            and(
              inArray(inventory_reconciliations.store_id, stores),
              eq(inventory_reconciliations.period, monthLastDay(period))
            )
          ),
  ]);
  return inputsNewerThanVersion({ closed, computedAt, inputTimes: [s?.at, p?.at, a?.at, r?.at] });
}

// Новая версия за месяц. Набор филиалов строится из данных (решение 7), не из terminals.
export async function computeBranch(db: DrizzleDB, actor: Actor, period: Period): Promise<BranchComputeResult> {
  const nowTs = now();
  if (period > periodOf(nowTs)) throw new KpiError(422, "future_period");

  return db.transaction(async (tx) => {
    // Первым: два одновременных расчёта идут по очереди и получают разные версии
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"kpi_branch:" + period}))`);
    // Закрытый месяц KPI заморожен и для балла филиала (R7). До любых проверок и раннего выхода:
    // пустой закрытый месяц тоже 409, а закрытие ждёт конца расчёта
    if (await lockPeriodShared(tx, period)) throw new KpiError(409, "period_closed");
    // Время расчёта берём после лока и по часам базы: у более поздней версии оно не меньше, чем у ранней,
    // а created_at проверок и планов (их ставит база) сравнивается с ним без расхождения часов.
    // Проверка, заведённая до этой метки, дошла до чтения источников ниже и пометки не даёт.
    const computedAt = (await dbNow(tx)).toISOString();

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
// Колонки — коды показателей из строк версии, а не текущие активные показатели.
export async function branchNetwork(db: DbLike, actor: Actor, period: Period): Promise<BranchNetwork> {
  const current = await loadIndicators(db);
  const indicators = current.filter((i) => i.active);
  const { version, computed_at, preliminary } = await latestVersionInfo(db, period);
  const empty: BranchNetwork = { period, version, computed_at, preliminary, inputs_newer: false, indicators, columns: [], rows: [] };
  if (version === null) return empty;

  // Не вся сеть: читаем строки только видимых филиалов
  const all = seesNetwork(actor);
  const scope = all ? undefined : [...new Set(actor.terminals.filter((t) => UUID_RE.test(t)).map((t) => t.toLowerCase()))];
  if (scope && scope.length === 0) return empty;
  const inputs_newer = await inputsNewer(db, period, computed_at, scope);
  const scores = await db
    .select()
    .from(kpi_branch_scores)
    .where(and(eq(kpi_branch_scores.period, period), eq(kpi_branch_scores.version, version), scope ? inArray(kpi_branch_scores.terminal_id, scope) : undefined));
  const visible = scores.filter((s) => viewsTerminal(actor, s.terminal_id));
  if (visible.length === 0) return { ...empty, inputs_newer };

  const results = await db
    .select({
      terminal_id: kpi_branch_results.terminal_id,
      code: kpi_branch_results.indicator_code,
      fact: kpi_branch_results.fact,
      points: kpi_branch_results.points,
      weight: kpi_branch_results.weight,
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
      weight: r.weight,
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
  return { ...empty, inputs_newer, columns: versionColumns(results.map((r) => r.code), current), rows };
}

// «Филиал»: разбор по показателям последней версии
export async function branchBreakdown(db: DbLike, actor: Actor, terminalId: string, period: Period): Promise<BranchBreakdown> {
  if (!UUID_RE.test(terminalId)) throw new KpiError(404, "not_found");
  const id = terminalId.toLowerCase();
  if (!viewsTerminal(actor, id)) throw new KpiError(403, "out_of_scope");

  const current = await loadIndicators(db);
  const sortOf = new Map(current.map((i) => [i.code as string, i]));
  const { version, computed_at, preliminary } = await latestVersionInfo(db, period);
  const [t] = await db.select({ name: terminals.name }).from(terminals).where(eq(terminals.id, id)).limit(1);
  const inputs_newer = await inputsNewer(db, period, computed_at, [id]);
  const base = { period, terminal_id: id, terminal_name: t?.name ?? null, version, computed_at, preliminary, inputs_newer };
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

// Снимок предложения в auto_value отправленной оценки
export type BranchAutoValue = {
  source: BranchSource;
  indicator: BranchIndicatorCode;
  terminal_id: string;
  version: number;
  fact: number;
  points: number;
  score: number;
  basis: string;
};

// Предложения автопунктов формы оценки (решение 14): последняя версия по филиалу,
// один запрос на форму. Показатель без данных или версии нет — предложения нет, к старым версиям не откатываемся.
// Предварительная версия (посчитана до конца месяца) не предлагает ничего: продажи к месячному плану
// занижены, и форма не должна получить 0 из неполного месяца.
export async function branchSuggestions(
  db: DbLike,
  terminalId: string,
  period: Period
): Promise<Map<BranchSource, { score: number; basis: string; auto_value: BranchAutoValue }>> {
  const out = new Map<BranchSource, { score: number; basis: string; auto_value: BranchAutoValue }>();
  if (!UUID_RE.test(terminalId)) return out;
  const { version, preliminary } = await latestVersionInfo(db, period);
  if (version === null || preliminary) return out;
  const id = terminalId.toLowerCase();
  const indicators = Object.values(BRANCH_SOURCE_INDICATOR);
  const rows = await db
    .select({ code: kpi_branch_results.indicator_code, fact: kpi_branch_results.fact, points: kpi_branch_results.points })
    .from(kpi_branch_results)
    .where(
      and(
        eq(kpi_branch_results.period, period),
        eq(kpi_branch_results.version, version),
        eq(kpi_branch_results.terminal_id, id),
        inArray(kpi_branch_results.indicator_code, indicators),
        eq(kpi_branch_results.data_status, "ok")
      )
    );
  for (const source of Object.keys(BRANCH_SOURCE_INDICATOR) as BranchSource[]) {
    const indicator = BRANCH_SOURCE_INDICATOR[source];
    const r = rows.find((x) => x.code === indicator);
    if (!r || r.fact === null || r.points === null) continue;
    const fact = Number(r.fact);
    const points = Number(r.points);
    if (!Number.isFinite(fact) || !Number.isFinite(points)) continue;
    const s = branchSuggestion(source, { fact, points });
    out.set(source, { ...s, auto_value: { source, indicator, terminal_id: id, version, fact, points, ...s } });
  }
  return out;
}
