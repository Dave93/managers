import { ctx } from "@backend/context";
import { kpi_cards, kpi_evaluator_scopes, users } from "backend/drizzle/schema";
import { and, asc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import Elysia, { t } from "elysia";
import { terminalNames, userNames } from "../directory";
import { KpiError, run } from "../errors";
import { iso } from "../iso";
import type { KpiUserOption, ScopeRow } from "../types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (m) => "\\" + m);

// null или uuid; всё остальное — 422 bad_id.
function idOrNull(v: unknown): string | null {
  if (v === null) return null;
  if (typeof v !== "string" || !UUID_RE.test(v)) throw new KpiError(422, "bad_id");
  return v;
}

export const evaluatorsRoutes = new Elysia({ name: "@api/kpi/evaluators" })
  .use(ctx)
  .get(
    "/kpi/evaluators",
    async ({ drizzle, set }) =>
      run(set, async (): Promise<ScopeRow[]> => {
        const rows = await drizzle.select().from(kpi_evaluator_scopes).orderBy(asc(kpi_evaluator_scopes.created_at));
        const cardRows = await drizzle.select({ id: kpi_cards.id, title_ru: kpi_cards.title_ru }).from(kpi_cards);
        const cardTitle = new Map(cardRows.map((c) => [c.id, c.title_ru]));
        const uNames = await userNames(drizzle, rows.map((r) => r.user_id));
        const tNames = await terminalNames(drizzle, rows.flatMap((r) => (r.terminal_id ? [r.terminal_id] : [])));
        return rows.map((r) => ({
          id: r.id,
          user_id: r.user_id,
          user_name: uNames.get(r.user_id) ?? "",
          card_id: r.card_id,
          card_title: r.card_id ? (cardTitle.get(r.card_id) ?? null) : null,
          terminal_id: r.terminal_id,
          terminal_name: r.terminal_id ? (tNames.get(r.terminal_id) ?? null) : null,
          created_at: iso(r.created_at),
        }));
      }),
    { permission: "kpi.manage" }
  )
  .post(
    "/kpi/evaluators",
    async ({ body, user, drizzle, set }) =>
      run(set, async () => {
        const b = body as Record<string, unknown>;
        if (typeof b.user_id !== "string" || !UUID_RE.test(b.user_id)) throw new KpiError(422, "bad_id");
        const userId = b.user_id;
        const cardId = idOrNull(b.card_id ?? null);
        const terminalId = idOrNull(b.terminal_id ?? null);
        if (cardId) {
          const [c] = await drizzle.select({ id: kpi_cards.id }).from(kpi_cards).where(eq(kpi_cards.id, cardId)).limit(1);
          if (!c) throw new KpiError(422, "unknown_card");
        }
        // Уникальности в базе нет (NULL): проверка и вставка под advisory-локом на пользователя.
        const [row] = await drizzle.transaction(async (tx) => {
          await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"kpi_scope:" + userId}))`);
          const dup = await tx
            .select({ id: kpi_evaluator_scopes.id })
            .from(kpi_evaluator_scopes)
            .where(
              and(
                eq(kpi_evaluator_scopes.user_id, userId),
                cardId ? eq(kpi_evaluator_scopes.card_id, cardId) : isNull(kpi_evaluator_scopes.card_id),
                terminalId ? eq(kpi_evaluator_scopes.terminal_id, terminalId) : isNull(kpi_evaluator_scopes.terminal_id)
              )
            )
            .limit(1);
          if (dup.length) throw new KpiError(409, "scope_exists");
          return tx
            .insert(kpi_evaluator_scopes)
            .values({ user_id: userId, card_id: cardId, terminal_id: terminalId, created_by: user!.id })
            .returning();
        });
        // Строка как есть, время — в ISO, как во всех ответах.
        return { ...row, created_at: iso(row.created_at) };
      }),
    { permission: "kpi.manage", body: t.Record(t.String(), t.Any()) }
  )
  .delete(
    "/kpi/evaluators/:id",
    async ({ params, drizzle, set }) =>
      run(set, async () => {
        if (!UUID_RE.test(params.id)) throw new KpiError(404, "not_found");
        const del = await drizzle
          .delete(kpi_evaluator_scopes)
          .where(eq(kpi_evaluator_scopes.id, params.id))
          .returning({ id: kpi_evaluator_scopes.id });
        if (del.length === 0) throw new KpiError(404, "not_found");
        return { ok: true };
      }),
    { permission: "kpi.manage", params: t.Object({ id: t.String() }) }
  )
  .get(
    "/kpi/users",
    async ({ query, drizzle, set }) =>
      run(set, async (): Promise<KpiUserOption[]> => {
        const search = (query.search ?? "").trim();
        // ilike в базе с локалью C не сворачивает регистр кириллицы: ищем по вариантам регистра.
        const variants = [...new Set([search, search.toLowerCase(), search.toUpperCase(), search.charAt(0).toUpperCase() + search.slice(1).toLowerCase()])];
        const match = or(
          ...variants.flatMap((v) => {
            const q = `%${likeEscape(v)}%`;
            return [ilike(users.login, q), ilike(users.first_name, q), ilike(users.last_name, q)];
          })
        );
        const rows = await drizzle
          .select({ id: users.id, login: users.login, first_name: users.first_name, last_name: users.last_name })
          .from(users)
          .where(
            and(
              eq(users.status, "active"),
              search ? match : undefined
            )
          )
          .orderBy(asc(users.last_name), asc(users.first_name), asc(users.login))
          .limit(20);
        return rows.map((r) => ({
          id: r.id,
          name: `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() || r.login,
          login: r.login,
        }));
      }),
    { permission: "kpi.manage", query: t.Object({ search: t.Optional(t.String()) }) }
  );
