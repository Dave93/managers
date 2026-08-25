import type { staff_roles } from "backend/drizzle/schema";
import { parsePosition, type Group, type Shift } from "../terminals/network-map";

// Справочник ролей и сборка канонической строки должности.
//
// До этого модуля структура должности существовала только в виде регулярок над
// свободной строкой: 45 написаний на 386 человек, «раяряд» вместо «разряд»
// десять раз, двойные пробелы, скобки «(салатчица+мойка)». Разбор жил в
// parsePosition и работал, но перевести человека в ночь можно было только
// переписав строку целиком и не ошибившись в формулировке.
//
// Здесь ровно две вещи и ни одной больше:
//   1. SEED_ROLES — что вообще бывает. Список закрыт данными, а не фантазией:
//      каждая роль встречается в employees.position хотя бы один раз.
//   2. composePosition — как из роли, разряда и смены собирается та самая
//      строка. Единый шаблон, чтобы новые записи перестали ломать разбор.
//
// Разбор строки НЕ дублируется: parsePosition остаётся единственным, он
// импортируется из terminals/network-map.

export interface SeedRole {
  code: string;
  name_ru: string;
  name_uz: string;
  group_key: Group;
  is_trainee: boolean;
  /** code роли, на которую учится стажёр. */
  trainee_of_code: string | null;
  sort: number;
}

// name_ru здесь — не украшение, а контракт: ровно эти строки уже возвращает
// parsePosition и ровно их показывают «Карта сети» и «Состав филиалов». Менять
// их нельзя, не сломав подписи на обоих экранах и не разойдясь с разбором:
// composePosition собирает position из name_ru, а parsePosition обязан узнать
// в собранной строке ту же самую роль.
//
// Узбекские названия — рабочий перевод, HR его ещё не заверял.
export const SEED_ROLES: SeedRole[] = [
  { code: "manager", name_ru: "Менеджер", name_uz: "Menejer", group_key: "management", is_trainee: false, trainee_of_code: null, sort: 10 },
  { code: "senior_cook", name_ru: "Старший повар", name_uz: "Katta oshpaz", group_key: "kitchen", is_trainee: false, trainee_of_code: null, sort: 20 },
  { code: "universal_cook", name_ru: "Универсал-повар", name_uz: "Universal oshpaz", group_key: "kitchen", is_trainee: false, trainee_of_code: null, sort: 30 },
  { code: "cook", name_ru: "Повар", name_uz: "Oshpaz", group_key: "kitchen", is_trainee: false, trainee_of_code: null, sort: 40 },
  { code: "kitchen_worker", name_ru: "Работник кухни", name_uz: "Oshxona xodimi", group_key: "kitchen", is_trainee: false, trainee_of_code: null, sort: 50 },
  { code: "cashier", name_ru: "Кассир", name_uz: "Kassir", group_key: "front", is_trainee: false, trainee_of_code: null, sort: 60 },
  { code: "hall_worker", name_ru: "Работник зала", name_uz: "Zal xodimi", group_key: "front", is_trainee: false, trainee_of_code: null, sort: 70 },
  { code: "serving", name_ru: "Раздача", name_uz: "Taqsimlash", group_key: "front", is_trainee: false, trainee_of_code: null, sort: 80 },
  { code: "security", name_ru: "Охрана", name_uz: "Qorovul", group_key: "other", is_trainee: false, trainee_of_code: null, sort: 90 },
  { code: "nanny", name_ru: "Няня", name_uz: "Enaga", group_key: "other", is_trainee: false, trainee_of_code: null, sort: 100 },
  { code: "trainee_manager", name_ru: "Стажёр-менеджер", name_uz: "Stajyor menejer", group_key: "management", is_trainee: true, trainee_of_code: "manager", sort: 110 },
  { code: "trainee_cook", name_ru: "Стажёр-повар", name_uz: "Stajyor oshpaz", group_key: "kitchen", is_trainee: true, trainee_of_code: "cook", sort: 120 },
  { code: "trainee_cashier", name_ru: "Стажёр-кассир", name_uz: "Stajyor kassir", group_key: "front", is_trainee: true, trainee_of_code: "cashier", sort: 130 },
];

/** Русское название → код. Ключ ровно тот, что возвращает parsePosition().role. */
export const ROLE_CODE_BY_NAME_RU: Record<string, string> = Object.fromEntries(
  SEED_ROLES.map((r) => [r.name_ru, r.code])
);

export const SHIFT_WORD: Record<"day" | "night", string> = {
  day: "день",
  night: "ночь",
};

/**
 * Единый шаблон строки должности: «Роль[ N разряд][ смена]».
 *
 * Обратная совместимость держится именно здесь. position продолжает читать
 * фильтр аттестации (ilike), паспорт стажёра и колонка в админке, поэтому
 * строка обязана и остаться человеческой, и разбираться обратно: для любой
 * роли из справочника parsePosition(composePosition(...)) даёт те же пять
 * полей, что были на входе. Это проверяется в backfill перед каждой записью.
 */
export function composePosition(
  nameRu: string,
  grade: number | null | undefined,
  shift: string | null | undefined
): string {
  const parts = [nameRu.trim()];
  if (grade != null) parts.push(`${grade} разряд`);
  if (shift === "day" || shift === "night") parts.push(SHIFT_WORD[shift]);
  return parts.join(" ");
}

/** «unknown»/""/undefined с фронта означают ровно одно: смена не указана. */
export function normalizeShift(v: unknown): "day" | "night" | null {
  return v === "day" || v === "night" ? v : null;
}

export function normalizeGrade(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : null;
  return n === 1 || n === 2 || n === 3 ? n : null;
}

export interface StructuredPosition {
  position: string | null;
  staff_role_id: string | null;
  grade: number | null;
  shift: "day" | "night" | null;
  is_trainee: boolean | null;
}

type RoleRow = typeof staff_roles.$inferSelect;

/**
 * Приводит вход сотрудника к структуре + канонической строке.
 *
 * Два пути, и оба обязаны существовать:
 *
 *   — роль задана явно (новая форма): структура ведущая, position собирается;
 *   — пришла только строка (старая форма админки, которую этот заход не
 *     трогает, и любой внешний импорт): строка разбирается parsePosition, поля
 *     заполняются тем, что удалось узнать. Без этого каждый новый сотрудник
 *     после выката приезжал бы с пустой ролью, и данные разъехались бы с
 *     первого же дня.
 *
 * is_trainee всегда берётся из справочника, а не из тела запроса: стажёрство —
 * свойство роли, и клиент не должен уметь объявить менеджера стажёром.
 */
export function structureFrom(
  roles: RoleRow[],
  input: {
    position?: string | null;
    staff_role_id?: string | null;
    grade?: unknown;
    shift?: unknown;
  },
  hasStructuredInput: boolean
): StructuredPosition {
  const grade = normalizeGrade(input.grade);
  const shift = normalizeShift(input.shift);

  if (hasStructuredInput && input.staff_role_id) {
    const role = roles.find((r) => r.id === input.staff_role_id);
    if (!role) return { position: input.position ?? null, staff_role_id: null, grade, shift, is_trainee: null };
    return {
      position: composePosition(role.name_ru, grade, shift),
      staff_role_id: role.id,
      grade,
      shift,
      is_trainee: role.is_trainee,
    };
  }

  const raw = input.position ?? null;
  if (raw == null) return { position: null, staff_role_id: null, grade, shift, is_trainee: null };

  const parsed = parsePosition(raw);
  const code = ROLE_CODE_BY_NAME_RU[parsed.role];
  const role = code ? roles.find((r) => r.code === code) : undefined;
  const parsedGrade = parsed.grade ? Number(parsed.grade) : null;
  const parsedShift: "day" | "night" | null = parsed.shift === "unknown" ? null : parsed.shift;

  if (!role) {
    // Роль не опознана — строку не трогаем вовсе. Тихо записать «прочее» здесь
    // значит потерять единственное место, где эта должность ещё видна.
    return { position: raw, staff_role_id: null, grade: parsedGrade, shift: parsedShift, is_trainee: parsed.is_trainee };
  }
  return {
    position: composePosition(role.name_ru, parsedGrade, parsedShift),
    staff_role_id: role.id,
    grade: parsedGrade,
    shift: parsedShift,
    is_trainee: role.is_trainee,
  };
}

/**
 * Совпадает ли разбор канонической строки с разбором исходной по всем пяти
 * полям. Только это и означает «разобралось уверенно»: строку переписываем
 * лишь тогда, когда переписывание ничего не меняет для тех, кто её читает.
 */
export function roundTrips(original: string, canonical: string): boolean {
  const a = parsePosition(original);
  const b = parsePosition(canonical);
  return (
    a.role === b.role &&
    a.group === b.group &&
    a.shift === b.shift &&
    a.grade === b.grade &&
    a.is_trainee === b.is_trainee
  );
}

export type { Group, Shift };
