// Ежедневная задача воркера: читает базу и ставит строки уведомлений. Отправляет их deliverOne.
import { permissions, roles, roles_permissions, users } from "backend/drizzle/schema";
import { and, eq, inArray } from "drizzle-orm";
import type { DbLike } from "../access";
import { collectDeliveries, enqueue, scheduleDelivery, type NotifyInput } from "../notify";
import { isPeriodClosed, laggingEvaluators } from "../periods";
import { loadSettings } from "../settings";
import { dailyTargets, overdueNotifications, remindNotifications } from "./daily-plan";

// Активные пользователи с активной ролью и активным правом kpi.approve (HR).
export async function approverUserIds(db: DbLike): Promise<string[]> {
  const rows = await db
    .selectDistinct({ id: users.id })
    .from(users)
    .innerJoin(roles, and(eq(roles.id, users.role_id), eq(roles.active, true)))
    .innerJoin(roles_permissions, eq(roles_permissions.role_id, roles.id))
    .innerJoin(permissions, and(eq(permissions.id, roles_permissions.permission_id), eq(permissions.slug, "kpi.approve"), eq(permissions.active, true)))
    .where(eq(users.status, "active"));
  return rows.map((r) => r.id);
}

export async function activeUserIds(db: DbLike, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(inArray(users.id, ids), eq(users.status, "active")));
  return new Set(rows.map((r) => r.id));
}

// Возвращает id новых строк; повторный запуск в тот же день ничего не добавляет (dedupe_key).
// Задачи доставки ставятся через collectDeliveries, то есть после того, как все строки записаны.
export async function runDaily(
  db: DbLike,
  at: Date,
  schedule: (ids: string[]) => void = scheduleDelivery
): Promise<string[]> {
  const settings = await loadSettings(db);
  const t = dailyTargets(at, settings);
  const ids: string[] = [];
  await collectDeliveries(async () => {
    const rows: NotifyInput[] = [];
    // Закрытый месяц не напоминает и не требует сводки: оценки в нём уже не меняются.
    if (t.remind && !(await isPeriodClosed(db, t.remind.period))) {
      const lagging = await laggingEvaluators(db, t.remind.period);
      const active = await activeUserIds(db, lagging.map((l) => l.user_id));
      rows.push(...remindNotifications(t.remind, t.today, lagging.filter((l) => active.has(l.user_id))));
    }
    if (t.overdue && !(await isPeriodClosed(db, t.overdue.period))) {
      // Сводку HR читает целиком, включая заблокированных оценщиков.
      const lagging = await laggingEvaluators(db, t.overdue.period);
      if (lagging.length > 0) rows.push(...overdueNotifications(t.overdue.period, lagging, await approverUserIds(db)));
    }
    for (const r of rows) {
      const id = await enqueue(db, r);
      if (id) ids.push(id);
    }
  }, schedule);
  return ids;
}
