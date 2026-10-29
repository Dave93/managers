"use client";

// Единственное место, где админка знает URL-ы и формы ответов заявок.
// Экраны импортируют отсюда типы и функции, а не собирают запросы руками —
// иначе смена формы ответа правится в пяти файлах из шести.
//
// Eden здесь не типизирует ничего: ticketsController подключён к корню
// приложения (backend/src/app.ts) и экспортируется с расширенным типом
// `as unknown as Elysia`, чтобы не упереться в TS2589 внутри цепочки
// apiController. Поэтому `apiClient.api.tickets` в типах не существует, хотя
// маршруты живые. Тот же приём, что в lib/passport-api.ts: один `as any`
// здесь, а формы запросов и ответов описаны вручную ниже и сверены с
// backend/src/modules/tickets/controller.ts.

import { apiClient } from "@admin/utils/eden";
import { ruT, type TicketsLibT } from "@admin/lib/tickets-i18n";

const api = apiClient.api as any;
const ticketsApi = api.tickets;
const typesApi = api.ticket_types;
const contractorsApi = api.ticket_contractors;
const executorsApi = api.ticket_executors;

export type TicketStatus = "new" | "in_progress" | "done" | "closed" | "cancelled";
export type TicketPriority = "normal" | "urgent";
export type PaymentStatus = "pending" | "approved" | "rejected";
export type ActorKind = "manager" | "executor" | "office" | "system";
export type TicketEventType =
  | "created"
  | "assigned"
  | "comment"
  | "done_submitted"
  | "reopened"
  | "closed"
  | "cancelled"
  | "payment_approved"
  | "payment_rejected";

export type FieldOption = { value: string; label_ru: string; label_uz: string };
export type FieldDef = {
  key: string;
  type: "select" | "text";
  required: boolean;
  label_ru: string;
  label_uz: string;
  options?: FieldOption[];
};

// Строка списка GET /tickets: колонки tickets плюс имена из join-ов. Номер
// собирает бэкенд (`ticketNumber`), type_prefix приезжает вместе с ним, потому
// что обработчик раскладывает select целиком.
export type TicketRow = {
  id: string;
  seq: number;
  number: string;
  status: TicketStatus;
  priority: TicketPriority;
  details: Record<string, string>;
  created_at: string;
  assigned_at: string | null;
  done_at: string | null;
  closed_at: string | null;
  manager_seen_at: string | null;
  // Время новейшего события заявки (максимум ticket_events.created_at), null,
  // если событий нет. Основа точки непрочитанного на планшете: комментарий
  // исполнителя не меняет ни одну колонку tickets, а только добавляет событие.
  last_event_at: string | null;
  // Первое фото проблемы для превью карточки; null, если фото проблемы нет.
  preview_attachment_id: string | null;
  work_total_amount: string | null;
  payment_status: PaymentStatus;
  type_name: string | null;
  type_prefix: string | null;
  terminal_name: string | null;
  executor_name: string | null;
  // Фирма исполнителя, который делал работу; если исполнителя не назначали,
  // фирма типа. null: фирмы нет вовсе или работу сделал сотрудник (staff).
  contractor_name: string | null;
};

export type AttachmentRow = {
  id: string;
  ticket_id: string;
  phase: "problem" | "result";
  mime: string;
  size_bytes: number;
  uploaded_by_kind: ActorKind;
  created_at: string;
};

export type CommentRow = {
  id: string;
  ticket_id: string;
  author_kind: ActorKind;
  body: string;
  created_at: string;
};

export type WorkItemRow = {
  id: string;
  position: number;
  title: string;
  qty: string;
  unit: string | null;
  amount: string;
};

export type TicketEventRow = {
  id: string;
  type: TicketEventType;
  actor_kind: ActorKind;
  payload: Record<string, unknown>;
  created_at: string;
};

export type TicketTypeRow = {
  id: string;
  code: string;
  number_prefix: string;
  name_ru: string;
  name_uz: string;
  icon: string | null;
  executor_kind: "external" | "staff";
  contractor_id: string | null;
  fields_schema: FieldDef[];
  requires_cost: boolean;
  active: boolean;
  sort: number;
};

// Целая строка tickets: её отдают close/reopen/cancel и она же лежит в основе
// карточки.
export type TicketRecord = {
  id: string;
  seq: number;
  type_id: string;
  terminal_id: string;
  organization_id: string;
  status: TicketStatus;
  priority: TicketPriority;
  details: Record<string, string>;
  description: string | null;
  created_by: string;
  assigned_executor_id: string | null;
  assigned_at: string | null;
  done_at: string | null;
  closed_at: string | null;
  cancelled_at: string | null;
  closed_by: string | null;
  cancelled_by: string | null;
  reopen_count: number;
  work_total_amount: string | null;
  payment_status: PaymentStatus;
  payment_approved_by: string | null;
  payment_approved_at: string | null;
  payment_comment: string | null;
  manager_seen_at: string | null;
  created_at: string;
  updated_at: string;
};

// Тип приходит целиком во вложенном поле `type`, его имя — type.name_ru.
// Имена филиала, исполнителя и автора сервер добавляет сам: null, если связи
// нет (заявка ещё не назначена) или строка справочника удалена.
export type TicketCard = TicketRecord & {
  number: string;
  terminal_name: string | null;
  executor_name: string | null;
  author_name: string | null;
  type?: TicketTypeRow;
  attachments: AttachmentRow[];
  comments: CommentRow[];
  work_items: WorkItemRow[];
  events: TicketEventRow[];
};

export type ContractorRow = {
  id: string;
  name: string;
  phone: string | null;
  note: string | null;
  is_active: boolean;
};

export type ExecutorRow = {
  id: string;
  kind: "external" | "staff";
  contractor_id: string | null;
  user_id: string | null;
  full_name: string;
  phone: string | null;
  lang: string;
  tg_user_id: number | null;
  invite_used_at: string | null;
  is_active: boolean;
};

export interface ApiError extends Error {
  status?: number;
  value?: unknown;
  // Ключ ticketsLib.api.*, если текст ошибки наш запасной (а не ответ
  // сервера): apiMessage(error, t) переводит его при показе.
  messageKey?: ApiMessageKey;
}

export type ApiMessageKey = "empty" | "validation" | "failed";

// Eden возвращает провал как {data: null, error}, а TanStack Query ждёт
// исключение. Статус и тело переносим, потому что экраны различают 403 и 409.
// Пустой data без error тоже считаем провалом: все маршруты отдают JSON-тело,
// а `null` дошёл бы до экрана как «успех с undefined».
export function unwrap<T>(res: { data: T | null; error: any }): T {
  if (res.error) {
    const e = new Error(apiMessage(res.error)) as ApiError;
    e.status = res.error.status;
    e.value = res.error.value;
    e.messageKey = apiMessageKey(res.error) ?? undefined;
    throw e;
  }
  if (res.data === null || res.data === undefined) {
    const e = new Error(ruT("api.empty")) as ApiError;
    e.messageKey = "empty";
    throw e;
  }
  return res.data;
}

// Какой из наших запасных текстов получит человек вместо ответа сервера
// (null: текст пришёл с сервера и показывается как есть).
export function apiMessageKey(error: any): ApiMessageKey | null {
  if (typeof error?.messageKey === "string") return error.messageKey as ApiMessageKey;
  const v = error?.value ?? error;
  if (v?.type === "validation") return "validation";
  if (typeof v?.message === "string") return null;
  if (Array.isArray(v?.errors) && typeof v.errors[0] === "string") return null;
  if (typeof error?.message === "string") return null;
  return "failed";
}

export function apiMessage(error: any, t: TicketsLibT = ruT): string {
  const v = error?.value ?? error;
  // Ошибку валидации Elysia (422 до обработчика) отдаёт как JSON-строку в
  // message; человеку её показывать нельзя.
  const key = apiMessageKey(error);
  if (key) return t(`api.${key}`);
  if (typeof v?.message === "string") return v.message;
  if (Array.isArray(v?.errors) && typeof v.errors[0] === "string") return v.errors[0];
  return error.message;
}

// В браузере админка ходит на свой же origin, а Next.js rewrites проксируют
// /api/* на бэкенд (см. next.config.js и utils/eden.ts). Поэтому путь
// относительный: он одинаково работает в деве, на проде и за туннелем.
// Вложения отдаёт авторизованный роут потоком с диска; прямых ссылок на
// файлы нет намеренно, иначе по ссылке было бы видно чужие филиалы.
export function attachmentUrl(attachmentId: string): string {
  return `/api/tickets/attachments/${attachmentId}/file`;
}

export type TicketFilterOperator =
  | "eq"
  | "in"
  | "notIn"
  | "contains"
  | "ilike"
  | "gt"
  | "gte"
  | "lt"
  | "lte";

// Фильтровать можно по колонкам самой tickets (status, priority, terminal_id,
// type_id, payment_status, created_at и т. д.), порядок выдачи задан на
// бэкенде: created_at по убыванию.
export type TicketListQuery = {
  limit: number;
  offset: number;
  filters?: Array<{ field: string; operator: TicketFilterOperator; value: unknown }>;
};

export async function listTickets(q: TicketListQuery) {
  // count(*) в Postgres приходит строкой (bigint), экранам нужно число.
  const res = unwrap<{ total: string | number; data: TicketRow[] }>(
    await ticketsApi.get({
      query: {
        limit: String(q.limit),
        offset: String(q.offset),
        ...(q.filters?.length ? { filters: JSON.stringify(q.filters) } : {}),
      },
    })
  );
  return { total: Number(res.total), data: res.data };
}

export async function getTicket(id: string) {
  return unwrap<TicketCard>(await ticketsApi({ id }).get());
}

export async function closeTicket(id: string) {
  return unwrap<TicketRecord>(await ticketsApi({ id }).close.post());
}

export async function reopenTicket(id: string, comment: string) {
  return unwrap<TicketRecord>(await ticketsApi({ id }).reopen.post({ comment }));
}

export async function cancelTicket(id: string, comment?: string) {
  return unwrap<TicketRecord>(await ticketsApi({ id }).cancel.post(comment ? { comment } : {}));
}

export async function addComment(id: string, body: string) {
  return unwrap<CommentRow>(await ticketsApi({ id }).comments.post({ body }));
}

export async function markSeen(id: string) {
  return unwrap<{ id: string; manager_seen_at: string }>(await ticketsApi({ id }).seen.post());
}

export async function approvePayments(ids: string[]) {
  return unwrap<{ approved: number; skipped: number }>(
    await ticketsApi.payment.approve.post({ ids })
  );
}

export async function rejectPayments(ids: string[], comment: string) {
  return unwrap<{ rejected: number; skipped: number }>(
    await ticketsApi.payment.reject.post({ ids, comment })
  );
}

// Планшет менеджера: GET /ticket_types, право «создание заявки». Отдаёт
// только активные типы.
export async function listTypes() {
  return unwrap<{ data: TicketTypeRow[] }>(await typesApi.get());
}

// Экран админки: GET /ticket_types/manage (право tickets.types.manage; на
// /ticket_types у администратора права нет). include_inactive=true нужен,
// чтобы неактивный тип можно было увидеть и включить обратно: без него
// обработчик скрывает всё, что выключено.
export async function listTypesForManage() {
  return unwrap<{ data: TicketTypeRow[] }>(
    await typesApi.manage.get({ query: { include_inactive: "true" } })
  );
}

// Тела запросов повторяют схемы t.Object контроллера. null они не принимают
// (t.Optional(t.String()) даёт 422), поэтому у полей, которые в строке бывают
// null, во вводе стоит просто необязательная строка: стереть фирму или иконку
// через PUT нельзя.
export type TicketTypeCreateInput = {
  code: string;
  number_prefix: string;
  name_ru: string;
  name_uz: string;
  executor_kind: "external" | "staff";
  fields_schema: FieldDef[];
  icon?: string;
  contractor_id?: string;
  requires_cost?: boolean;
  active?: boolean;
  sort?: number;
};

// code и executor_kind после создания не меняются: PUT их не принимает.
export type TicketTypeUpdateInput = Partial<
  Omit<TicketTypeCreateInput, "code" | "executor_kind">
>;

export async function createType(body: TicketTypeCreateInput) {
  return unwrap<TicketTypeRow>(await typesApi.post(body));
}

export async function updateType(id: string, body: TicketTypeUpdateInput) {
  return unwrap<TicketTypeRow>(await typesApi({ id }).put(body));
}

export async function listContractors() {
  return unwrap<{ data: ContractorRow[] }>(await contractorsApi.get());
}

export type ContractorCreateInput = { name: string; phone?: string; note?: string };
export type ContractorUpdateInput = Partial<ContractorCreateInput & { is_active: boolean }>;

export async function createContractor(body: ContractorCreateInput) {
  return unwrap<ContractorRow>(await contractorsApi.post(body));
}

export async function updateContractor(id: string, body: ContractorUpdateInput) {
  return unwrap<ContractorRow>(await contractorsApi({ id }).put(body));
}

export async function listExecutors(contractorId?: string) {
  return unwrap<{ data: ExecutorRow[] }>(
    await executorsApi.get({
      query: contractorId ? { contractor_id: contractorId } : {},
    })
  );
}

// external требует contractor_id и запрещает user_id, staff наоборот: ровно
// одно из двух, иначе бэкенд ответит 422.
export type ExecutorCreateInput = {
  kind: "external" | "staff";
  contractor_id?: string;
  user_id?: string;
  full_name: string;
  phone?: string;
  lang?: string;
};
export type ExecutorUpdateInput = Partial<{
  full_name: string;
  phone: string;
  lang: string;
  is_active: boolean;
}>;

export async function createExecutor(body: ExecutorCreateInput) {
  return unwrap<ExecutorRow>(await executorsApi.post(body));
}

export async function updateExecutor(id: string, body: ExecutorUpdateInput) {
  return unwrap<ExecutorRow>(await executorsApi({ id }).put(body));
}

export async function issueInvite(id: string) {
  return unwrap<{ invite_code: string; link: string }>(await executorsApi({ id }).invite.post());
}
