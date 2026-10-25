// Приглашения в бота и привязки Telegram. Один telegram_id — один человек,
// у человека одна активная привязка.
import { randomBytes } from "node:crypto";
import type { DrizzleDB } from "@backend/lib/db";
import { employees, kpi_tg_bindings, kpi_tg_invites, users } from "backend/drizzle/schema";
import { and, asc, eq, gt, inArray, isNull, ne, or } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { DbLike } from "../access";
import { now } from "../clock";
import { UUID_RE } from "../employees";
import { KpiError } from "../errors";
import { iso } from "../iso";
import type { KpiInvite, TgBindingRow } from "../types";

export const INVITE_DAYS = 7;

export type ActiveBinding = {
  id: string;
  telegram_id: number;
  employee_id: string | null;
  user_id: string | null;
  lang: "ru" | "uz";
};

const TOKEN_RE = /^[0-9a-f]{32}$/;

const inTx = <T>(db: DbLike, fn: (tx: DbLike) => Promise<T>): Promise<T> =>
  (db as DrizzleDB).transaction((tx) => fn(tx));

const asLang = (v: string): "ru" | "uz" => (v === "uz" ? "uz" : "ru");

type Person = { employee_id: string; user_id: null } | { employee_id: null; user_id: string };

// Условие «та же персона» для таблиц привязок и приглашений (колонки у них совпадают по именам).
const samePerson = (
  t: { employee_id: AnyPgColumn; user_id: AnyPgColumn },
  p: Person
) => (p.employee_id ? eq(t.employee_id, p.employee_id) : eq(t.user_id, p.user_id!));

export async function createInvite(
  db: DbLike,
  createdBy: string,
  target: { employee_id?: unknown; user_id?: unknown }
): Promise<KpiInvite> {
  const botName = (process.env.KPI_BOT_USERNAME ?? "").trim();
  if (!botName) throw new KpiError(409, "bot_not_configured");

  const hasEmp = target.employee_id !== undefined && target.employee_id !== null;
  const hasUser = target.user_id !== undefined && target.user_id !== null;
  if (hasEmp === hasUser) throw new KpiError(422, "bad_target");
  const id = hasEmp ? target.employee_id : target.user_id;
  if (typeof id !== "string" || !UUID_RE.test(id)) throw new KpiError(422, "bad_target");

  const person: Person = hasEmp ? { employee_id: id, user_id: null } : { employee_id: null, user_id: id };

  return inTx(db, async (tx) => {
    const found = person.employee_id
      ? await tx
          .select({ id: employees.id })
          .from(employees)
          .where(and(eq(employees.id, person.employee_id), eq(employees.active, true)))
      : await tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.id, person.user_id!), eq(users.status, "active")));
    if (!found.length) throw new KpiError(404, "not_found");

    const at = now();
    // Старые неиспользованные ссылки этого человека гасим: разосланная раньше ссылка не должна привязать чужой телефон.
    await tx
      .update(kpi_tg_invites)
      .set({ expires_at: at.toISOString() })
      .where(and(samePerson(kpi_tg_invites, person), isNull(kpi_tg_invites.used_at), gt(kpi_tg_invites.expires_at, at.toISOString())));

    const token = randomBytes(16).toString("hex");
    const expires = new Date(at.getTime() + INVITE_DAYS * 24 * 3600 * 1000);
    await tx.insert(kpi_tg_invites).values({
      token,
      employee_id: person.employee_id,
      user_id: person.user_id,
      expires_at: expires.toISOString(),
      created_by: createdBy,
    });
    return { token, link: `https://t.me/${botName}?start=kpi_${token}`, expires_at: expires.toISOString() };
  });
}

export async function listBindings(db: DbLike, q: { employee_ids: string[]; user_ids: string[] }): Promise<TgBindingRow[]> {
  const conds = [];
  if (q.employee_ids.length) conds.push(inArray(kpi_tg_bindings.employee_id, q.employee_ids));
  if (q.user_ids.length) conds.push(inArray(kpi_tg_bindings.user_id, q.user_ids));
  if (!conds.length) return [];
  const rows = await db
    .select()
    .from(kpi_tg_bindings)
    .where(and(eq(kpi_tg_bindings.active, true), or(...conds)))
    .orderBy(asc(kpi_tg_bindings.created_at), asc(kpi_tg_bindings.id));
  return rows.map((r) => ({
    id: r.id,
    employee_id: r.employee_id,
    user_id: r.user_id,
    lang: asLang(r.lang),
    active: r.active,
    created_at: iso(r.created_at),
  }));
}

export async function unbind(db: DbLike, id: string): Promise<void> {
  if (!UUID_RE.test(id)) throw new KpiError(404, "not_found");
  const rows = await db
    .update(kpi_tg_bindings)
    .set({ active: false })
    .where(eq(kpi_tg_bindings.id, id))
    .returning({ id: kpi_tg_bindings.id });
  if (!rows.length) throw new KpiError(404, "not_found");
}

export async function redeemInvite(db: DbLike, token: string, telegramId: number): Promise<"bound" | "already" | "invalid"> {
  if (!TOKEN_RE.test(token)) return "invalid";
  return inTx(db, async (tx) => {
    const [inv] = await tx.select().from(kpi_tg_invites).where(eq(kpi_tg_invites.token, token)).for("update");
    if (!inv) return "invalid";
    const person = { employee_id: inv.employee_id, user_id: inv.user_id } as Person;

    if (inv.used_at) {
      // Telegram повторил апдейт или человек нажал ссылку ещё раз: тот же телефон получает «уже привязано».
      const [mine] = await tx
        .select({ id: kpi_tg_bindings.id })
        .from(kpi_tg_bindings)
        .where(and(eq(kpi_tg_bindings.telegram_id, telegramId), eq(kpi_tg_bindings.active, true), samePerson(kpi_tg_bindings, person)));
      return mine ? "already" : "invalid";
    }
    const at = now();
    if (new Date(inv.expires_at).getTime() <= at.getTime()) return "invalid";

    await tx
      .update(kpi_tg_bindings)
      .set({ active: false })
      .where(and(samePerson(kpi_tg_bindings, person), eq(kpi_tg_bindings.active, true), ne(kpi_tg_bindings.telegram_id, telegramId)));
    // Язык при конфликте не трогаем: человек мог выбрать его раньше.
    await tx
      .insert(kpi_tg_bindings)
      .values({ telegram_id: telegramId, employee_id: person.employee_id, user_id: person.user_id, active: true })
      .onConflictDoUpdate({
        target: kpi_tg_bindings.telegram_id,
        set: { employee_id: person.employee_id, user_id: person.user_id, active: true },
      });
    await tx.update(kpi_tg_invites).set({ used_at: at.toISOString() }).where(eq(kpi_tg_invites.id, inv.id));
    return "bound";
  });
}

const toActive = (r: typeof kpi_tg_bindings.$inferSelect): ActiveBinding => ({
  id: r.id,
  telegram_id: r.telegram_id,
  employee_id: r.employee_id,
  user_id: r.user_id,
  lang: asLang(r.lang),
});

export async function bindingOf(db: DbLike, telegramId: number): Promise<ActiveBinding | null> {
  const [r] = await db
    .select()
    .from(kpi_tg_bindings)
    .where(and(eq(kpi_tg_bindings.telegram_id, telegramId), eq(kpi_tg_bindings.active, true)));
  return r ? toActive(r) : null;
}

export async function setLang(db: DbLike, telegramId: number, lang: "ru" | "uz"): Promise<ActiveBinding | null> {
  const [r] = await db
    .update(kpi_tg_bindings)
    .set({ lang })
    .where(and(eq(kpi_tg_bindings.telegram_id, telegramId), eq(kpi_tg_bindings.active, true)))
    .returning();
  return r ? toActive(r) : null;
}

// Личный чат совпадает с telegram_id пользователя, поэтому chat_id = telegram_id.
export async function recipientOf(
  db: DbLike,
  r: { recipient_kind: string; employee_id: string | null; user_id: string | null }
): Promise<{ chat_id: number; lang: "ru" | "uz" } | null> {
  const owner =
    r.recipient_kind === "employee" ? r.employee_id : r.recipient_kind === "user" ? r.user_id : null;
  if (!owner) return null;
  const col = r.recipient_kind === "employee" ? kpi_tg_bindings.employee_id : kpi_tg_bindings.user_id;
  const [b] = await db
    .select()
    .from(kpi_tg_bindings)
    .where(and(eq(col, owner), eq(kpi_tg_bindings.active, true)));
  return b ? { chat_id: b.telegram_id, lang: asLang(b.lang) } : null;
}
