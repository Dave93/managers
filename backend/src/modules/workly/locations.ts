// Карта локаций Workly и терминалов (раздел 5.4 спеки). Из Workly берутся только названия
// локаций; терминал подсказывается по названию, остальное подтверждает HR на экране.
import { terminals, workly_locations } from "backend/drizzle/schema";
import { and, eq, sql } from "drizzle-orm";
import type { DbLike } from "../kpi/access";
import { KpiError } from "../kpi/errors";
import type { WorklyClient } from "./client";

// workly_locations.title — varchar(120).
const TITLE_MAX = 120;

// Ведущий бренд в названии терминала: «Les Ailes Oybek», «Chopar pizza Golden life».
const BRAND = /^\s*(?:les\s*ailes|chopar\s*pizza)\b/i;

// Ключи локаций, которые называются в Workly не так, как наш терминал. Применяются к ключу
// ЛОКАЦИИ: ключ терминала остаётся как есть. Значения подтверждены сверкой данных.
const ALIASES = new Map<string, string>([
  ["MGORKIY", "BUYUKIPAKYOLI"], // M.GORKIY → Les Ailes Buyuk ipak yo'li
  ["C5", "MARKAZ5"], // C-5 → Les Ailes Markaz-5
  ["RIVIERA", "RIVYERA"],
  ["QOYLIQ", "QOYLIQ5"],
  ["SRAXIMOV", "SRAHIMOV"],
  ["SOBIRRAHIMOV", "SRAHIMOV"],
]);

/**
 * Ключ названия: верхний регистр, всё кроме A-Z0-9 удаляется (пробелы, дефисы, точки и
 * любые апострофы). «OFIS » → «OFIS», «C-1» → «C1», «KO'KCHA» → «KOKCHA».
 */
export function locationKey(title: string): string {
  return title.toUpperCase().replace(/[^A-Z0-9]+/g, "");
}

/**
 * Терминал для новой локации по названию. Список терминалов вызывающий уже сузил до
 * своей организации. Совпадение ровно одно — его id, ни одного или несколько — null.
 */
export function suggestTerminal(title: string, terms: { id: string; name: string }[]): string | null {
  const key = locationKey(title);
  if (!key) return null;
  const want = ALIASES.get(key) ?? key;
  const hits = terms.filter((t) => locationKey(t.name.replace(BRAND, "")) === want);
  return hits.length === 1 ? hits[0].id : null;
}

/**
 * Подтягивает локации компании из Workly. Новым строкам ставит терминал-подсказку среди
 * активных терминалов организации. У существующих меняется только название: терминал,
 * выбранный вручную (или снятый), остаётся как есть, организация не переназначается.
 * Исчезнувшие из Workly локации не удаляются: на них могут ссылаться сотрудники.
 */
export async function refreshLocations(
  db: DbLike,
  client: Pick<WorklyClient, "locations">,
  companyId: number,
  organizationId: string
): Promise<void> {
  // Повтор id в одном ответе сломал бы INSERT ... ON CONFLICT: оставляем последнее название.
  const titles = new Map<number, string>();
  for (const l of await client.locations()) titles.set(l.id, l.title.slice(0, TITLE_MAX));
  if (!titles.size) return;

  const ours = await db
    .select({ id: terminals.id, name: terminals.name })
    .from(terminals)
    .where(and(eq(terminals.organization_id, organizationId), eq(terminals.active, true)));

  await db
    .insert(workly_locations)
    .values(
      [...titles].map(([id, title]) => ({
        organization_id: organizationId,
        workly_company_id: companyId,
        workly_location_id: id,
        title,
        terminal_id: suggestTerminal(title, ours),
      }))
    )
    .onConflictDoUpdate({
      target: [workly_locations.workly_company_id, workly_locations.workly_location_id],
      // Строка чужой организации не обновляется вовсе.
      set: { title: sql`excluded.title`, updated_at: sql`now()` },
      setWhere: eq(workly_locations.organization_id, organizationId),
    });
}

/**
 * Ручная привязка локации к терминалу (null снимает привязку). Локация должна быть
 * этой организации, терминал — тоже: чужой терминал даёт 422, чужая локация — 404.
 */
export async function setLocationTerminal(
  db: DbLike,
  locationRowId: string,
  terminalId: string | null,
  organizationId: string
): Promise<void> {
  const own = and(eq(workly_locations.id, locationRowId), eq(workly_locations.organization_id, organizationId));
  const [loc] = await db.select({ id: workly_locations.id }).from(workly_locations).where(own).limit(1);
  if (!loc) throw new KpiError(404, "location_not_found");

  if (terminalId !== null) {
    const [term] = await db
      .select({ id: terminals.id })
      .from(terminals)
      .where(and(eq(terminals.id, terminalId), eq(terminals.organization_id, organizationId)))
      .limit(1);
    if (!term) throw new KpiError(422, "terminal_other_org");
  }

  await db.update(workly_locations).set({ terminal_id: terminalId, updated_at: sql`now()` }).where(own);
}

/** workly_location_id → terminal_id компании; null у локаций без терминала. */
export async function terminalMap(db: DbLike, companyId: number): Promise<Map<number, string | null>> {
  const rows = await db
    .select({ location: workly_locations.workly_location_id, terminal: workly_locations.terminal_id })
    .from(workly_locations)
    .where(eq(workly_locations.workly_company_id, companyId));
  return new Map(rows.map((r) => [r.location, r.terminal]));
}
