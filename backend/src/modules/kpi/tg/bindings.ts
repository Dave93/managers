// Приглашения в бота и привязки Telegram. Один telegram_id — один человек,
// у человека одна активная привязка.
import { randomBytes } from "node:crypto";
import type { DrizzleDB } from "@backend/lib/db";
import { employees, kpi_tg_bindings, kpi_tg_invites, users } from "backend/drizzle/schema";
import { and, asc, eq, gt, inArray, isNull, ne, or, sql } from "drizzle-orm";
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

export const inTx = <T>(db: DbLike, fn: (tx: DbLike) => Promise<T>): Promise<T> =>
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
  // В настройках имя часто пишут как @name; в ссылке t.me собачка не нужна.
  const botName = (process.env.KPI_BOT_USERNAME ?? "").trim().replace(/^@+/, "");
  if (!botName) throw new KpiError(409, "bot_not_configured");

  const hasEmp = target.employee_id !== undefined && target.employee_id !== null;
  const hasUser = target.user_id !== undefined && target.user_id !== null;
  if (hasEmp === hasUser) throw new KpiError(422, "bad_target");
  const id = hasEmp ? target.employee_id : target.user_id;
  if (typeof id !== "string" || !UUID_RE.test(id)) throw new KpiError(422, "bad_target");

  const person: Person = hasEmp ? { employee_id: id, user_id: null } : { employee_id: null, user_id: id };

  return inTx(db, async (tx) => {
    // Два одновременных приглашения одному человеку не должны оба остаться действующими.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"kpi_invite:" + id}))`);
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

const isUniqueViolation = (e: unknown): boolean => {
  const err = e as { code?: string; cause?: { code?: string } } | null;
  return err?.code === "23505" || err?.cause?.code === "23505";
};

async function personActive(tx: DbLike, p: Person): Promise<boolean> {
  const rows = p.employee_id
    ? await tx.select({ id: employees.id }).from(employees).where(and(eq(employees.id, p.employee_id), eq(employees.active, true)))
    : await tx.select({ id: users.id }).from(users).where(and(eq(users.id, p.user_id!), eq(users.status, "active")));
  return rows.length > 0;
}

export type RedeemResult = { status: "bound" | "already"; name: string } | { status: "invalid"; name: null };
const INVALID: RedeemResult = { status: "invalid", name: null };

// Имя человека для сообщения «вы подключены как …»: сотрудник — «Имя Фамилия», пользователь — имя или логин.
async function personName(tx: DbLike, p: Person): Promise<string> {
  if (p.employee_id) {
    const [e] = await tx
      .select({ first_name: employees.first_name, last_name: employees.last_name })
      .from(employees)
      .where(eq(employees.id, p.employee_id));
    return e ? `${e.first_name} ${e.last_name}`.trim() : "";
  }
  const [u] = await tx
    .select({ login: users.login, first_name: users.first_name, last_name: users.last_name })
    .from(users)
    .where(eq(users.id, p.user_id!));
  return u ? [u.first_name, u.last_name].filter(Boolean).join(" ") || u.login : "";
}

export async function redeemInvite(db: DbLike, token: string, telegramId: number): Promise<RedeemResult> {
  if (!TOKEN_RE.test(token)) return INVALID;
  try {
    return await inTx(db, async (tx) => {
      const [inv] = await tx.select().from(kpi_tg_invites).where(eq(kpi_tg_invites.token, token)).for("update");
      if (!inv) return INVALID;
      const person = { employee_id: inv.employee_id, user_id: inv.user_id } as Person;

      if (inv.used_at) {
        // Telegram повторил апдейт или человек нажал ссылку ещё раз: тот же телефон получает «уже привязано».
        const [mine] = await tx
          .select({ id: kpi_tg_bindings.id })
          .from(kpi_tg_bindings)
          .where(and(eq(kpi_tg_bindings.telegram_id, telegramId), eq(kpi_tg_bindings.active, true), samePerson(kpi_tg_bindings, person)));
        // Привязка и «уже» только пока человек активен: бот ему всё равно не ответит (см. bindingOf).
        return mine && (await personActive(tx, person)) ? { status: "already", name: await personName(tx, person) } : INVALID;
      }
      const at = now();
      if (new Date(iso(inv.expires_at)).getTime() <= at.getTime()) return INVALID;
      // Ссылку могли выдать до увольнения или блокировки: неактивному человеку привязка не нужна.
      if (!(await personActive(tx, person))) return INVALID;

      await tx
        .update(kpi_tg_bindings)
        .set({ active: false })
        .where(and(samePerson(kpi_tg_bindings, person), eq(kpi_tg_bindings.active, true), ne(kpi_tg_bindings.telegram_id, telegramId)));
      // Язык при конфликте не трогаем: человек мог выбрать его раньше. created_at обновляем: это новая привязка.
      await tx
        .insert(kpi_tg_bindings)
        .values({ telegram_id: telegramId, employee_id: person.employee_id, user_id: person.user_id, active: true })
        .onConflictDoUpdate({
          target: kpi_tg_bindings.telegram_id,
          set: { employee_id: person.employee_id, user_id: person.user_id, active: true, created_at: sql`now()` },
        });
      await tx.update(kpi_tg_invites).set({ used_at: at.toISOString() }).where(eq(kpi_tg_invites.id, inv.id));
      return { status: "bound", name: await personName(tx, person) };
    });
  } catch (e) {
    // Гонка двух погашений для одного человека упирается в частичный уникальный индекс: проигравший получает «недействительна».
    if (isUniqueViolation(e)) return INVALID;
    throw e;
  }
}

const toActive = (r: typeof kpi_tg_bindings.$inferSelect): ActiveBinding => ({
  id: r.id,
  telegram_id: r.telegram_id,
  employee_id: r.employee_id,
  user_id: r.user_id,
  lang: asLang(r.lang),
});

// Уволенный сотрудник или неактивный пользователь бота не использует: привязка остаётся в базе, но для бота её нет.
export async function bindingOf(db: DbLike, telegramId: number): Promise<ActiveBinding | null> {
  const [r] = await db
    .select()
    .from(kpi_tg_bindings)
    .where(and(eq(kpi_tg_bindings.telegram_id, telegramId), eq(kpi_tg_bindings.active, true)));
  if (!r) return null;
  const person = { employee_id: r.employee_id, user_id: r.user_id } as Person;
  return (await personActive(db, person)) ? toActive(r) : null;
}

export async function setLang(db: DbLike, telegramId: number, lang: "ru" | "uz"): Promise<ActiveBinding | null> {
  if (!(await bindingOf(db, telegramId))) return null;
  const [r] = await db
    .update(kpi_tg_bindings)
    .set({ lang })
    .where(and(eq(kpi_tg_bindings.telegram_id, telegramId), eq(kpi_tg_bindings.active, true)))
    .returning();
  return r ? toActive(r) : null;
}

// Telegram сообщил, что писать этому человеку нельзя (заблокировал бота или удалил аккаунт): привязка больше не нужна.
export async function deactivateByTelegramId(db: DbLike, telegramId: number): Promise<void> {
  await db
    .update(kpi_tg_bindings)
    .set({ active: false })
    .where(and(eq(kpi_tg_bindings.telegram_id, telegramId), eq(kpi_tg_bindings.active, true)));
}

// Личный чат совпадает с telegram_id пользователя, поэтому chat_id = telegram_id.
// "inactive": привязка есть, но сотрудник уволен или пользователь не active — писать некому.
export async function recipientOf(
  db: DbLike,
  r: { recipient_kind: string; employee_id: string | null; user_id: string | null }
): Promise<{ chat_id: number; lang: "ru" | "uz" } | "inactive" | null> {
  const owner =
    r.recipient_kind === "employee" ? r.employee_id : r.recipient_kind === "user" ? r.user_id : null;
  if (!owner) return null;
  const col = r.recipient_kind === "employee" ? kpi_tg_bindings.employee_id : kpi_tg_bindings.user_id;
  const [b] = await db
    .select()
    .from(kpi_tg_bindings)
    .where(and(eq(col, owner), eq(kpi_tg_bindings.active, true)));
  if (!b) return null;
  const person: Person =
    r.recipient_kind === "employee" ? { employee_id: owner, user_id: null } : { employee_id: null, user_id: owner };
  if (!(await personActive(db, person))) return "inactive";
  return { chat_id: b.telegram_id, lang: asLang(b.lang) };
}
