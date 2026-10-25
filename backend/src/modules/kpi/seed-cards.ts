import type { DrizzleDB } from "@backend/lib/db";
import { kpi_card_items, kpi_cards, kpi_raise_tiers } from "backend/drizzle/schema";
import { sql } from "drizzle-orm";
import type { DbLike } from "./access";
import { SEED_CARDS, SEED_TIERS, type SeedCard } from "./seed-data";

// Недостающие карты по code (с пунктами) и шкала, если она пуста. Существующее не трогаем.
// Карта и её пункты — одна транзакция: карты без пунктов после сбоя не остаётся.
export async function seedCards(db: DbLike, cards: SeedCard[] = SEED_CARDS): Promise<{ cards: number; tiers: number }> {
  let added = 0;
  for (const c of cards) {
    const inserted = await (db as DrizzleDB).transaction(async (tx) => {
      const [row] = await tx
        .insert(kpi_cards)
        .values({
          code: c.code,
          title_ru: c.title_ru,
          title_uz: c.title_uz,
          staff_role_codes: c.staff_role_codes,
          sort: c.sort,
        })
        .onConflictDoNothing({ target: kpi_cards.code })
        .returning({ id: kpi_cards.id });
      if (!row) return false; // карта уже есть, пункты не трогаем
      if (c.items.length) {
        await tx.insert(kpi_card_items).values(
          c.items.map((it, i) => ({
            card_id: row.id,
            sort: (i + 1) * 10,
            title_ru: it.title_ru,
            title_uz: it.title_uz,
            hint_ru: null,
            hint_uz: null,
            source: it.source,
            weight: 1,
            group_key: it.group_key,
          }))
        );
      }
      return true;
    });
    if (inserted) added++;
  }
  // Шкала: только если пуста; гонка двух вызовов гасится уникальным min_pct.
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(kpi_raise_tiers);
  let tiers = 0;
  if (n === 0) {
    const ins = await db
      .insert(kpi_raise_tiers)
      .values(SEED_TIERS.map((t) => ({ min_pct: String(t.min_pct), amount: String(t.amount) })))
      .onConflictDoNothing()
      .returning({ id: kpi_raise_tiers.id });
    tiers = ins.length;
  }
  return { cards: added, tiers };
}

// Запуск: cd backend && bun run src/modules/kpi/seed-cards.ts (база — из DATABASE_URL).
// При импорте из тестов не срабатывает: import.meta.main истинно только у запущенного файла.
async function main() {
  const { drizzleDb } = await import("../../lib/db");
  try {
    const r = await seedCards(drizzleDb);
    console.log(`kpi seed: cards ${r.cards}, tiers ${r.tiers}`);
    process.exit(0);
  } catch (e) {
    console.error("kpi seed: ошибка", e);
    process.exit(1);
  }
}

if (import.meta.main) main();
