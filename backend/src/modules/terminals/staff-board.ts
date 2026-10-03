import { ctx } from "@backend/context";
import { terminals, employees, organization, staff_roles } from "backend/drizzle/schema";
import { eq, and, inArray } from "drizzle-orm";
import { resolveIsHq } from "@backend/lib/resolve-is-hq";
import Elysia from "elysia";

import { structureOf, type Group, type Shift } from "./network-map";

// Состав филиалов: карточка на филиал, а внутри — конкретные люди.
//
// Отличие от /terminals/network-map ровно одно, и оно определяет весь эндпоинт:
// карте хватает агрегатов (сколько поваров, сколько ночью), а карточке нужны
// сами люди — иначе руководитель не может сказать, КОГО не хватает. Структура
// должности при этом общая: structureOf живёт в network-map.ts и импортируется
// сюда. Читает она проставленные поля (staff_role_id, grade, shift), а к разбору
// строки откатывается только там, где роль ещё не проставлена, — и делает это
// один раз на оба экрана, чтобы они не разошлись в подсчёте поваров.
//
// Два факта, которые эндпоинт обязан не смешать:
//
//   1. has_staff_data. Филиал, по которому в employees нет ни одной строки, и
//      филиал, где реально никого нет, в данных выглядят одинаково, а означают
//      разное. Сейчас таких «без данных» 38 из 72 — больше половины сети. На
//      таком филиале нельзя завести стажировку: паспорт стажёра заводится на
//      employees, значит там он просто не заработает. Экран обязан говорить это
//      прямо, а не показывать ноль в кружке.
//
//   2. Сигналы. Смысл экрана не в списке фамилий, а в том, где команда собрана
//      неправильно: нет менеджера, нет старшего повара, никто не работает ночью,
//      стажёров больше трети. Считаются они здесь, а не на клиенте, — по той же
//      причине, что и разбор должности: правило должно быть одно.

type SignalKey =
  | "no_manager"
  | "no_senior_cook"
  | "no_night"
  | "trainee_heavy"
  | "no_pin";

interface Signal {
  key: SignalKey;
  label: string;
  detail: string;
  /** warn — команда собрана неправильно; info — пробел в данных, не в команде. */
  severity: "warn" | "info";
}

/** Выше этой доли стажёров филиал тянет обучение, а не работает. */
const TRAINEE_ALERT = 1 / 3;

const GROUP_RANK: Record<Group, number> = {
  management: 0,
  kitchen: 1,
  front: 2,
  other: 3,
};
const SHIFT_RANK: Record<Shift, number> = { day: 0, night: 1, unknown: 2 };

// Имена в справочнике лежат латиницей и капсом: ZULAYHO AHMADJONOVA. Читать
// такое списком невозможно, поэтому приводим к человеческому виду — но только
// регистр: ни отчеств, ни перестановки first_name/last_name, в базе они
// разложены по колонкам и додумывать за неё нечего.
//
// После апострофа регистр НЕ поднимается: в узбекской латинице это окина
// (O'SAROV, ULUG'BEK), и «O'Sarov» было бы уже другой фамилией.
function humanName(raw: string | null | undefined): string {
  const s = (raw ?? "").trim();
  if (!s) return "";
  return s
    .toLocaleLowerCase("ru-RU")
    .split(/(\s+|-)/)
    .map((part) =>
      /^[\s-]+$/.test(part) || part.length === 0
        ? part
        : part[0].toLocaleUpperCase("ru-RU") + part.slice(1)
    )
    .join("");
}

function initialsOf(first: string, last: string): string {
  const a = first.trim()[0] ?? "";
  const b = last.trim()[0] ?? "";
  return (a + b).toLocaleUpperCase("ru-RU");
}

// Регистрируется НЕ в цепочке apiController, а на корне приложения, с
// расширением типа до Elysia — тот же приём и та же причина, что у
// networkMapController по соседству: цепочка apiController стоит у предела
// глубины инстанцирования TypeScript, и лишний .use() в ней роняет сборку
// админки с TS2589. Отсюда же prefix: "/api" — вне apiController префикс
// никто не подставит.
const staffBoardControllerImpl = new Elysia({
  name: "@api/staff-board",
  prefix: "/api",
})
  .use(ctx)
  .get(
    "/terminals/staff-board",
    // Скоуп и признак HQ — ровно как в network-map.ts и attestation/controller.ts:
    // resolveIsHq принимает { user, role, cacheController }, а филиалы роли
    // приходят из контекста (ctx.terminals), не из user. Вызов по любой другой
    // сигнатуре молча вернёт false, и головной офис увидит пустую сеть.
    async ({ drizzle, user, role, terminals: scope, cacheController }) => {
      const isHQ = await resolveIsHq({ user, role, cacheController });
      if (!isHQ && !scope.length) {
        return {
          network: null,
          branches: [],
          scope: { is_hq: false, terminal_count: 0 },
        };
      }

      const where = [eq(terminals.active, true)];
      if (!isHQ) where.push(inArray(terminals.id, scope));

      const rows = await drizzle
        .select({
          id: terminals.id,
          name: terminals.name,
          address: terminals.address,
          manager_name: terminals.manager_name,
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
              id: employees.id,
              terminal_id: employees.terminal_id,
              first_name: employees.first_name,
              last_name: employees.last_name,
              position: employees.position,
              pin_hash: employees.pin_hash,
              staff_role_id: employees.staff_role_id,
              grade: employees.grade,
              shift: employees.shift,
              is_trainee: employees.is_trainee,
              role_code: staff_roles.code,
              role_name_ru: staff_roles.name_ru,
              role_name_uz: staff_roles.name_uz,
              role_group: staff_roles.group_key,
              role_is_trainee: staff_roles.is_trainee,
            })
            .from(employees)
            .leftJoin(staff_roles, eq(staff_roles.id, employees.staff_role_id))
            .where(
              and(
                eq(employees.active, true),
                inArray(employees.terminal_id, ids)
              )
            )
            .execute()
        : [];

      interface Person {
        id: string;
        first_name: string;
        last_name: string;
        name: string;
        initials: string;
        position: string | null;
        role: string;
        /** null — роль ещё не проставлена, структура взята разбором строки. */
        role_id: string | null;
        role_code: string | null;
        role_name_uz: string | null;
        group: Group;
        shift: Shift;
        grade: string | null;
        is_trainee: boolean;
        has_pin: boolean;
      }

      const byBranch = new Map<string, Person[]>();
      for (const s of staff) {
        const parsed = structureOf(s);
        const first = humanName(s.first_name);
        const last = humanName(s.last_name);
        const list = byBranch.get(s.terminal_id) ?? [];
        list.push({
          id: s.id,
          first_name: first,
          last_name: last,
          name: [first, last].filter(Boolean).join(" "),
          initials: initialsOf(first, last),
          position: s.position,
          role: parsed.role,
          role_id: s.staff_role_id,
          role_code: s.role_code,
          role_name_uz: s.role_name_uz,
          group: parsed.group,
          shift: parsed.shift,
          grade: parsed.grade,
          is_trainee: parsed.is_trainee,
          has_pin: !!s.pin_hash,
        });
        byBranch.set(s.terminal_id, list);
      }

      const branches = rows
        .map((r) => {
          // Пустой массив и отсутствие ключа — разные вещи: ключ появляется
          // только если по филиалу есть хоть одна строка в справочнике.
          const people = byBranch.get(r.id);
          const hasStaffData = people !== undefined;
          const list = people ?? [];

          list.sort(
            (a, b) =>
              GROUP_RANK[a.group] - GROUP_RANK[b.group] ||
              SHIFT_RANK[a.shift] - SHIFT_RANK[b.shift] ||
              a.role.localeCompare(b.role, "ru") ||
              a.last_name.localeCompare(b.last_name, "ru")
          );

          const groups: Record<Group, number> = {
            kitchen: 0,
            front: 0,
            management: 0,
            other: 0,
          };
          const shifts: Record<Shift, number> = {
            day: 0,
            night: 0,
            unknown: 0,
          };
          const grades: Record<string, number> = {};
          const roleCount = new Map<string, number>();
          let trainees = 0;
          let pinSet = 0;
          for (const p of list) {
            groups[p.group]++;
            shifts[p.shift]++;
            grades[p.grade ?? "—"] = (grades[p.grade ?? "—"] ?? 0) + 1;
            roleCount.set(p.role, (roleCount.get(p.role) ?? 0) + 1);
            if (p.is_trainee) trainees++;
            if (p.has_pin) pinSet++;
          }
          const total = list.length;

          const signals: Signal[] = [];
          if (hasStaffData && total > 0) {
            if (groups.management === 0)
              signals.push({
                key: "no_manager",
                label: "Нет менеджера",
                detail:
                  "в справочнике филиала нет ни менеджера, ни стажёра-менеджера",
                severity: "warn",
              });
            if ((roleCount.get("Старший повар") ?? 0) === 0)
              signals.push({
                key: "no_senior_cook",
                label: "Нет старшего повара",
                detail:
                  "смену некому вести по кухне: старшего повара в составе нет",
                severity: "warn",
              });
            if (shifts.night === 0)
              signals.push({
                key: "no_night",
                label: "Никто не в ночь",
                detail:
                  shifts.unknown === total
                    ? "смена не указана ни у кого — ночная бригада может быть, но справочник о ней молчит"
                    : "ни у одного сотрудника в должности не указана ночная смена",
                severity: "warn",
              });
            if (trainees / total > TRAINEE_ALERT)
              signals.push({
                key: "trainee_heavy",
                label: `Стажёров ${Math.round((trainees / total) * 100)}%`,
                detail: `${trainees} из ${total} — филиал тянет обучение, а не работает`,
                severity: "warn",
              });
            if (pinSet === 0)
              signals.push({
                key: "no_pin",
                label: "PIN не задан",
                detail:
                  "ни у кого нет PIN — войти в киоск аттестации на этом филиале нельзя",
                severity: "info",
              });
          }

          return {
            id: r.id,
            name: r.name,
            address: r.address,
            manager_name: r.manager_name,
            brand: /les/i.test(r.brand ?? "")
              ? "les"
              : /chopar/i.test(r.brand ?? "")
              ? "chopar"
              : "other",
            brand_name: r.brand,
            /**
             * false — по филиалу нет НИ ОДНОЙ строки в справочнике. Это «данные
             * не заведены», а не «людей нет»: стажировку там завести нельзя.
             */
            has_staff_data: hasStaffData,
            staff: {
              total,
              trainees,
              pin_set: pinSet,
              pin_missing: total - pinSet,
              groups,
              shifts,
              grades,
              roles: [...roleCount.entries()]
                .map(([role, n]) => ({ role, n }))
                .sort((a, b) => b.n - a.n || a.role.localeCompare(b.role, "ru")),
            },
            signals,
            people: list,
          };
        })
        .sort(
          (a, z) =>
            z.staff.total - a.staff.total || a.name.localeCompare(z.name, "ru")
        );

      const withData = branches.filter((b) => b.has_staff_data);
      const sum = (f: (b: (typeof branches)[number]) => number) =>
        branches.reduce((s, b) => s + f(b), 0);
      const countSignal = (k: SignalKey) =>
        branches.filter((b) => b.signals.some((s) => s.key === k)).length;

      const staffTotal = sum((b) => b.staff.total);
      const network = {
        branches_total: branches.length,
        branches_with_staff_data: withData.length,
        branches_without_staff_data: branches.length - withData.length,
        staff_total: staffTotal,
        trainees_total: sum((b) => b.staff.trainees),
        pin_set_total: sum((b) => b.staff.pin_set),
        pin_missing_total: staffTotal - sum((b) => b.staff.pin_set),
        shifts: {
          day: sum((b) => b.staff.shifts.day),
          night: sum((b) => b.staff.shifts.night),
          unknown: sum((b) => b.staff.shifts.unknown),
        },
        groups: {
          kitchen: sum((b) => b.staff.groups.kitchen),
          front: sum((b) => b.staff.groups.front),
          management: sum((b) => b.staff.groups.management),
          other: sum((b) => b.staff.groups.other),
        },
        by_brand: ["les", "chopar"].map((br) => ({
          brand: br,
          branches: branches.filter((b) => b.brand === br).length,
          staff: branches
            .filter((b) => b.brand === br)
            .reduce((s, b) => s + b.staff.total, 0),
        })),
        // Считается по филиалам, а не по людям: «10 филиалов без менеджера» —
        // это управленческий факт, «26 менеджеров на сеть» — нет.
        signals: {
          no_manager: countSignal("no_manager"),
          no_senior_cook: countSignal("no_senior_cook"),
          no_night: countSignal("no_night"),
          trainee_heavy: countSignal("trainee_heavy"),
          no_pin: countSignal("no_pin"),
          branches_with_warnings: branches.filter((b) =>
            b.signals.some((s) => s.severity === "warn")
          ).length,
        },
      };

      return { network, branches, scope: { is_hq: isHQ, terminal_count: scope.length } };
    },
    { permission: "employees.list" }
  );

export const staffBoardController = staffBoardControllerImpl as unknown as Elysia;
