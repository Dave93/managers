// Чистая логика списка филиала на планшете: что считается непрочитанным, как
// заявки раскладываются по группам и какие фильтры уходят в GET /tickets.
// Вынесено из экрана, потому что ошибка здесь тихая: точка не загорится или не
// погаснет, а заявка, ждущая приёмки, окажется не в той группе.

import { parseTs } from "@admin/components/tickets/status";
import type { TicketCard, TicketListQuery, TicketPriority, TicketStatus } from "@admin/lib/tickets-api";

// ---------------------------------------------------------------------------
// точка непрочитанного
// ---------------------------------------------------------------------------

// Точка горит, когда в заявке есть событие новее manager_seen_at, либо когда
// отметки нет вовсе (филиал заявку ещё не открывал). Telegram менеджеру о
// комментариях исполнителя не шлётся намеренно, так что точка единственный
// способ их заметить.
//
// Что не удалось разобрать, считается непрочитанным: лишняя точка стоит одного
// нажатия, а пропущенный комментарий стоит заявки, которая простояла неделю.
// Время событий приходит с микросекундами, а parseTs режет доли до миллисекунд
// (как и manager_seen_at, который пишется из JS): событие и отметка внутри одной
// миллисекунды считаются прочитанными.
export function hasUnread(row: {
  manager_seen_at: string | null | undefined;
  last_event_at: string | null | undefined;
}): boolean {
  if (!row.manager_seen_at) return true;
  const seen = parseTs(row.manager_seen_at);
  if (!Number.isFinite(seen)) return true;
  if (!row.last_event_at) return false;
  const last = parseTs(row.last_event_at);
  if (!Number.isFinite(last)) return true;
  return last > seen;
}

// Время новейшего события карточки. В карточке нет готового last_event_at, но
// есть вся лента: берём максимум по моменту, а не последнюю по порядку, чтобы
// не зависеть от сортировки ответа.
export function lastEventOf(card: Pick<TicketCard, "events">): string | null {
  let best: string | null = null;
  let bestMs = -Infinity;
  for (const e of card.events ?? []) {
    const ms = parseTs(e.created_at);
    if (!Number.isFinite(ms)) continue;
    if (ms > bestMs) {
      bestMs = ms;
      best = e.created_at;
    }
  }
  return best;
}

// Точка на карточке списка. У закрытой и отменённой заявки её нет: офис пишет
// событие оплаты по каждой принятой заявке, оно новее отметки, и без этого
// почти каждая заявка во вкладке «Закрытые» горела бы вечно, а точка, которая
// никогда не гаснет, перестаёт значить что-либо. Закрытую заявку читать уже
// не нужно.
export function showUnreadDot(row: {
  status: TicketStatus;
  manager_seen_at: string | null | undefined;
  last_event_at: string | null | undefined;
}): boolean {
  if (row.status === "closed" || row.status === "cancelled") return false;
  return hasUnread(row);
}

export function cardHasUnread(card: Pick<TicketCard, "events" | "manager_seen_at">): boolean {
  return hasUnread({ manager_seen_at: card.manager_seen_at, last_event_at: lastEventOf(card) });
}

// ---------------------------------------------------------------------------
// группы
// ---------------------------------------------------------------------------

export type Groupable = { status: TicketStatus; priority: TicketPriority };

export type Groups<T> = {
  // Работа сдана, ждёт решения филиала: единственная группа с действием.
  awaiting: T[];
  inProgress: T[];
  fresh: T[];
};

const urgentFirst = <T extends Groupable>(rows: T[]): T[] =>
  // Array.prototype.sort стабилен: внутри срочных и обычных остаётся порядок
  // ответа сервера (новые сверху).
  [...rows].sort((a, b) => Number(b.priority === "urgent") - Number(a.priority === "urgent"));

// Порядок групп задан тем, что требует действия: сначала то, что ждёт приёмки.
// Закрытые и отменённые сюда не попадают: они живут во вкладке и в другом
// запросе. Если сервер всё же вернул такую строку, она молча не показывается.
export function groupTickets<T extends Groupable>(rows: readonly T[]): Groups<T> {
  return {
    awaiting: urgentFirst(rows.filter((r) => r.status === "done")),
    inProgress: urgentFirst(rows.filter((r) => r.status === "in_progress")),
    fresh: urgentFirst(rows.filter((r) => r.status === "new")),
  };
}

export function countGroups(g: Groups<unknown>): number {
  return g.awaiting.length + g.inProgress.length + g.fresh.length;
}

// ---------------------------------------------------------------------------
// панель приёмки
// ---------------------------------------------------------------------------

// Что показывает правая колонка «Стало». Пункт 3 из Review Focus: заявка, по
// которой исполнитель ещё не сдал работу, не имеет фото результата, и принимать
// нечего. Фото результата появляются только вместе со сдачей (done), так что
// отсутствие фото у new и in_progress значит «ещё не сдал».
export type ResultColumn =
  | "photos" // есть фото результата
  | "not_submitted" // new, in_progress: исполнитель ещё не сдал работу
  | "submitted_without_photos" // done, но фото нет: аномалия, принять по ним нельзя
  | "none"; // closed, cancelled: фото не приложены

export function resultColumn(status: TicketStatus, resultPhotos: number): ResultColumn {
  // Статус раньше числа фото: возврат в работу вложений не удаляет (удаляющего
  // роута нет), и у заявки в работе фото прошлой, отвергнутой сдачи не должны
  // выдаваться за результат.
  if (status === "new" || status === "in_progress") return "not_submitted";
  if (resultPhotos > 0) return "photos";
  if (status === "done") return "submitted_without_photos";
  return "none";
}

// Фото результата ТЕКУЩЕЙ сдачи: созданные позже последнего возврата в работу.
// Возврат оставляет вложения на месте, так что без этого отвергнутые снимки
// остались бы результатом, а после повторной сдачи без новых фото «Принять
// работу» встала бы против них же. Время вложения и события одни и те же часы
// (оба defaultNow() в Postgres). Если возврата не было, результатные все; если
// был, а время вложения не разобралось, оно не считается текущим: принимать
// работу по снимку неизвестной давности нельзя.
export function currentResultPhotos<A extends { phase: string; created_at: string }>(card: {
  attachments?: readonly A[] | null;
  events?: readonly { type: string; created_at: string }[] | null;
}): A[] {
  const results = (card.attachments ?? []).filter((a) => a.phase === "result");
  let lastReopen = -Infinity;
  for (const e of card.events ?? []) {
    if (e.type !== "reopened") continue;
    const ms = parseTs(e.created_at);
    if (Number.isFinite(ms) && ms > lastReopen) lastReopen = ms;
  }
  if (lastReopen === -Infinity) return results;
  return results.filter((a) => parseTs(a.created_at) > lastReopen);
}

// «Принять работу» есть только там, где есть что принимать: статус «сдана» (из
// него и принимает сервер) и хотя бы одно фото результата. Вернуть в работу
// можно любую сданную заявку, в том числе без фото: именно так просят их
// приложить.
export function canAccept(status: TicketStatus, resultPhotos: number): boolean {
  return status === "done" && resultPhotos > 0;
}

export function canReturn(status: TicketStatus): boolean {
  return status === "done";
}

// ---------------------------------------------------------------------------
// фильтры списка
// ---------------------------------------------------------------------------

export const ACTIVE_STATUSES: TicketStatus[] = ["new", "in_progress", "done"];
export const FINISHED_STATUSES: TicketStatus[] = ["closed", "cancelled"];

type Filters = NonNullable<TicketListQuery["filters"]>;

// Активные заявки идут отдельным запросом, а не вместе с закрытыми: список
// отдаёт не больше 200 строк «новые сверху», и заявка, зависшая в работе с
// прошлого месяца, вытеснялась бы закрытыми из окна. Фильтра по терминалам
// сессии сервер сам не накладывает у роли с tickets.list_all, а планшет
// отвечает за свои филиалы, поэтому филиалы передаются явно. Пустой список
// сюда не передают: inArray([]) на сервере падает, экран в этом случае вообще
// не запрашивает список (сессия без филиала получает отказ с объяснением).
export function branchFilters(statuses: TicketStatus[], branchIds: readonly string[]): Filters {
  return [
    { field: "status", operator: "in", value: statuses },
    { field: "terminal_id", operator: "in", value: [...branchIds].sort() },
  ];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ?created=<id> приходит из адресной строки: в запрос уходит только то, что
// выглядит как UUID.
export function createdIdFrom(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  return UUID_RE.test(v) ? v : null;
}
