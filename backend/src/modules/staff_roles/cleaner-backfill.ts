import { drizzleDb } from "../../lib/db";
import { employees, kpi_cards, staff_roles } from "backend/drizzle/schema";
import { eq, sql } from "drizzle-orm";
import { SEED_ROLES } from "./catalog";
import { foreignCleanerRole, planCleaners } from "./cleaner-plan";
import { parsePosition } from "../terminals/position";

// Разовый скрипт: роль «Техничка» на прод. Сид только вставляет отсутствующие роли и карты,
// поэтому новую роль, привязку карты и роль у сотрудников проставляем здесь.
//
// Без --apply ничего не пишет: печатает отчёт. С --apply одной транзакцией:
//   1. вставляет роль cleaner из SEED_ROLES, если её нет;
//   2. дописывает "cleaner" в kpi_cards.staff_role_codes у карты cleaner, если там нет;
//   3. проставляет staff_role_id (и разряд/смену из разбора) сотрудникам без роли с должностью «техничк…».
// Сотрудников с уже стоящей другой ролью и стажёров скрипт НЕ меняет, а выводит списком на просмотр.
// Карты не назначаются: они вычисляются из роли. position не переписывается: это делает сверка Workly.
// Если HR уже завёл роль «Техничка» под другим кодом, --apply отказывается: решает владелец.

const APPLY = process.argv.includes("--apply");

const roles = await drizzleDb.select().from(staff_roles).execute();
const foreign = foreignCleanerRole(roles);
const own = roles.find((r) => r.code === "cleaner") ?? null;
const rows = await drizzleDb
  .select({ id: employees.id, position: employees.position, staff_role_id: employees.staff_role_id, active: employees.active })
  .from(employees)
  .execute();
const plan = planCleaners(rows, own?.id ?? null);
const activeOf = new Map(rows.map((r) => [r.id, r.active]));
const [card] = await drizzleDb.select().from(kpi_cards).where(eq(kpi_cards.code, "cleaner")).execute();

console.log(
  JSON.stringify(
    {
      apply: APPLY,
      role_cleaner_exists: own !== null,
      foreign_role: foreign ? { id: foreign.id, code: foreign.code, name_ru: foreign.name_ru } : null,
      card_cleaner_exists: card !== undefined,
      card_has_role_code: card ? card.staff_role_codes.includes("cleaner") : null,
      to_assign: plan.assign.length,
      to_assign_active: plan.assign.filter((id) => activeOf.get(id)).length,
      review: plan.review.map((r) => ({ ...r, active: activeOf.get(r.id) })),
    },
    null,
    2
  )
);

if (!APPLY) {
  console.log("dry run — nothing written");
  process.exit(0);
}
if (foreign) {
  console.error(`отказ: уже есть роль «${foreign.name_ru}» с кодом ${foreign.code}; решение за владельцем`);
  process.exit(1);
}

await drizzleDb.transaction(async (tx) => {
  let roleId = own?.id;
  if (!roleId) {
    const seed = SEED_ROLES.find((r) => r.code === "cleaner")!;
    const [ins] = await tx.insert(staff_roles).values(seed).returning({ id: staff_roles.id });
    roleId = ins.id;
    console.log("inserted role cleaner");
  }
  if (card && !card.staff_role_codes.includes("cleaner")) {
    await tx
      .update(kpi_cards)
      .set({ staff_role_codes: sql`array_append(${kpi_cards.staff_role_codes}, 'cleaner')` })
      .where(eq(kpi_cards.id, card.id));
    console.log("card cleaner: added role code");
  }
  const byId = new Map(rows.map((r) => [r.id, r]));
  let written = 0;
  for (const id of plan.assign) {
    const parsed = parsePosition(byId.get(id)!.position);
    await tx
      .update(employees)
      .set({
        staff_role_id: roleId,
        grade: parsed.grade ? Number(parsed.grade) : null,
        shift: parsed.shift === "unknown" ? null : parsed.shift,
        is_trainee: false,
      })
      .where(eq(employees.id, id));
    written++;
  }
  console.log(`assigned ${written}`);
});
process.exit(0);
