// Разбор строки должности («Повар 1 разряд ночь») в структуру. Чистый модуль без Elysia, базы и Redis:
// вынесен из network-map.ts, чтобы воркер (cron/kpi_worker.ts) мог взять справочник ролей
// (staff_roles/catalog.ts) и не тянул за ним весь HTTP-контекст бэкенда. network-map.ts
// по-прежнему отдаёт те же имена (переэкспорт), прежние импорты работают без изменений.
// Строки пишутся вручную, с опечатками и лишними пробелами («Работник кухни  (салатчица+мойка)
// 2 раяряд день»), поэтому регулярки ниже терпимы к ним. Про честность данных карты сети
// (has_staff_data): см. комментарий в network-map.ts.

export type Group = "kitchen" | "front" | "management" | "other";
export type Shift = "day" | "night" | "unknown";

const NIGHT = /ночь|tun/i;
const DAY = /день|kun/i;
const TRAINEE = /стажер|стажёр|stajyor/i;
// «раяряд» — не опечатка здесь, а опечатка в самих данных, встречается 10 раз.
const GRADE = /([123])\s*(?:разряд|раяряд)/i;

function groupOf(p: string): Group {
  const s = p.toLowerCase();
  // «Техничка зала» и «техничка (мойка)» не должны уехать в зал и на кухню.
  if (/техничк/.test(s)) return "other";
  if (/менеджер/.test(s)) return "management";
  if (/повар|кухн|салатчиц|мойк/.test(s)) return "kitchen";
  if (/кассир|зал|раздач/.test(s)) return "front";
  return "other";
}
function shiftOf(p: string): Shift {
  if (NIGHT.test(p)) return "night";
  if (DAY.test(p)) return "day";
  return "unknown";
}
function roleOf(p: string): string {
  const s = p.toLowerCase();
  if (/стажер|стажёр/.test(s)) {
    if (/менеджер/.test(s)) return "Стажёр-менеджер";
    if (/кассир/.test(s)) return "Стажёр-кассир";
    return "Стажёр-повар";
  }
  // Раньше «менеджер», «кассир», «мойк» и «зал»: «Техничка зала» и «техничка (мойка)» — техничка.
  if (/техничк/.test(s)) return "Техничка";
  if (/универсал/.test(s)) return "Универсал-повар";
  if (/старш/.test(s)) return "Старший повар";
  if (/менеджер/.test(s)) return "Менеджер";
  if (/кассир/.test(s)) return "Кассир";
  if (/салатчиц|мойк|работник кухни/.test(s)) return "Работник кухни";
  if (/зал/.test(s)) return "Работник зала";
  if (/раздач/.test(s)) return "Раздача";
  if (/охран/.test(s)) return "Охрана";
  if (/няня/.test(s)) return "Няня";
  if (/повар/.test(s)) return "Повар";
  return p.trim() || "Без должности";
}

export interface ParsedPosition {
  role: string;
  group: Group;
  shift: Shift;
  /** «1» | «2» | «3», либо null — в строке должности разряда нет. */
  grade: string | null;
  is_trainee: boolean;
}

// Единственная точка разбора должности во всём бэкенде — и с появлением полей
// staff_role_id / grade / shift / is_trainee уже запасная, а не основная.
//
// Основной путь теперь такой: роль лежит в employees.staff_role_id, разряд и
// смена — в своих колонках, и оба экрана читают их напрямую. Разбор строки
// остаётся ровно для одного случая: у строки нет проставленной роли — запись
// приехала мимо API либо её должность справочник не опознал. Тогда лучше
// разобрать текст, чем показать пустоту.
//
// Карта сети (этот файл) и «Состав филиалов» (staff-board.ts) читают одну и ту
// же строку из employees.position, и разбирать её дважды нельзя: опечатка
// «раяряд» правится один раз, иначе два экрана начнут спорить о том, сколько в
// сети поваров второго разряда. Отличие экранов не в разборе, а в том, что
// карте хватает агрегатов, а карточкам нужны сами люди.
export function parsePosition(position: string | null | undefined): ParsedPosition {
  const p = position ?? "";
  const g = GRADE.exec(p);
  return {
    role: roleOf(p),
    group: groupOf(p),
    shift: shiftOf(p),
    grade: g ? g[1] : null,
    is_trainee: TRAINEE.test(p),
  };
}
