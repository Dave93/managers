// Запрос замены в группу HR: при выдаче выходного проверяем, остаётся ли на позиции кто-то ещё, и если нет
// (или управляющий отметил «запросить сотрудника»), ставим сообщение в kpi_notifications. Доставку делает воркер.
// Позиция = эффективная карта KPI; у сотрудника без карты — роль. Замена — другой активный не стажёр того же филиала
// с той же позицией, у которого на этот день нет выходного. График Workly не учитывается.
import { kpi_cards, kpi_days_off, organization, staff_roles, terminals } from "backend/drizzle/schema";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Actor, DbLike } from "./access";
import { loadDirectory, userNames, type DirEmployee } from "./directory";
import { enqueue } from "./notify";

// Группы HR по коду организации (organization.code). Меняются только вместе с кодом.
export const HR_CHATS: Readonly<Record<string, number>> = {
  les: -1001449886367,
  chopar: -1001651101431,
};

const positionKey = (e: Pick<DirEmployee, "card_id" | "staff_role_code">): string | null =>
  e.card_id !== null ? `card:${e.card_id}` : e.staff_role_code !== null ? `role:${e.staff_role_code}` : null;

/** Дни из days, когда на позиции сотрудника emp никого не остаётся. Без позиции (нет ни карты, ни роли) — пусто. */
export async function uncoveredDays(tx: DbLike, emp: DirEmployee, days: string[]): Promise<string[]> {
  const key = positionKey(emp);
  if (key === null || days.length === 0) return [];
  const peers = (await loadDirectory(tx, { terminalId: emp.terminal_id }))
    .filter((e) => e.id !== emp.id && e.is_trainee !== true && positionKey(e) === key)
    .map((e) => e.id);
  if (peers.length === 0) return days;
  const off = await tx
    .select({ employee_id: kpi_days_off.employee_id, day: kpi_days_off.day })
    .from(kpi_days_off)
    .where(and(inArray(kpi_days_off.employee_id, peers), inArray(kpi_days_off.day, days), isNull(kpi_days_off.cancelled_at)));
  const offByDay = new Map<string, Set<string>>();
  for (const r of off) offByDay.set(r.day, (offByDay.get(r.day) ?? new Set()).add(r.employee_id));
  return days.filter((d) => (offByDay.get(d)?.size ?? 0) >= peers.length);
}

/**
 * Ставит в очередь сообщение HR, если надо. createdDays — только что выданные дни (повторно пропущенные не шлём).
 * Прошедшие дни (раньше today) не учитываются: задним числом замену не ищут. manual — галочка управляющего:
 * тогда уходят все будущие дни, а не только те, где замены нет. Вызывать внутри транзакции выдачи.
 */
export async function requestReplacement(
  tx: DbLike,
  actor: Actor,
  emp: DirEmployee,
  created: { id: string; day: string }[],
  o: { today: string; manual: boolean }
): Promise<void> {
  const days = created.map((c) => c.day).filter((d) => d >= o.today);
  if (days.length === 0) return;
  const uncovered = await uncoveredDays(tx, emp, days);
  const send = o.manual ? days : uncovered;
  if (send.length === 0) return;

  const [org] = await tx
    .select({ code: organization.code })
    .from(terminals)
    .innerJoin(organization, eq(organization.id, terminals.organization_id))
    .where(eq(terminals.id, emp.terminal_id));
  const chatId = org?.code ? HR_CHATS[org.code] : undefined;
  if (chatId === undefined) {
    // Организация без группы HR: выдача выходного не должна из-за этого падать.
    console.error(`kpi replacement: нет группы HR для организации «${org?.code ?? "?"}», филиал ${emp.terminal_id}`);
    return;
  }

  const [role] = emp.staff_role_code
    ? await tx.select({ name_uz: staff_roles.name_uz }).from(staff_roles).where(eq(staff_roles.code, emp.staff_role_code))
    : [];
  const [card] = emp.card_id ? await tx.select({ title_uz: kpi_cards.title_uz }).from(kpi_cards).where(eq(kpi_cards.id, emp.card_id)) : [];
  const managerName = (await userNames(tx, [actor.userId])).get(actor.userId) ?? null;

  await enqueue(tx, {
    recipient_kind: "chat",
    kind: "replacement_needed",
    dedupe_key: `replacement:${created[0].id}`,
    payload: {
      chat_id: chatId,
      terminal_name: emp.terminal_name,
      position: role?.name_uz ?? null,
      card: card?.title_uz ?? null,
      employee_name: `${emp.last_name} ${emp.first_name}`.trim(),
      manager_name: managerName,
      days: send,
      // «Нет замены» пишем, только если это верно для каждого дня в сообщении.
      no_cover: uncovered.length === send.length,
      manual: o.manual,
    },
  });
}
