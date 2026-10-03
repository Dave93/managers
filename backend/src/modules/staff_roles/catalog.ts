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
  /** Поисковые слова: то, чем работа называется в жизни. См. SEED_SYNONYMS. */
  synonyms: string[];
}

// Два имени роли, и путать их нельзя.
//
//   name_ru в БД — ОТОБРАЖАЕМОЕ имя. HR правит его через форму, оно уходит в
//   подписи на экранах и в собираемую composePosition строку position.
//
//   PARSE_NAME_BY_CODE ниже — РАЗБОРНОЕ имя, то самое, которое возвращает
//   parsePosition для этой роли. Оно живёт в коде рядом с регулярками, которые
//   его порождают, и переименованию через форму не подлежит вовсе.
//
// Связывает их code, а не строка: ROLE_CODE_BY_PARSE_NAME отображает выход
// разбора в код, дальше роль ищется в БД по коду. Поэтому переименование
// name_ru не может «увести» разбор на чужую роль — оно вообще не участвует в
// опознании. Единственное, на что рискует повлиять переименование, — на
// строку, которую собирает composePosition; это проверяет guard в PUT
// /api/staff-roles/:id (assertRenameSafe ниже).
//
// synonyms — поисковые слова: то, чем работа называется в жизни. Канон убрал
// «(салатчица+мойка)» из 46 строк, и «салатчица» перестала находить кого-либо;
// старые написания «Универсал повар» и «Стажер повар» разошлись с каноном по
// дефису. Всё это лежит здесь, а не в регулярках разбора, потому что поиск и
// разбор — разные задачи: ошибиться в поиске значит не найти, ошибиться в
// разборе значит записать человеку чужую роль.
//
// Узбекские названия — рабочий перевод, HR его ещё не заверял.
export const SEED_ROLES: SeedRole[] = [
  { code: "manager", name_ru: "Менеджер", name_uz: "Menejer", group_key: "management", is_trainee: false, trainee_of_code: null, sort: 10, synonyms: [] },
  { code: "senior_cook", name_ru: "Старший повар", name_uz: "Katta oshpaz", group_key: "kitchen", is_trainee: false, trainee_of_code: null, sort: 20, synonyms: [] },
  { code: "universal_cook", name_ru: "Универсал-повар", name_uz: "Universal oshpaz", group_key: "kitchen", is_trainee: false, trainee_of_code: null, sort: 30, synonyms: ["универсал повар"] },
  { code: "cook", name_ru: "Повар", name_uz: "Oshpaz", group_key: "kitchen", is_trainee: false, trainee_of_code: null, sort: 40, synonyms: [] },
  { code: "kitchen_worker", name_ru: "Работник кухни", name_uz: "Oshxona xodimi", group_key: "kitchen", is_trainee: false, trainee_of_code: null, sort: 50, synonyms: ["салатчица", "мойка"] },
  { code: "cashier", name_ru: "Кассир", name_uz: "Kassir", group_key: "front", is_trainee: false, trainee_of_code: null, sort: 60, synonyms: [] },
  { code: "hall_worker", name_ru: "Работник зала", name_uz: "Zal xodimi", group_key: "front", is_trainee: false, trainee_of_code: null, sort: 70, synonyms: [] },
  { code: "serving", name_ru: "Раздача", name_uz: "Taqsimlash", group_key: "front", is_trainee: false, trainee_of_code: null, sort: 80, synonyms: [] },
  { code: "security", name_ru: "Охрана", name_uz: "Qorovul", group_key: "other", is_trainee: false, trainee_of_code: null, sort: 90, synonyms: [] },
  { code: "nanny", name_ru: "Няня", name_uz: "Enaga", group_key: "other", is_trainee: false, trainee_of_code: null, sort: 100, synonyms: [] },
  { code: "trainee_manager", name_ru: "Стажёр-менеджер", name_uz: "Stajyor menejer", group_key: "management", is_trainee: true, trainee_of_code: "manager", sort: 110, synonyms: ["стажер менеджер"] },
  { code: "trainee_cook", name_ru: "Стажёр-повар", name_uz: "Stajyor oshpaz", group_key: "kitchen", is_trainee: true, trainee_of_code: "cook", sort: 120, synonyms: ["стажер повар"] },
  { code: "trainee_cashier", name_ru: "Стажёр-кассир", name_uz: "Stajyor kassir", group_key: "front", is_trainee: true, trainee_of_code: "cashier", sort: 130, synonyms: ["стажер кассир"] },
];

/**
 * Разборное имя роли: ровно та строка, которую возвращает parsePosition().role.
 *
 * Совпадение с сегодняшним name_ru — историческое, а не обязательное. Разбор
 * живёт в network-map.ts на регулярках и о справочнике не знает; эта таблица —
 * единственный мост между ним и кодами ролей, и она принципиально константная:
 * менять её вправе только тот, кто меняет сами регулярки.
 */
export const PARSE_NAME_BY_CODE: Record<string, string> = {
  manager: "Менеджер",
  senior_cook: "Старший повар",
  universal_cook: "Универсал-повар",
  cook: "Повар",
  kitchen_worker: "Работник кухни",
  cashier: "Кассир",
  hall_worker: "Работник зала",
  serving: "Раздача",
  security: "Охрана",
  nanny: "Няня",
  trainee_manager: "Стажёр-менеджер",
  trainee_cook: "Стажёр-повар",
  trainee_cashier: "Стажёр-кассир",
};

/** Выход разбора → код роли. Обратная сторона PARSE_NAME_BY_CODE. */
export const ROLE_CODE_BY_PARSE_NAME: Record<string, string> = Object.fromEntries(
  Object.entries(PARSE_NAME_BY_CODE).map(([code, name]) => [name, code])
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
  // Роль опознаётся по КОДУ, а не по отображаемому названию: как бы HR ни
  // переименовал роль в справочнике, разбор строки приведёт к тому же коду.
  const code = ROLE_CODE_BY_PARSE_NAME[parsed.role];
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

/**
 * Отображаемое имя роли — HR-редактируемое. Разборное — константа в коде.
 * Единственное место, где переименование ещё способно навредить: строка,
 * которую composePosition кладёт в employees.position. Её продолжают читать
 * все, кто не знает про staff_role_id — прод-бинарь до выката, выгрузки,
 * фильтр по свободному тексту, запасной путь structureOf у записей без роли.
 *
 * Поэтому переименование проверяется здесь, а не подписью под полем: роль
 * «Повар», переименованная в «Повар-универсал», начала бы писать людям строку
 * «Повар-универсал 2 разряд день», которую разбор опознаёт как «Универсал-повар».
 * Строка и колонка разошлись бы молча, и заметил бы это тот, кто через полгода
 * ищет универсалов.
 *
 * Проверяются все двенадцать сочетаний разряда и смены — а не одно название:
 * «Повар 1 разряд» как название роли ломается только вместе с разрядом.
 *
 * Пусто — переименование безопасно.
 */
export interface RenameConflict {
  /** Строка, которую получил бы сотрудник. */
  sample: string;
  /** Роль, которой её считает разбор. */
  parsed_role: string;
  /** Код этой роли, либо null — разбор не узнаёт вовсе. */
  parsed_code: string | null;
  /** Что именно разошлось — иначе отказ выглядит произволом. */
  reason: "role" | "group" | "shift" | "grade" | "trainee";
  /** Что должно было получиться, и что получилось. */
  expected: string;
  got: string;
}

const GRADE_COMBOS: (number | null)[] = [null, 1, 2, 3];
const SHIFT_COMBOS: (string | null)[] = [null, "day", "night"];

export function renameConflicts(code: string, newNameRu: string): RenameConflict[] {
  const canon = PARSE_NAME_BY_CODE[code] ?? null;
  const out: RenameConflict[] = [];
  for (const grade of GRADE_COMBOS) {
    for (const shift of SHIFT_COMBOS) {
      const sample = composePosition(newNameRu, grade, shift);
      const parsed = parsePosition(sample);
      const parsedCode = ROLE_CODE_BY_PARSE_NAME[parsed.role] ?? null;

      let reason: RenameConflict["reason"] | null = null;
      let expected = "";
      let got = "";

      if (canon) {
        // Роль, которую разбор знает: собранная строка обязана разбираться в
        // неё же и по всем пяти полям — иначе группа, смена или разряд уедут.
        const want = parsePosition(composePosition(canon, grade, shift));
        if (parsedCode !== code) {
          reason = "role";
          expected = canon;
          got = parsed.role;
        } else if (parsed.group !== want.group) {
          reason = "group";
          expected = want.group;
          got = parsed.group;
        } else if (parsed.shift !== want.shift) {
          reason = "shift";
          expected = want.shift;
          got = parsed.shift;
        } else if (parsed.grade !== want.grade) {
          reason = "grade";
          expected = want.grade ?? "без разряда";
          got = parsed.grade ?? "без разряда";
        } else if (parsed.is_trainee !== want.is_trainee) {
          reason = "trainee";
          expected = want.is_trainee ? "стажёр" : "не стажёр";
          got = parsed.is_trainee ? "стажёр" : "не стажёр";
        }
      } else if (parsedCode !== null) {
        // Роль, заведённая HR: разбор её не знает и знать не обязан. Запретить
        // нужно ровно одно — уехать в ЧУЖУЮ роль, которую разбор знает.
        // Роли нет в PARSE_NAME_BY_CODE — сравнивать не с чем, поэтому
        // expected остаётся пустым: сообщение об этом случае своё.
        reason = "role";
        expected = "";
        got = parsed.role;
      }

      if (!reason) continue;
      out.push({ sample, parsed_role: parsed.role, parsed_code: parsedCode, reason, expected, got });
    }
  }
  return out;
}

/**
 * Синонимы приходят из формы списком строк. Чистим по-минимуму: пробелы по
 * краям, пустые строки, повторы без учёта регистра. Ниже регистр не важен —
 * поиск идёт через ilike.
 */
export function normalizeSynonyms(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of v) {
    if (typeof raw !== "string") continue;
    const w = raw.trim().replace(/\s+/g, " ");
    if (!w) continue;
    const key = w.toLowerCase().replace(/ё/g, "е");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(w);
  }
  return out;
}

export type { Group, Shift };
