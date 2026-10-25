import { kpi_card_items, kpi_cards, kpi_raise_tiers } from "backend/drizzle/schema";
import { sql } from "drizzle-orm";
import type { DbLike } from "./access";
import { SEED_CARDS, SEED_TIERS } from "./seed-data";

// Недостающие карты по code (с пунктами) и шкала, если она пуста. Существующее не трогаем.
export async function seedCards(db: DbLike): Promise<{ cards: number; tiers: number }> {
  let cards = 0;
  for (const c of SEED_CARDS) {
    const [row] = await db
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
    if (!row) continue; // карта уже есть, пункты не трогаем
    cards++;
    await db.insert(kpi_card_items).values(
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
  return { cards, tiers };
}
