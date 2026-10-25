import { kpi_cards, kpi_disputes, kpi_reviews } from "backend/drizzle/schema";
import { and, eq, inArray } from "drizzle-orm";
import { loadScopes, parsePeriod, type Actor, type DbLike } from "./access";
import { now } from "./clock";
import { canEvaluate, canSeeEmployee, loadDirectory } from "./directory";
import { KpiError } from "./errors";
import { loadSettings } from "./settings";
import { reviewDeadline } from "./time";
import type { EmployeeRow } from "./types";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = ["none", "draft", "submitted", "disputed"];

export type EmployeeQuery = {
  period?: string;
  terminal_id?: string;
  card_id?: string;
  status?: string;
  search?: string;
};

// Сотрудники периода с оценкой и признаками; onlyWithReview оставляет тех, у кого оценка уже есть.
export async function listEmployeeRows(
  db: DbLike,
  actor: Actor,
  query: EmployeeQuery,
  opts: { onlyWithReview?: boolean } = {}
): Promise<EmployeeRow[]> {
  const period = parsePeriod(query.period);
  if (query.terminal_id && !UUID_RE.test(query.terminal_id)) throw new KpiError(422, "bad_id");
  if (query.card_id && !UUID_RE.test(query.card_id)) throw new KpiError(422, "bad_id");
  if (query.status && !STATUSES.includes(query.status)) throw new KpiError(422, "bad_status");

  const settings = await loadSettings(db);
  const deadline = reviewDeadline(period, settings.review_deadline_day).getTime();
  const nowMs = now().getTime();
  const scopes = await loadScopes(db, actor.userId);

  const dir = await loadDirectory(db, {
    includeInactive: true,
    terminalId: query.terminal_id || undefined,
    search: query.search?.trim() || undefined,
  });
  const reviewRows = await db.select().from(kpi_reviews).where(eq(kpi_reviews.period, period));
  const reviews = new Map(reviewRows.map((r) => [r.employee_id, r]));
  const disputed = new Set<string>();
  if (reviewRows.length) {
    const d = await db
      .select({ subject_id: kpi_disputes.subject_id })
      .from(kpi_disputes)
      .where(
        and(
          eq(kpi_disputes.status, "open"),
          eq(kpi_disputes.subject_type, "review"),
          inArray(kpi_disputes.subject_id, reviewRows.map((r) => r.id))
        )
      );
    for (const x of d) disputed.add(x.subject_id);
  }
  const cardRows = await db
    .select({ id: kpi_cards.id, code: kpi_cards.code, title_ru: kpi_cards.title_ru })
    .from(kpi_cards);
  const cardById = new Map(cardRows.map((c) => [c.id, c]));

  const out: EmployeeRow[] = [];
  for (const e of dir) {
    const rv = reviews.get(e.id);
    if (opts.onlyWithReview && !rv) continue;
    // Только с картой; плюс те, у кого за период уже есть оценка (даже неактивные или без карты).
    if (e.card_id === null && !rv) continue;
    if (!e.active && !rv) continue;
    // Оценка без действующей карты видна и по карте из снимка оценки.
    const visible =
      canSeeEmployee(actor, scopes, { terminal_id: e.terminal_id, card_id: e.card_id }) ||
      (rv ? canSeeEmployee(actor, scopes, { terminal_id: e.terminal_id, card_id: rv.card_id }) : false);
    if (!visible) continue;
    if (query.card_id && e.card_id !== query.card_id) continue;
    const openDispute = rv ? disputed.has(rv.id) : false;
    if (query.status === "none" && rv) continue;
    if (query.status === "draft" && rv?.status !== "draft") continue;
    if (query.status === "submitted" && rv?.status !== "submitted") continue;
    if (query.status === "disputed" && !openDispute) continue;
    const card = e.card_id ? cardById.get(e.card_id) : undefined;
    out.push({
      id: e.id,
      first_name: e.first_name,
      last_name: e.last_name,
      terminal_id: e.terminal_id,
      terminal_name: e.terminal_name,
      staff_role_code: e.staff_role_code,
      staff_role_name: e.staff_role_name,
      active: e.active,
      external_id: e.external_id,
      card: card ? { id: card.id, code: card.code, title_ru: card.title_ru } : null,
      card_source: e.card_source,
      review: rv
        ? {
            id: rv.id,
            status: rv.status as "draft" | "submitted",
            score_pct: rv.score_pct === null ? null : Number(rv.score_pct),
            submitted_at: rv.submitted_at,
            late: rv.submitted_at ? new Date(rv.submitted_at).getTime() > deadline : nowMs > deadline,
          }
        : null,
      open_dispute: openDispute,
      can_evaluate: e.card_id !== null && canEvaluate(actor, scopes, { terminal_id: e.terminal_id, card_id: e.card_id }),
    });
  }
  const byName = (a: string | null, b: string | null) => (a ?? "").localeCompare(b ?? "", "ru");
  out.sort(
    (a, b) =>
      byName(a.terminal_name, b.terminal_name) ||
      a.terminal_id.localeCompare(b.terminal_id) ||
      byName(a.last_name, b.last_name) ||
      byName(a.first_name, b.first_name) ||
      a.id.localeCompare(b.id)
  );
  return out;
}
