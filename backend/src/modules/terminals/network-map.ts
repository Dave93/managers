import { ctx } from "@backend/context";
import { terminals, employees, organization, staff_roles } from "backend/drizzle/schema";
import { eq, and, inArray, isNotNull } from "drizzle-orm";
import { resolveIsHq } from "@backend/lib/resolve-is-hq";
import { staffRolesController } from "../staff_roles/controller";
import Elysia from "elysia";

// Карта сети: филиалы с разобранным составом команд.
//
// Должность в employees — одна свободная строка вида «Повар 1 разряд ночь» или
// «Работник кухни  (салатчица+мойка) 2 раяряд день». Разбирать её на фронте
// значит размазать знание про опечатки и падежи по компонентам, поэтому весь
// парсинг живёт здесь, а наружу уходит уже структура.
//
// Честность важнее красоты: филиал без строк в employees и филиал, где реально
// никто не числится, выглядят одинаково в данных, но означают разное. Поэтому
// в ответе есть has_staff_data — карта обязана отличать «данные не заведены»
// от «людей нет», иначе половина сети читается как закрытая.

export type Group = "kitchen" | "front" | "management" | "other";
export type Shift = "day" | "night" | "unknown";

const NIGHT = /ночь|tun/i;
const DAY = /день|kun/i;
const TRAINEE = /стажер|стажёр|stajyor/i;
// «раяряд» — не опечатка здесь, а опечатка в самих данных, встречается 10 раз.
const GRADE = /([123])\s*(?:разряд|раяряд)/i;

function groupOf(p: string): Group {
  const s = p.toLowerCase();
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

/** Строка сотрудника в том виде, в каком её отдаёт база после миграции. */
export interface StaffRow {
  position: string | null;
  role_name_ru?: string | null;
  role_group?: string | null;
  role_is_trainee?: boolean | null;
  grade?: number | null;
  shift?: string | null;
  is_trainee?: boolean | null;
}

/**
 * Структура должности сотрудника: сначала проставленные поля, и только если
 * роли нет — разбор строки.
 *
 * Смешивать источники внутри одной записи нельзя. Если роль проставлена, то
 * проставлены и разряд, и смена (их пишет один и тот же композитор), а NULL в
 * shift означает «смена не указана», а не «поле забыли заполнить» — у охраны и
 * няни смены нет вовсе. Подставлять сюда результат разбора строки значило бы
 * придумывать людям ночные смены из формулировки должности.
 */
export function structureOf(row: StaffRow): ParsedPosition {
  if (row.role_name_ru) {
    const g = (row.role_group ?? "other") as Group;
    return {
      role: row.role_name_ru,
      group: g === "kitchen" || g === "front" || g === "management" ? g : "other",
      shift: row.shift === "day" || row.shift === "night" ? row.shift : "unknown",
      grade: row.grade != null ? String(row.grade) : null,
      is_trainee: row.is_trainee ?? row.role_is_trainee ?? false,
    };
  }
  return parsePosition(row.position);
}

// Регистрируется НЕ в цепочке apiController, а на корне приложения, с
// расширением типа до Elysia — тот же приём, что у passportController и
// creditAdminController. Причина ровно та же и проверена сборкой: цепочка
// apiController уже стоит у предела глубины инстанцирования TypeScript, и
// любой лишний .use() в ней роняет сборку админки с TS2589 в backend/src/app.ts.
// Отсюда же и prefix: "/api" — вне apiController префикс никто не подставит.
const networkMapControllerImpl = new Elysia({
  name: "@api/network-map",
  prefix: "/api",
})
  .use(ctx)
  // Справочник ролей висит на этой же цепочке, а не отдельной строкой в app.ts,
  // сознательно: app.ts сейчас держит незакоммиченную чужую работу, и трогать
  // его ради двух строк регистрации значит утащить её в чужой коммит. Префикс
  // "/api" при этом достаётся дочернему плагину от этого инстанса, поэтому в
  // самом controller.ts путей с "/api" нет.
  .use(staffRolesController)
  .get(
    "/terminals/network-map",
    // Скоуп и признак HQ берутся ровно так же, как в attestation/controller.ts:
    // resolveIsHq принимает { user, role, cacheController }, а список филиалов
    // роли лежит в контексте (ctx.terminals), не в user. Здесь это было вызвано
    // по другой, несуществующей сигнатуре — resolveIsHq молча возвращал false
    // для всех, а scope всегда был пустым, из-за чего эндпоинт отдавал пустую
    // сеть даже головному офису.
    async ({ drizzle, user, role, terminals: scope, cacheController }) => {
      const isHQ = await resolveIsHq({ user, role, cacheController });
      if (!isHQ && !scope.length) {
        return { network: null, branches: [], scope: { is_hq: false, terminal_count: 0 } };
      }

      const where = [eq(terminals.active, true)];
      if (!isHQ) where.push(inArray(terminals.id, scope));

      const rows = await drizzle
        .select({
          id: terminals.id,
          name: terminals.name,
          address: terminals.address,
          manager_name: terminals.manager_name,
          latitude: terminals.latitude,
          longitude: terminals.longitude,
          playground: terminals.playground_enabled,
          brand: organization.name,
        })
        .from(terminals)
        .leftJoin(organization, eq(organization.id, terminals.organization_id))
        .where(and(...where))
        .execute();

      const ids = rows.map((r) => r.id);
      const staff = ids.length
        ? await drizzle
            .select({
              terminal_id: employees.terminal_id,
              position: employees.position,
              grade: employees.grade,
              shift: employees.shift,
              is_trainee: employees.is_trainee,
              role_name_ru: staff_roles.name_ru,
              role_group: staff_roles.group_key,
              role_is_trainee: staff_roles.is_trainee,
            })
            .from(employees)
            .leftJoin(staff_roles, eq(staff_roles.id, employees.staff_role_id))
            .where(and(eq(employees.active, true), inArray(employees.terminal_id, ids)))
            .execute()
        : [];

      const byBranch = new Map<string, { roles: Map<string, number>; groups: Record<Group, number>; shifts: Record<Shift, number>; grades: Record<string, number>; trainees: number; total: number }>();
      for (const s of staff) {
        const parsed = structureOf(s);
        let b = byBranch.get(s.terminal_id);
        if (!b) {
          b = { roles: new Map(), groups: { kitchen: 0, front: 0, management: 0, other: 0 }, shifts: { day: 0, night: 0, unknown: 0 }, grades: {}, trainees: 0, total: 0 };
          byBranch.set(s.terminal_id, b);
        }
        b.roles.set(parsed.role, (b.roles.get(parsed.role) ?? 0) + 1);
        b.groups[parsed.group]++;
        b.shifts[parsed.shift]++;
        const key = parsed.grade ?? "—";
        b.grades[key] = (b.grades[key] ?? 0) + 1;
        if (parsed.is_trainee) b.trainees++;
        b.total++;
      }

      const branches = rows
        .map((r) => {
          const b = byBranch.get(r.id);
          const hasCoords = r.latitude != null && r.longitude != null && (r.latitude !== 0 || r.longitude !== 0);
          return {
            id: r.id,
            name: r.name,
            address: r.address,
            manager_name: r.manager_name,
            brand: /les/i.test(r.brand ?? "") ? "les" : /chopar/i.test(r.brand ?? "") ? "chopar" : "other",
            brand_name: r.brand,
            playground: !!r.playground,
            lat: hasCoords ? r.latitude : null,
            lon: hasCoords ? r.longitude : null,
            has_coords: hasCoords,
            has_staff_data: !!b,
            staff: {
              total: b?.total ?? 0,
              trainees: b?.trainees ?? 0,
              groups: b?.groups ?? { kitchen: 0, front: 0, management: 0, other: 0 },
              shifts: b?.shifts ?? { day: 0, night: 0, unknown: 0 },
              grades: b?.grades ?? {},
              // Тай-брейк по названию обязателен: без него порядок ролей с
              // одинаковым числом людей задаётся порядком строк в employees, а
              // он меняется от любого UPDATE. Экран из-за этого «моргал»
              // перестановкой ролей там, где ничего не менялось.
              roles: b
                ? [...b.roles.entries()]
                    .map(([role, n]) => ({ role, n }))
                    .sort((x, y) => y.n - x.n || x.role.localeCompare(y.role, "ru"))
                : [],
            },
          };
        })
        .sort((a, z) => z.staff.total - a.staff.total || a.name.localeCompare(z.name));

      const withData = branches.filter((b) => b.has_staff_data);
      const network = {
        branches_total: branches.length,
        branches_with_staff_data: withData.length,
        branches_without_staff_data: branches.length - withData.length,
        branches_on_map: branches.filter((b) => b.has_coords).length,
        staff_total: branches.reduce((s, b) => s + b.staff.total, 0),
        trainees_total: branches.reduce((s, b) => s + b.staff.trainees, 0),
        shifts: {
          day: branches.reduce((s, b) => s + b.staff.shifts.day, 0),
          night: branches.reduce((s, b) => s + b.staff.shifts.night, 0),
          unknown: branches.reduce((s, b) => s + b.staff.shifts.unknown, 0),
        },
        groups: {
          kitchen: branches.reduce((s, b) => s + b.staff.groups.kitchen, 0),
          front: branches.reduce((s, b) => s + b.staff.groups.front, 0),
          management: branches.reduce((s, b) => s + b.staff.groups.management, 0),
          other: branches.reduce((s, b) => s + b.staff.groups.other, 0),
        },
        by_brand: ["les", "chopar"].map((br) => ({
          brand: br,
          branches: branches.filter((b) => b.brand === br).length,
          staff: branches.filter((b) => b.brand === br).reduce((s, b) => s + b.staff.total, 0),
        })),
      };

      return { network, branches, scope: { is_hq: isHQ, terminal_count: scope.length } };
    },
    { permission: "employees.list" }
  );

export const networkMapController = networkMapControllerImpl as unknown as Elysia;
