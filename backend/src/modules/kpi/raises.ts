import type { DrizzleDB } from "@backend/lib/db";
import {
  kpi_cards,
  kpi_raise_decisions,
  kpi_raise_tiers,
  kpi_reviews,
} from "backend/drizzle/schema";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { has, seesNetwork, type Actor, type DbLike } from "./access";
import { now } from "./clock";
import { loadDirectory, terminalNames, userNames } from "./directory";
import { UUID_RE } from "./employees";
import { KpiError } from "./errors";
import { enqueue } from "./notify";
import { isPeriodClosed } from "./periods";
import { commentOk, quarterRow, validateTiers, type Tier } from "./rules";
import { loadSettings } from "./settings";
import { isQuarterStart, quarterMonths, type Period } from "./time";
import type { RaiseRow } from "./types";

type DecisionRow = typeof kpi_raise_decisions.$inferSelect;

const inTx = <T>(db: DbLike, fn: (tx: DbLike) => Promise<T>): Promise<T> =>
  (db as DrizzleDB).transaction((tx) => fn(tx));

const pctStr = (v: number | null): string | null => (v === null ? null : v.toFixed(2));
const numOrNull = (v: string | null): number | null => (v === null ? null : Number(v));

// Квартал — строго первый месяц квартала (01, 04, 07, 10).
export function parseQuarter(v: unknown): Period {
  if (!isQuarterStart(v)) throw new KpiError(422, "bad_quarter");
  return v;
}

// Шкала по убыванию min_pct.
export async function getTiers(db: DbLike): Promise<Tier[]> {
  const rows = await db
    .select({ min_pct: kpi_raise_tiers.min_pct, amount: kpi_raise_tiers.amount })
    .from(kpi_raise_tiers)
    .orderBy(desc(kpi_raise_tiers.min_pct));
  return rows.map((r) => ({ min_pct: Number(r.min_pct), amount: Number(r.amount) }));
}

// Замена шкалы целиком в одной транзакции.
export async function saveTiers(db: DbLike, _actor: Actor, tiers: Tier[]): Promise<Tier[]> {
  return inTx(db, async (tx) => {
    // Два сохранения шкалы подряд не должны перемешать строки.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('kpi_raise_tiers'))`);
    const settings = await loadSettings(tx);
    const bad = validateTiers(tiers, settings.raise_cap);
    if (bad) throw new KpiError(422, bad);
    await tx.delete(kpi_raise_tiers);
    if (tiers.length > 0) {
      await tx.insert(kpi_raise_tiers).values(tiers.map((t) => ({ min_pct: String(t.min_pct), amount: String(t.amount) })));
    }
    return getTiers(tx);
  });
}

// Строки решений в ответ API: имена, карта, признак «все три месяца закрыты».
async function toRaiseRows(db: DbLike, rows: DecisionRow[]): Promise<RaiseRow[]> {
  if (rows.length === 0) return [];
  const dir = await loadDirectory(db, { employeeIds: rows.map((r) => r.employee_id), includeInactive: true });
  const emp = new Map(dir.map((d) => [d.id, d]));
  const tNames = await terminalNames(db, rows.flatMap((r) => (r.terminal_id ? [r.terminal_id] : [])));
  const cardIds = [...new Set(rows.flatMap((r) => (r.card_id ? [r.card_id] : [])))];
  const cardTitles = new Map<string, string>();
  if (cardIds.length) {
    const cs = await db.select({ id: kpi_cards.id, title: kpi_cards.title_ru }).from(kpi_cards).where(inArray(kpi_cards.id, cardIds));
    for (const c of cs) cardTitles.set(c.id, c.title);
  }
  const uNames = await userNames(db, rows.flatMap((r) => (r.decided_by ? [r.decided_by] : [])));
  const closed = new Map<string, boolean>();
  const isClosed = async (p: string) => {
    if (!closed.has(p)) closed.set(p, await isPeriodClosed(db, p));
    return closed.get(p)!;
  };
  const out: RaiseRow[] = [];
  for (const r of rows) {
    const e = emp.get(r.employee_id);
    let all = true;
    for (const p of quarterMonths(r.quarter_start)) if (!(await isClosed(p))) all = false;
    out.push({
      id: r.id,
      quarter_start: r.quarter_start,
      employee_id: r.employee_id,
      employee_name: e ? `${e.first_name} ${e.last_name}`.trim() : r.employee_id,
      terminal_name: r.terminal_id ? (tNames.get(r.terminal_id) ?? null) : null,
      card_title: r.card_id ? (cardTitles.get(r.card_id) ?? null) : null,
      months: r.months as RaiseRow["months"],
      months_scored: r.months_scored,
      avg_pct: numOrNull(r.avg_pct),
      suggested_amount: Number(r.suggested_amount ?? 0),
      status: r.status as RaiseRow["status"],
      approved_amount: numOrNull(r.approved_amount),
      decided_by_name: r.decided_by ? (uNames.get(r.decided_by) ?? null) : null,
      decided_at: r.decided_at,
      comment: r.comment,
      periods_closed: all,
    });
  }
  return out.sort((a, b) => a.employee_name.localeCompare(b.employee_name, "ru") || a.id.localeCompare(b.id));
}

// Только строки, которые actor видит: вся сеть или филиалы из снимка.
export async function listRaises(db: DbLike, actor: Actor, quarter: Period): Promise<RaiseRow[]> {
  parseQuarter(quarter);
  const rows = await db.select().from(kpi_raise_decisions).where(eq(kpi_raise_decisions.quarter_start, quarter));
  const visible = seesNetwork(actor)
    ? rows
    : has(actor, "kpi.view")
      ? rows.filter((r) => r.terminal_id !== null && actor.terminals.includes(r.terminal_id))
      : [];
  return toRaiseRows(db, visible);
}

// Пересчёт: сотрудники с отправленной оценкой в квартале; approved и rejected не трогаем.
export async function computeQuarter(db: DbLike, actor: Actor, quarter: Period): Promise<RaiseRow[]> {
  parseQuarter(quarter);
  const months = quarterMonths(quarter);
  await inTx(db, async (tx) => {
    const settings = await loadSettings(tx);
    const tiers = await getTiers(tx);
    const reviews = await tx
      .select({
        employee_id: kpi_reviews.employee_id,
        period: kpi_reviews.period,
        terminal_id: kpi_reviews.terminal_id,
        card_id: kpi_reviews.card_id,
        score_pct: kpi_reviews.score_pct,
      })
      .from(kpi_reviews)
      .where(and(eq(kpi_reviews.status, "submitted"), inArray(kpi_reviews.period, months)));
    const byEmp = new Map<string, typeof reviews>();
    for (const r of reviews) byEmp.set(r.employee_id, [...(byEmp.get(r.employee_id) ?? []), r]);
    const at = now().toISOString();
    for (const [employee_id, list] of byEmp) {
      const scores = months.map((p) => {
        const r = list.find((x) => x.period === p);
        return { period: p, score_pct: r ? numOrNull(r.score_pct) : null };
      });
      const row = quarterRow(scores.map((s) => s.score_pct), tiers, settings.raise_min_months);
      // Снимок филиала и карты — по последней отправленной оценке квартала.
      const latest = [...list].sort((a, b) => b.period.localeCompare(a.period))[0];
      const values = {
        terminal_id: latest.terminal_id,
        card_id: latest.card_id,
        months: scores,
        months_scored: row.months_scored,
        avg_pct: pctStr(row.avg_pct),
        suggested_amount: String(row.suggested_amount),
        status: row.status,
        computed_at: at,
        updated_at: at,
      };
      await tx
        .insert(kpi_raise_decisions)
        .values({ quarter_start: quarter, employee_id, ...values })
        .onConflictDoUpdate({
          target: [kpi_raise_decisions.quarter_start, kpi_raise_decisions.employee_id],
          set: values,
          setWhere: sql`${kpi_raise_decisions.status} NOT IN ('approved', 'rejected')`,
        });
    }
  });
  return listRaises(db, actor, quarter);
}

export async function decideRaise(
  db: DbLike,
  actor: Actor,
  id: string,
  input: { status: "approved" | "rejected"; amount?: number; comment?: string }
): Promise<RaiseRow> {
  if (!UUID_RE.test(id)) throw new KpiError(404, "not_found");
  if (input.status !== "approved" && input.status !== "rejected") throw new KpiError(422, "bad_status");
  return inTx(db, async (tx) => {
    const [row] = await tx.select().from(kpi_raise_decisions).where(eq(kpi_raise_decisions.id, id)).for("update");
    if (!row) throw new KpiError(404, "not_found");
    for (const p of quarterMonths(row.quarter_start)) {
      if (!(await isPeriodClosed(tx, p))) throw new KpiError(409, "periods_open");
    }
    const settings = await loadSettings(tx);
    const suggested = Number(row.suggested_amount ?? 0);
    let amount: number;
    if (input.status === "rejected") amount = 0;
    else {
      amount = input.amount === undefined || input.amount === null ? suggested : input.amount;
      // Предложение тоже проверяем: потолок могли снизить после настройки шкалы.
      if (!Number.isInteger(amount) || amount < 0 || amount > settings.raise_cap) throw new KpiError(422, "bad_amount");
    }
    const redecided = row.status === "approved" || row.status === "rejected";
    const needComment =
      row.status === "insufficient" ||
      (input.status === "approved" && amount !== suggested) ||
      (input.status === "rejected" && suggested > 0) ||
      redecided;
    if (needComment && !commentOk(input.comment, 1)) throw new KpiError(422, "comment_required");
    const comment = typeof input.comment === "string" && input.comment.trim() !== "" ? input.comment.trim() : null;

    const history = (row.history as unknown[]) ?? [];
    if (redecided) {
      history.push({
        status: row.status,
        approved_amount: numOrNull(row.approved_amount),
        decided_by: row.decided_by,
        decided_at: row.decided_at === null ? null : new Date(row.decided_at).toISOString(),
        comment: row.comment,
      });
    }
    const at = now().toISOString();
    await tx
      .update(kpi_raise_decisions)
      .set({
        status: input.status,
        approved_amount: String(amount),
        decided_by: actor.userId,
        decided_at: at,
        comment,
        history,
        updated_at: at,
      })
      .where(eq(kpi_raise_decisions.id, id));
    const [fresh] = await tx.select().from(kpi_raise_decisions).where(eq(kpi_raise_decisions.id, id));
    if (input.status === "approved") {
      await enqueue(tx, {
        recipient_kind: "employee",
        employee_id: row.employee_id,
        kind: "raise_approved",
        payload: { quarter_start: row.quarter_start, amount, avg_pct: numOrNull(row.avg_pct) },
        dedupe_key: `raise_approved:${id}:${fresh.decided_at}`,
      });
    }
    return (await toRaiseRows(tx, [fresh]))[0];
  });
}

const STATUS_RU: Record<RaiseRow["status"], string> = {
  proposed: "предложено",
  insufficient: "мало оценок",
  approved: "утверждено",
  rejected: "отклонено",
};

const cell = (v: string | number | null | undefined): string => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
// Строка, которая начинается с символа формулы Excel, получает префикс ': ячейка остаётся текстом.
const text = (v: string | null | undefined): string => cell(v && /^[=+\-@\t\r]/.test(v) ? "'" + v : v);
const pct = (v: number | null | undefined): string => (v === null || v === undefined ? "" : v.toFixed(2).replace(".", ","));

// Excel: BOM, разделитель «;», строки через CRLF.
export function raisesCsv(rows: RaiseRow[]): string {
  const head = ["ФИО", "Филиал", "Карта", "Месяц 1", "Месяц 2", "Месяц 3", "Средняя", "Предложение", "Решение", "Сумма", "Комментарий"];
  const lines = [head.map(cell).join(";")];
  for (const r of rows) {
    lines.push(
      [
        text(r.employee_name),
        text(r.terminal_name),
        text(r.card_title),
        cell(pct(r.months[0]?.score_pct)),
        cell(pct(r.months[1]?.score_pct)),
        cell(pct(r.months[2]?.score_pct)),
        cell(pct(r.avg_pct)),
        cell(r.suggested_amount),
        cell(STATUS_RU[r.status]),
        cell(r.approved_amount),
        text(r.comment),
      ].join(";")
    );
  }
  return "﻿" + lines.join("\r\n") + "\r\n";
}
