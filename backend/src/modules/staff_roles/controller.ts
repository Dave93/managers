import { ctx } from "@backend/context";
import { staff_roles, employees } from "backend/drizzle/schema";
import { and, asc, eq, ilike, or, sql, type SQLWrapper } from "drizzle-orm";
import Elysia, { t } from "elysia";

// CRUD справочника ролей.
//
// Права намеренно не новые: читает всякий, кто уже видит справочник сотрудников
// (employees.list), пишет тот, кто уже правит сотрудника (employees.edit).
// Отдельное право здесь означало бы, что после выката ни у кого его нет и
// справочник заводить некому.
//
// Удаления как такового нет. На staff_roles.id висит внешний ключ из employees,
// поэтому DELETE у занятой роли всё равно упрётся в базу, а у свободной — тихо
// сотрёт запись, на которую ссылались строки должностей до канонизации.
// Вместо этого DELETE снимает active: роль пропадает из выпадающих списков и
// остаётся у тех, кто уже на ней числится.
const staffRolesControllerImpl = new Elysia({
  name: "@api/staff-roles",
})
  .use(ctx)
  .get(
    "/staff-roles",
    async ({ query, drizzle }) => {
      const where: (SQLWrapper | undefined)[] = [];
      if (query.active === "true" || query.active === "false")
        where.push(eq(staff_roles.active, query.active === "true"));
      if (query.group) where.push(eq(staff_roles.group_key, query.group));
      if (query.search)
        where.push(
          or(
            ilike(staff_roles.name_ru, `%${query.search}%`),
            ilike(staff_roles.name_uz, `%${query.search}%`),
            ilike(staff_roles.code, `%${query.search}%`)
          )
        );

      const rows = await drizzle
        .select()
        .from(staff_roles)
        .where(where.length ? and(...where) : undefined)
        .orderBy(asc(staff_roles.sort), asc(staff_roles.name_ru))
        .execute();

      // Сколько людей на роли — не украшение списка, а единственное, что
      // отличает роль, которую можно спокойно отключить, от роли, под которой
      // стоит половина кухни.
      const counts = await drizzle
        .select({
          staff_role_id: employees.staff_role_id,
          n: sql<number>`count(*)::int`,
        })
        .from(employees)
        .where(eq(employees.active, true))
        .groupBy(employees.staff_role_id)
        .execute();
      const byRole = new Map(counts.map((c) => [c.staff_role_id, c.n]));

      return {
        total: rows.length,
        data: rows.map((r) => ({ ...r, employees_count: byRole.get(r.id) ?? 0 })),
      };
    },
    {
      permission: "employees.list",
      query: t.Object({
        active: t.Optional(t.String()),
        group: t.Optional(t.String()),
        search: t.Optional(t.String()),
      }),
    }
  )
  .get(
    "/staff-roles/:id",
    async ({ params: { id }, set, drizzle }) => {
      const rows = await drizzle
        .select()
        .from(staff_roles)
        .where(eq(staff_roles.id, id))
        .execute();
      if (!rows.length) {
        set.status = 404;
        return { message: "Staff role not found" };
      }
      return rows[0];
    },
    { permission: "employees.list", params: t.Object({ id: t.String() }) }
  )
  .post(
    "/staff-roles",
    async ({ body: { data }, set, drizzle }) => {
      const bad = validate(data);
      if (bad) {
        set.status = 422;
        return { message: bad };
      }
      const clash = await drizzle
        .select({ id: staff_roles.id })
        .from(staff_roles)
        .where(eq(staff_roles.code, data.code))
        .execute();
      if (clash.length) {
        set.status = 409;
        return { message: `Role code "${data.code}" already exists` };
      }
      const inserted = await drizzle
        .insert(staff_roles)
        .values({
          code: data.code,
          name_ru: data.name_ru,
          name_uz: data.name_uz,
          group_key: data.group_key,
          is_trainee: data.is_trainee ?? false,
          trainee_of_code: data.trainee_of_code ?? null,
          sort: data.sort ?? 0,
          active: data.active ?? true,
        })
        .returning()
        .execute();
      return { data: inserted[0] };
    },
    {
      permission: "employees.edit",
      body: t.Object({
        data: t.Object({
          code: t.String(),
          name_ru: t.String(),
          name_uz: t.String(),
          group_key: t.String(),
          is_trainee: t.Optional(t.Boolean()),
          trainee_of_code: t.Optional(t.Nullable(t.String())),
          sort: t.Optional(t.Number()),
          active: t.Optional(t.Boolean()),
        }),
      }),
    }
  )
  .put(
    "/staff-roles/:id",
    async ({ params: { id }, body: { data }, set, drizzle }) => {
      const current = await drizzle
        .select()
        .from(staff_roles)
        .where(eq(staff_roles.id, id))
        .execute();
      if (!current.length) {
        set.status = 404;
        return { message: "Staff role not found" };
      }
      const bad = validate({ ...current[0], ...data });
      if (bad) {
        set.status = 422;
        return { message: bad };
      }
      // code — ключ, по которому справочник засевается и по которому стажёрская
      // роль ссылается на свою «взрослую». Переименование кода развязало бы обе
      // связи молча, поэтому его здесь просто нет.
      const { code: _ignored, ...patch } = data as Record<string, unknown>;
      const updated = await drizzle
        .update(staff_roles)
        .set({ ...patch, updated_at: new Date().toISOString() })
        .where(eq(staff_roles.id, id))
        .returning()
        .execute();
      return { data: updated[0] };
    },
    {
      permission: "employees.edit",
      params: t.Object({ id: t.String() }),
      body: t.Object({
        data: t.Object({
          name_ru: t.Optional(t.String()),
          name_uz: t.Optional(t.String()),
          group_key: t.Optional(t.String()),
          is_trainee: t.Optional(t.Boolean()),
          trainee_of_code: t.Optional(t.Nullable(t.String())),
          sort: t.Optional(t.Number()),
          active: t.Optional(t.Boolean()),
        }),
      }),
    }
  )
  .delete(
    "/staff-roles/:id",
    async ({ params: { id }, set, drizzle }) => {
      const current = await drizzle
        .select()
        .from(staff_roles)
        .where(eq(staff_roles.id, id))
        .execute();
      if (!current.length) {
        set.status = 404;
        return { message: "Staff role not found" };
      }
      const used = await drizzle
        .select({ n: sql<number>`count(*)::int` })
        .from(employees)
        .where(eq(employees.staff_role_id, id))
        .execute();
      const deactivated = await drizzle
        .update(staff_roles)
        .set({ active: false, updated_at: new Date().toISOString() })
        .where(eq(staff_roles.id, id))
        .returning()
        .execute();
      return { data: deactivated[0], employees_kept: used[0].n, deactivated: true };
    },
    { permission: "employees.edit", params: t.Object({ id: t.String() }) }
  );

const GROUPS = ["kitchen", "front", "management", "other"];

function validate(d: {
  code?: string;
  name_ru?: string;
  name_uz?: string;
  group_key?: string;
  is_trainee?: boolean | null;
  trainee_of_code?: string | null;
}): string | null {
  if (d.code !== undefined && !/^[a-z0-9_]{2,50}$/.test(d.code))
    return "code must match /^[a-z0-9_]{2,50}$/";
  if (d.name_ru !== undefined && !d.name_ru.trim()) return "name_ru is required";
  if (d.name_uz !== undefined && !d.name_uz.trim()) return "name_uz is required";
  if (d.group_key !== undefined && !GROUPS.includes(d.group_key))
    return `group_key must be one of ${GROUPS.join(", ")}`;
  // Стажёрская роль без указания, кем человек станет, — это тупик: перевести
  // его в штат будет некуда, и справочник об этом промолчит.
  if (d.is_trainee === true && !d.trainee_of_code)
    return "trainee_of_code is required when is_trainee is true";
  return null;
}

export const staffRolesController = staffRolesControllerImpl as unknown as Elysia;
