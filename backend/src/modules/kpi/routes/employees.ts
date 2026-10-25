import { ctx } from "@backend/context";
import { employees, kpi_cards, kpi_disputes, kpi_employee_cards, kpi_reviews } from "backend/drizzle/schema";
import { and, eq, inArray } from "drizzle-orm";
import Elysia, { t } from "elysia";
import { actorFrom, loadScopes, parsePeriod, requireAny, seesNetwork } from "../access";
import { now } from "../clock";
import { canEvaluate, canSeeEmployee, loadDirectory } from "../directory";
import { KpiError, run } from "../errors";
import { loadSettings } from "../settings";
import { reviewDeadline } from "../time";
import type { EmployeeRow } from "../types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = ["none", "draft", "submitted", "disputed"];

export const employeesRoutes = new Elysia({ name: "@api/kpi/employees" })
  .use(ctx)
  .get(
    "/kpi/employees",
    async ({ query, user, role, terminals, drizzle, cacheController, set }) =>
      run(set, async (): Promise<EmployeeRow[]> => {
        const actor = await actorFrom({ user, role, terminals, cacheController });
        requireAny(actor, ["kpi.evaluate", "kpi.view", "kpi.manage", "kpi.approve"]);
        const period = parsePeriod(query.period);
        if (query.terminal_id && !UUID_RE.test(query.terminal_id)) throw new KpiError(422, "bad_id");
        if (query.card_id && !UUID_RE.test(query.card_id)) throw new KpiError(422, "bad_id");
        if (query.status && !STATUSES.includes(query.status)) throw new KpiError(422, "bad_status");

        const settings = await loadSettings(drizzle);
        const deadline = reviewDeadline(period, settings.review_deadline_day).getTime();
        const nowMs = now().getTime();
        const scopes = seesNetwork(actor) ? [] : await loadScopes(drizzle, actor.userId);

        const dir = await loadDirectory(drizzle, {
          includeInactive: true,
          terminalId: query.terminal_id || undefined,
          search: query.search?.trim() || undefined,
        });
        const reviewRows = await drizzle.select().from(kpi_reviews).where(eq(kpi_reviews.period, period));
        const reviews = new Map(reviewRows.map((r) => [r.employee_id, r]));
        const disputed = new Set<string>();
        if (reviewRows.length) {
          const d = await drizzle
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
        const cardRows = await drizzle
          .select({ id: kpi_cards.id, code: kpi_cards.code, title_ru: kpi_cards.title_ru })
          .from(kpi_cards);
        const cardById = new Map(cardRows.map((c) => [c.id, c]));

        const out: EmployeeRow[] = [];
        for (const e of dir) {
          const rv = reviews.get(e.id);
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
                  late: rv.submitted_at
                    ? new Date(rv.submitted_at).getTime() > deadline
                    : nowMs > deadline,
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
      }),
    {
      userAuth: true,
      query: t.Object({
        period: t.Optional(t.String()),
        terminal_id: t.Optional(t.String()),
        card_id: t.Optional(t.String()),
        status: t.Optional(t.String()),
        search: t.Optional(t.String()),
      }),
    }
  )
  .put(
    "/kpi/employees/:id/card",
    async ({ params, body, user, drizzle, set }) =>
      run(set, async () => {
        const b = body as Record<string, unknown>;
        if (!UUID_RE.test(params.id)) throw new KpiError(404, "not_found");
        const [emp] = await drizzle.select({ id: employees.id }).from(employees).where(eq(employees.id, params.id)).limit(1);
        if (!emp) throw new KpiError(404, "not_found");
        const v = b.card_id;
        if (v !== null && (typeof v !== "string" || (v !== "auto" && !UUID_RE.test(v)))) {
          throw new KpiError(422, "unknown_card");
        }
        if (b.comment !== undefined && b.comment !== null && typeof b.comment !== "string") {
          throw new KpiError(422, "bad_comment");
        }
        const comment = typeof b.comment === "string" && b.comment.trim() !== "" ? b.comment.trim() : null;
        if (v === "auto") {
          await drizzle.delete(kpi_employee_cards).where(eq(kpi_employee_cards.employee_id, params.id));
        } else {
          if (v !== null) {
            const [c] = await drizzle
              .select({ id: kpi_cards.id })
              .from(kpi_cards)
              .where(and(eq(kpi_cards.id, v), eq(kpi_cards.active, true)))
              .limit(1);
            if (!c) throw new KpiError(422, "unknown_card");
          }
          const row = { employee_id: params.id, card_id: v, set_by: user!.id, set_at: now().toISOString(), comment };
          await drizzle
            .insert(kpi_employee_cards)
            .values(row)
            .onConflictDoUpdate({
              target: kpi_employee_cards.employee_id,
              set: { card_id: row.card_id, set_by: row.set_by, set_at: row.set_at, comment: row.comment },
            });
        }
        const [e] = await loadDirectory(drizzle, { employeeIds: [params.id], includeInactive: true });
        return e;
      }),
    {
      permission: "kpi.manage",
      params: t.Object({ id: t.String() }),
      body: t.Record(t.String(), t.Any()),
    }
  );
