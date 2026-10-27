// Санитарные проверки филиала (спека 7.7): HR или оценщик с назначением отмечает пункты шаблона.
import type { DrizzleDB } from "@backend/lib/db";
import { kpi_sanitary_checks, terminals } from "backend/drizzle/schema";
import { and, desc, eq } from "drizzle-orm";
import { has, loadScopes, parsePeriod, viewsTerminal, type Actor, type DbLike } from "./access";
import { coversTerminal, parseSanitaryItems, sanitaryPct } from "./branch-rules";
import { now } from "./clock";
import { terminalNames, userNames } from "./directory";
import { UUID_RE } from "./employees";
import { KpiError } from "./errors";
import { iso } from "./iso";
import { lockPeriodShared } from "./periods";
import { loadBranchSettings } from "./branch-settings";
import { OCCURRED_RE } from "./violations";
import { addMonths, dayStart, isPeriod, periodOf, type Period } from "./time";
import type { SanitaryCheckRow, SanitaryItem, SanitaryTemplate } from "./types";

const FUTURE_SLACK_MS = 5 * 60 * 1000;
const COMMENT_MAX = 1000;

type CheckRow = typeof kpi_sanitary_checks.$inferSelect;

async function toRows(db: DbLike, rows: CheckRow[]): Promise<SanitaryCheckRow[]> {
  const tNames = await terminalNames(db, rows.map((r) => r.terminal_id));
  const uNames = await userNames(db, rows.map((r) => r.inspector_user_id));
  return rows.map((r) => ({
    id: r.id,
    terminal_id: r.terminal_id,
    terminal_name: tNames.get(r.terminal_id) ?? null,
    period: r.period,
    checked_at: iso(r.checked_at),
    inspector_user_id: r.inspector_user_id,
    inspector_name: uNames.get(r.inspector_user_id) ?? null,
    items: r.items as SanitaryItem[],
    pct: Number(r.pct),
    comment: r.comment,
    created_at: iso(r.created_at),
  }));
}

export async function createCheck(db: DrizzleDB, actor: Actor, body: Record<string, unknown>): Promise<SanitaryCheckRow> {
  const terminalId = body.terminal_id;
  if (typeof terminalId !== "string" || !UUID_RE.test(terminalId)) throw new KpiError(422, "unknown_terminal");
  const allowed = has(actor, "kpi.manage") || (has(actor, "kpi.evaluate") && coversTerminal(await loadScopes(db, actor.userId), terminalId));
  if (!allowed) throw new KpiError(403, "out_of_scope");
  const [t] = await db.select({ id: terminals.id }).from(terminals).where(eq(terminals.id, terminalId)).limit(1);
  if (!t) throw new KpiError(422, "unknown_terminal");

  const items = parseSanitaryItems(body.items);
  if (!items) throw new KpiError(422, "bad_items");
  // Пункты ровно по текущему шаблону: каждый один раз, чужих нет
  const template = (await loadBranchSettings(db)).sanitary_items.map((s) => s.trim());
  const titles = items.map((i) => i.title);
  if (titles.length !== template.length || new Set(titles).size !== titles.length || !template.every((x) => titles.includes(x))) {
    throw new KpiError(422, "bad_items");
  }

  const nowTs = now();
  let checkedAt = nowTs;
  if (body.checked_at !== undefined && body.checked_at !== null) {
    // Как у нарушений: явное смещение (Z или ±hh:mm), не из будущего (запас 5 минут), не раньше прошлого месяца
    const raw = body.checked_at;
    checkedAt = typeof raw === "string" && OCCURRED_RE.test(raw) ? new Date(raw) : new Date(Number.NaN);
    const earliest = dayStart(addMonths(periodOf(nowTs), -1), 1);
    if (
      Number.isNaN(checkedAt.getTime()) ||
      checkedAt.getTime() > nowTs.getTime() + FUTURE_SLACK_MS ||
      checkedAt.getTime() < earliest.getTime() ||
      !isPeriod(periodOf(checkedAt))
    ) {
      throw new KpiError(422, "bad_checked_at");
    }
  }

  let comment: string | null = null;
  if (typeof body.comment === "string" && body.comment.trim() !== "") {
    comment = body.comment.trim();
    if (comment.length > COMMENT_MAX) throw new KpiError(422, "comment_too_long");
  }

  const period = periodOf(checkedAt);
  return db.transaction(async (tx) => {
    // Закрытие месяца ждёт запись: строка месяца под FOR SHARE до конца транзакции
    if (await lockPeriodShared(tx, period)) throw new KpiError(409, "period_closed");
    const [row] = await tx
      .insert(kpi_sanitary_checks)
      .values({
        terminal_id: terminalId,
        period,
        checked_at: checkedAt.toISOString(),
        inspector_user_id: actor.userId,
        items,
        pct: String(sanitaryPct(items)),
        comment,
      })
      .returning();
    return (await toRows(tx, [row]))[0];
  });
}

export async function listChecks(
  db: DbLike,
  actor: Actor,
  q: { period: Period; terminal_id?: string }
): Promise<SanitaryCheckRow[]> {
  const period = parsePeriod(q.period);
  if (q.terminal_id !== undefined && !UUID_RE.test(q.terminal_id)) throw new KpiError(422, "bad_id");
  const scopes = has(actor, "kpi.evaluate") ? await loadScopes(db, actor.userId) : [];
  const visible = (terminalId: string) => viewsTerminal(actor, terminalId) || (scopes.length > 0 && coversTerminal(scopes, terminalId));
  if (q.terminal_id !== undefined && !visible(q.terminal_id)) throw new KpiError(403, "out_of_scope");
  const rows = await db
    .select()
    .from(kpi_sanitary_checks)
    .where(and(eq(kpi_sanitary_checks.period, period), q.terminal_id ? eq(kpi_sanitary_checks.terminal_id, q.terminal_id) : undefined))
    .orderBy(desc(kpi_sanitary_checks.checked_at), desc(kpi_sanitary_checks.created_at));
  return toRows(db, rows.filter((r) => visible(r.terminal_id)));
}

// Для экрана «Филиал»: права проверяет вызывающий. Новые сверху.
export async function checksFor(db: DbLike, terminalId: string, period: Period): Promise<SanitaryCheckRow[]> {
  const rows = await db
    .select()
    .from(kpi_sanitary_checks)
    .where(and(eq(kpi_sanitary_checks.period, period), eq(kpi_sanitary_checks.terminal_id, terminalId)))
    .orderBy(desc(kpi_sanitary_checks.checked_at), desc(kpi_sanitary_checks.created_at));
  return toRows(db, rows);
}

export async function sanitaryTemplate(db: DbLike): Promise<SanitaryTemplate> {
  return { items: (await loadBranchSettings(db)).sanitary_items };
}
