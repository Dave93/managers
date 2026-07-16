import { ctx } from "@backend/context";
import { resolveIsHq } from "@backend/lib/resolve-is-hq";
import {
  employees,
  medical_exam_schedules,
  medical_exams,
  users,
} from "backend/drizzle/schema";
import {
  SQLWrapper,
  and,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  or,
} from "drizzle-orm";
import Elysia, { t } from "elysia";
import {
  MedicalStatus,
  STATUS_RANK,
  addMonthsClamped,
  computeStatus,
  daysUntil,
  projectFutureDates,
} from "./status";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const todayIso = () => new Date().toISOString().slice(0, 10);

// One row per scoped active employee with computed medical status.
// Employee count is small (~hundreds), so filtering/sorting happens in JS
// after three bulk queries — keeps SQL simple and the status logic in one
// tested pure function.
async function buildMedicalRows(args: {
  drizzle: any;
  isHQ: boolean;
  terminals: string[];
  search?: string;
  terminal_id?: string;
}) {
  const where: (SQLWrapper | undefined)[] = [eq(employees.active, true)];
  if (!args.isHQ) where.push(inArray(employees.terminal_id, args.terminals));
  if (args.search)
    where.push(
      or(
        ilike(employees.first_name, `%${args.search}%`),
        ilike(employees.last_name, `%${args.search}%`)
      )
    );
  if (args.terminal_id) where.push(eq(employees.terminal_id, args.terminal_id));
  const emps = await args.drizzle
    .select({
      id: employees.id,
      first_name: employees.first_name,
      last_name: employees.last_name,
      position: employees.position,
      terminal_id: employees.terminal_id,
    })
    .from(employees)
    .where(and(...where))
    .execute();
  const ids = emps.map((e: any) => e.id);
  const [schedules, openRows, doneRows] = ids.length
    ? await Promise.all([
        args.drizzle
          .select()
          .from(medical_exam_schedules)
          .where(
            and(
              inArray(medical_exam_schedules.employee_id, ids),
              eq(medical_exam_schedules.active, true)
            )
          )
          .execute(),
        args.drizzle
          .select()
          .from(medical_exams)
          .where(
            and(
              inArray(medical_exams.employee_id, ids),
              isNull(medical_exams.completed_date)
            )
          )
          .execute(),
        args.drizzle
          .select()
          .from(medical_exams)
          .where(
            and(
              inArray(medical_exams.employee_id, ids),
              isNotNull(medical_exams.completed_date)
            )
          )
          .orderBy(desc(medical_exams.completed_date))
          .execute(),
      ])
    : [[], [], []];
  const scheduleByEmp = new Map(schedules.map((s: any) => [s.employee_id, s]));
  const openByEmp = new Map(openRows.map((x: any) => [x.employee_id, x]));
  const lastByEmp = new Map<string, any>();
  for (const x of doneRows as any[])
    if (!lastByEmp.has(x.employee_id)) lastByEmp.set(x.employee_id, x);
  const today = todayIso();
  return emps.map((e: any) => {
    const sched = scheduleByEmp.get(e.id) as any;
    const open = sched ? (openByEmp.get(e.id) as any) : null;
    const last = lastByEmp.get(e.id) as any;
    const status = computeStatus({
      lastResult: last?.result ?? null,
      openDueDate: open?.planned_due_date ?? null,
      todayIso: today,
    });
    return {
      employee_id: e.id,
      first_name: e.first_name,
      last_name: e.last_name,
      position: e.position,
      terminal_id: e.terminal_id,
      interval_months: sched?.interval_months ?? null,
      last_completed_date: last?.completed_date ?? null,
      last_result: last?.result ?? null,
      open_exam_id: open?.id ?? null,
      next_due_date: open?.planned_due_date ?? null,
      days_until_due: open ? daysUntil(open.planned_due_date, today) : null,
      status,
    };
  });
}

// Loads an exam row and enforces terminal scope via its employee.
async function loadScopedExam(args: {
  drizzle: any;
  id: string;
  isHQ: boolean;
  terminals: string[];
}) {
  const rows = await args.drizzle
    .select()
    .from(medical_exams)
    .where(eq(medical_exams.id, args.id))
    .execute();
  if (!rows.length) return { error: 404 as const };
  const exam = rows[0];
  const emp = await args.drizzle
    .select({ terminal_id: employees.terminal_id })
    .from(employees)
    .where(eq(employees.id, exam.employee_id))
    .execute();
  if (
    !args.isHQ &&
    (!emp.length || !args.terminals.includes(emp[0].terminal_id))
  )
    return { error: 403 as const };
  return { exam };
}

// Registered on the app root (src/app.ts), not in controllers.ts — the
// apiController .use() chain hit TypeScript's instantiation-depth limit
// (TS2589) at the 43rd controller. Hence the explicit /api prefix here.
export const medicalController = new Elysia({ name: "@api/medical", prefix: "/api" })
  .use(ctx)
  .get(
    "/medical/exams",
    async ({ query, user, role, terminals, cacheController, drizzle }) => {
      const isHQ = await resolveIsHq({ user, role, cacheController });
      let rows = await buildMedicalRows({
        drizzle,
        isHQ,
        terminals,
        search: query.search,
        terminal_id: query.terminal_id,
      });
      if (query.status) {
        const wanted: MedicalStatus[] =
          query.status === "overdue"
            ? ["overdue", "unfit"]
            : [query.status as MedicalStatus];
        rows = rows.filter((r: any) => wanted.includes(r.status));
      }
      rows.sort(
        (a: any, b: any) =>
          STATUS_RANK[a.status as MedicalStatus] -
            STATUS_RANK[b.status as MedicalStatus] ||
          String(a.next_due_date ?? "9999-12-31").localeCompare(
            String(b.next_due_date ?? "9999-12-31")
          ) ||
          a.last_name.localeCompare(b.last_name, "ru")
      );
      const offset = +(query.offset ?? "0");
      const limit = +(query.limit ?? "50");
      return { total: rows.length, data: rows.slice(offset, offset + limit) };
    },
    {
      permission: "medical.list",
      query: t.Object({
        limit: t.Optional(t.String()),
        offset: t.Optional(t.String()),
        search: t.Optional(t.String()),
        terminal_id: t.Optional(t.String()),
        status: t.Optional(t.String()),
      }),
    }
  )
  .get(
    "/medical/summary",
    async ({ user, role, terminals, cacheController, drizzle }) => {
      const isHQ = await resolveIsHq({ user, role, cacheController });
      const rows = await buildMedicalRows({ drizzle, isHQ, terminals });
      const counts = { unfit: 0, overdue: 0, due_soon: 0, ok: 0, none: 0 };
      for (const r of rows) counts[r.status as MedicalStatus]++;
      return counts;
    },
    { permission: "medical.list" }
  )
  .get(
    "/medical/employees/:id",
    async ({ params: { id }, user, role, terminals, cacheController, set, drizzle }) => {
      const empRows = await drizzle
        .select({
          id: employees.id,
          first_name: employees.first_name,
          last_name: employees.last_name,
          position: employees.position,
          terminal_id: employees.terminal_id,
        })
        .from(employees)
        .where(eq(employees.id, id))
        .execute();
      if (!empRows.length) {
        set.status = 404;
        return { message: "Employee not found" };
      }
      const emp = empRows[0];
      const isHQ = await resolveIsHq({ user, role, cacheController });
      if (!isHQ && !terminals.includes(emp.terminal_id)) {
        set.status = 403;
        return { message: "Out of scope" };
      }
      const schedules = await drizzle
        .select()
        .from(medical_exam_schedules)
        .where(eq(medical_exam_schedules.employee_id, id))
        .execute();
      const schedule = schedules[0] ?? null;
      const history = await drizzle
        .select({
          id: medical_exams.id,
          planned_due_date: medical_exams.planned_due_date,
          completed_date: medical_exams.completed_date,
          result: medical_exams.result,
          notes: medical_exams.notes,
          recorded_by_name: users.first_name,
          recorded_by_last_name: users.last_name,
        })
        .from(medical_exams)
        .leftJoin(users, eq(users.id, medical_exams.recorded_by))
        .where(
          and(eq(medical_exams.employee_id, id), isNotNull(medical_exams.completed_date))
        )
        .orderBy(desc(medical_exams.completed_date))
        .execute();
      const openRows = await drizzle
        .select()
        .from(medical_exams)
        .where(
          and(eq(medical_exams.employee_id, id), isNull(medical_exams.completed_date))
        )
        .execute();
      const open_exam = openRows[0] ?? null;
      const projections =
        schedule?.active && open_exam
          ? projectFutureDates(open_exam.planned_due_date, schedule.interval_months)
          : [];
      return { employee: emp, schedule, open_exam, history, projections };
    },
    { permission: "medical.list", params: t.Object({ id: t.String() }) }
  )
  .post(
    "/medical/schedules",
    async ({ body, user, role, terminals, cacheController, set, drizzle }) => {
      if (!DATE_RE.test(body.start_date)) {
        set.status = 422;
        return { message: "start_date must be YYYY-MM-DD" };
      }
      const interval = body.interval_months ?? 6;
      if (interval < 1 || interval > 60) {
        set.status = 422;
        return { message: "interval_months out of range" };
      }
      const empRows = await drizzle
        .select({ id: employees.id, terminal_id: employees.terminal_id })
        .from(employees)
        .where(eq(employees.id, body.employee_id))
        .execute();
      if (!empRows.length) {
        set.status = 404;
        return { message: "Employee not found" };
      }
      const isHQ = await resolveIsHq({ user, role, cacheController });
      if (!isHQ && !terminals.includes(empRows[0].terminal_id)) {
        set.status = 403;
        return { message: "Out of scope" };
      }
      return await drizzle.transaction(async (tx: any) => {
        const existing = await tx
          .select()
          .from(medical_exam_schedules)
          .where(eq(medical_exam_schedules.employee_id, body.employee_id))
          .execute();
        if (!existing.length) {
          const inserted = await tx
            .insert(medical_exam_schedules)
            .values({
              employee_id: body.employee_id,
              start_date: body.start_date,
              interval_months: interval,
            })
            .returning()
            .execute();
          await tx
            .insert(medical_exams)
            .values({
              schedule_id: inserted[0].id,
              employee_id: body.employee_id,
              planned_due_date: body.start_date,
            })
            .execute();
          return { data: inserted[0] };
        }
        const schedule = existing[0];
        const updated = await tx
          .update(medical_exam_schedules)
          .set({
            start_date: body.start_date,
            interval_months: interval,
            active: true,
            updated_at: new Date().toISOString(),
          })
          .where(eq(medical_exam_schedules.id, schedule.id))
          .returning()
          .execute();
        const done = await tx
          .select({ completed_date: medical_exams.completed_date })
          .from(medical_exams)
          .where(
            and(
              eq(medical_exams.schedule_id, schedule.id),
              isNotNull(medical_exams.completed_date)
            )
          )
          .orderBy(desc(medical_exams.completed_date))
          .execute();
        const open = await tx
          .select()
          .from(medical_exams)
          .where(
            and(
              eq(medical_exams.schedule_id, schedule.id),
              isNull(medical_exams.completed_date)
            )
          )
          .execute();
        if (open.length && !done.length) {
          // No completions yet — the open row simply follows the new start date.
          await tx
            .update(medical_exams)
            .set({
              planned_due_date: body.start_date,
              updated_at: new Date().toISOString(),
            })
            .where(eq(medical_exams.id, open[0].id))
            .execute();
        } else if (!open.length) {
          // Schedule was reactivated: open the next cycle from the last completion.
          const from = done.length ? done[0].completed_date : body.start_date;
          await tx
            .insert(medical_exams)
            .values({
              schedule_id: schedule.id,
              employee_id: body.employee_id,
              planned_due_date: done.length
                ? addMonthsClamped(from, interval)
                : body.start_date,
            })
            .execute();
        }
        return { data: updated[0] };
      });
    },
    {
      permission: "medical.edit",
      body: t.Object({
        employee_id: t.String(),
        start_date: t.String(),
        interval_months: t.Optional(t.Number()),
      }),
    }
  )
  .post(
    "/medical/exams/:id/complete",
    async ({ params: { id }, body, user, role, terminals, cacheController, set, drizzle }) => {
      if (!DATE_RE.test(body.completed_date)) {
        set.status = 422;
        return { message: "completed_date must be YYYY-MM-DD" };
      }
      if (body.completed_date > todayIso()) {
        set.status = 422;
        return { message: "completed_date cannot be in the future" };
      }
      const isHQ = await resolveIsHq({ user, role, cacheController });
      const loaded = await loadScopedExam({ drizzle, id, isHQ, terminals });
      if (loaded.error === 404) {
        set.status = 404;
        return { message: "Exam not found" };
      }
      if (loaded.error === 403) {
        set.status = 403;
        return { message: "Out of scope" };
      }
      const exam = loaded.exam!;
      if (exam.completed_date) {
        set.status = 409;
        return { message: "Exam already completed" };
      }
      const scheduleRows = await drizzle
        .select()
        .from(medical_exam_schedules)
        .where(eq(medical_exam_schedules.id, exam.schedule_id))
        .execute();
      const schedule = scheduleRows[0];
      return await drizzle.transaction(async (tx: any) => {
        const updated = await tx
          .update(medical_exams)
          .set({
            completed_date: body.completed_date,
            result: body.result,
            notes: body.notes ?? null,
            recorded_by: user!.id,
            updated_at: new Date().toISOString(),
          })
          .where(eq(medical_exams.id, id))
          .returning()
          .execute();
        const next = await tx
          .insert(medical_exams)
          .values({
            schedule_id: exam.schedule_id,
            employee_id: exam.employee_id,
            planned_due_date: addMonthsClamped(
              body.completed_date,
              schedule.interval_months
            ),
          })
          .returning()
          .execute();
        return { data: updated[0], next: next[0] };
      });
    },
    {
      permission: "medical.edit",
      params: t.Object({ id: t.String() }),
      body: t.Object({
        completed_date: t.String(),
        result: t.Union([
          t.Literal("fit"),
          t.Literal("fit_restricted"),
          t.Literal("unfit"),
        ]),
        notes: t.Optional(t.Nullable(t.String())),
      }),
    }
  )
  .put(
    "/medical/exams/:id",
    async ({ params: { id }, body, user, role, terminals, cacheController, set, drizzle }) => {
      if (!DATE_RE.test(body.planned_due_date)) {
        set.status = 422;
        return { message: "planned_due_date must be YYYY-MM-DD" };
      }
      const isHQ = await resolveIsHq({ user, role, cacheController });
      const loaded = await loadScopedExam({ drizzle, id, isHQ, terminals });
      if (loaded.error === 404) {
        set.status = 404;
        return { message: "Exam not found" };
      }
      if (loaded.error === 403) {
        set.status = 403;
        return { message: "Out of scope" };
      }
      if (loaded.exam!.completed_date) {
        set.status = 409;
        return { message: "Cannot reschedule a completed exam" };
      }
      const updated = await drizzle
        .update(medical_exams)
        .set({
          planned_due_date: body.planned_due_date,
          updated_at: new Date().toISOString(),
        })
        .where(eq(medical_exams.id, id))
        .returning()
        .execute();
      return { data: updated[0] };
    },
    {
      permission: "medical.edit",
      params: t.Object({ id: t.String() }),
      body: t.Object({ planned_due_date: t.String() }),
    }
  );
