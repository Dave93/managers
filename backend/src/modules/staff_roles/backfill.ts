import { drizzleDb } from "../../lib/db";
import { employees, staff_roles } from "backend/drizzle/schema";
import { eq } from "drizzle-orm";
import {
  ROLE_CODE_BY_NAME_RU,
  composePosition,
  roundTrips,
} from "./catalog";
import { parsePosition } from "../terminals/network-map";

// Разбор 386 живых строк должности и проставление новых полей.
//
// Разбор здесь не свой: parsePosition импортируется из network-map, третьего
// парсера в бэкенде нет и не будет. Задача скрипта — решить, что делать с
// результатом, и решение ровно одно на каждую строку:
//
//   canon  — роль опознана И parsePosition(канон) совпадает с parsePosition
//            (оригинал) по всем пяти полям. Только тогда строку переписываем:
//            переписывание, которое ничего не меняет для читателей строки, —
//            единственное безопасное.
//   fields — роль опознана, но канон разбирается иначе. Поля проставляем,
//            строку не трогаем.
//   skip   — роль не опознана. Не трогаем ничего, кроме того, что точно
//            известно из разбора, и выносим строку в отчёт. Записать таких в
//            «прочее» значило бы спрятать единственное место, где эта
//            должность ещё видна.
//
// Запуск без --apply ничего не пишет и печатает тот же отчёт.

const APPLY = process.argv.includes("--apply");

const roles = await drizzleDb.select().from(staff_roles).execute();
const roleByCode = new Map(roles.map((r) => [r.code, r]));

const rows = await drizzleDb.select().from(employees).execute();

type Verdict = "canon" | "fields" | "skip";
interface Plan {
  id: string;
  original: string | null;
  verdict: Verdict;
  position: string | null;
  staff_role_id: string | null;
  grade: number | null;
  shift: "day" | "night" | null;
  is_trainee: boolean | null;
}

const plans: Plan[] = [];
const unresolved = new Map<string, number>();
const notCanon = new Map<string, number>();

for (const e of rows) {
  const parsed = parsePosition(e.position);
  const code = ROLE_CODE_BY_NAME_RU[parsed.role];
  const role = code ? roleByCode.get(code) : undefined;
  const grade = parsed.grade ? Number(parsed.grade) : null;
  const shift: "day" | "night" | null =
    parsed.shift === "unknown" ? null : parsed.shift;

  if (!role) {
    unresolved.set(e.position ?? "<NULL>", (unresolved.get(e.position ?? "<NULL>") ?? 0) + 1);
    plans.push({
      id: e.id,
      original: e.position,
      verdict: "skip",
      position: e.position,
      staff_role_id: null,
      grade,
      shift,
      is_trainee: parsed.is_trainee,
    });
    continue;
  }

  const canonical = composePosition(role.name_ru, grade, shift);
  const ok = e.position != null && roundTrips(e.position, canonical);
  if (!ok) {
    notCanon.set(e.position ?? "<NULL>", (notCanon.get(e.position ?? "<NULL>") ?? 0) + 1);
  }
  plans.push({
    id: e.id,
    original: e.position,
    verdict: ok ? "canon" : "fields",
    position: ok ? canonical : e.position,
    staff_role_id: role.id,
    grade,
    shift,
    is_trainee: role.is_trainee,
  });
}

const byVerdict = plans.reduce<Record<string, number>>((a, p) => {
  a[p.verdict] = (a[p.verdict] ?? 0) + 1;
  return a;
}, {});

const rewritten = plans.filter((p) => p.verdict === "canon" && p.position !== p.original).length;

console.log(
  JSON.stringify(
    {
      apply: APPLY,
      rows: rows.length,
      verdicts: byVerdict,
      position_strings_rewritten: rewritten,
      unresolved: [...unresolved.entries()].map(([position, n]) => ({ position, n })),
      canon_refused: [...notCanon.entries()].map(([position, n]) => ({ position, n })),
    },
    null,
    2
  )
);

if (!APPLY) {
  console.log("dry run — nothing written");
  process.exit(0);
}

let written = 0;
await drizzleDb.transaction(async (tx) => {
  for (const p of plans) {
    await tx
      .update(employees)
      .set({
        position: p.position,
        staff_role_id: p.staff_role_id,
        grade: p.grade,
        shift: p.shift,
        is_trainee: p.is_trainee,
      })
      .where(eq(employees.id, p.id))
      .execute();
    written++;
  }
});
console.log(`written ${written}`);
process.exit(0);
