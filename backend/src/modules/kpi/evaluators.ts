import { kpi_cards, kpi_evaluator_scopes } from "backend/drizzle/schema";
import type { DrizzleDB } from "@backend/lib/db";
import { eq, inArray, sql } from "drizzle-orm";
import { KpiError } from "./errors";
import { UUID_RE } from "./employees";

// Сколько комбинаций «карта × филиал» можно назначить одним запросом.
export const MAX_SCOPE_COMBINATIONS = 500;

// Список uuid: не массив или элемент не uuid-строка — 422 bad_id. Регистр сворачиваем
// (в базе uuid нормализован, сравнение в памяти должно совпадать), повторы схлопываем.
function uuidList(v: unknown): string[] {
  if (!Array.isArray(v)) throw new KpiError(422, "bad_id");
  const out = new Set<string>();
  for (const x of v) {
    if (typeof x !== "string" || !UUID_RE.test(x)) throw new KpiError(422, "bad_id");
    out.add(x.toLowerCase());
  }
  return [...out];
}

const keyOf = (card: string | null, terminal: string | null) => `${card ?? ""}|${terminal ?? ""}`;

// Массовое назначение оценщику: все комбинации карт и филиалов одним запросом.
// Пустой список = «все» (null); оба пустых дают одну строку null/null. Уже существующие
// комбинации пропускаются. Вход не проверяем типами: тело запроса приходит как есть.
export async function assignScopes(
  db: DrizzleDB,
  input: { user_id: unknown; card_ids: unknown; terminal_ids: unknown; created_by: string }
): Promise<{ created: number; skipped: number }> {
  if (typeof input.user_id !== "string" || !UUID_RE.test(input.user_id)) throw new KpiError(422, "bad_id");
  const userId = input.user_id.toLowerCase();
  const cards = uuidList(input.card_ids);
  const terminals = uuidList(input.terminal_ids);

  const total = (cards.length || 1) * (terminals.length || 1);
  if (total > MAX_SCOPE_COMBINATIONS) throw new KpiError(422, "too_many");

  // Как и в одиночном назначении, существование филиала не проверяем (в базе на него нет ключа).
  if (cards.length) {
    const found = await db.select({ id: kpi_cards.id }).from(kpi_cards).where(inArray(kpi_cards.id, cards));
    if (found.length !== cards.length) throw new KpiError(422, "unknown_card");
  }

  const wantCards: (string | null)[] = cards.length ? cards : [null];
  const wantTerminals: (string | null)[] = terminals.length ? terminals : [null];

  // Уникальности в базе нет (NULL): проверка и вставка под тем же advisory-локом на пользователя,
  // что и в одиночном назначении.
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"kpi_scope:" + userId}))`);
    const existing = await tx
      .select({ card_id: kpi_evaluator_scopes.card_id, terminal_id: kpi_evaluator_scopes.terminal_id })
      .from(kpi_evaluator_scopes)
      .where(eq(kpi_evaluator_scopes.user_id, userId));
    const have = new Set(existing.map((r) => keyOf(r.card_id, r.terminal_id)));

    const missing = wantCards
      .flatMap((card_id) => wantTerminals.map((terminal_id) => ({ card_id, terminal_id })))
      .filter((p) => !have.has(keyOf(p.card_id, p.terminal_id)));
    if (missing.length) {
      await tx
        .insert(kpi_evaluator_scopes)
        .values(missing.map((p) => ({ user_id: userId, ...p, created_by: input.created_by })));
    }
    return { created: missing.length, skipped: total - missing.length };
  });
}
