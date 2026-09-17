import { ctx } from "@backend/context";
import type { DrizzleDB } from "@backend/lib/db";
import { parseFilterFields } from "@backend/lib/parseFilterFields";
import {
  ticket_attachments,
  ticket_comments,
  ticket_contractors,
  ticket_events,
  ticket_types,
  ticket_work_items,
  ticket_executors,
  tickets,
  terminals,
} from "backend/drizzle/schema";
import { and, desc, eq, inArray, isNotNull, sql, SQLWrapper } from "drizzle-orm";
import fs from "node:fs";
import Elysia, { t } from "elysia";
import { writeEvent } from "./events";
import { recordNotifications, enqueueNotifications } from "./notify";
import { validateDetails, validateSchema, type FieldDef } from "./fields";
import { checkUpload, MAX_FILES_PER_PHASE, saveAttachment, uploadsBase, UUID_RE } from "./storage";
import { allowedFrom, targetStatus, type TicketStatus } from "./state";

const ticketNumber = (prefix: string, seq: number) => `${prefix}-${String(seq).padStart(6, "0")}`;

const MAX_LIST_LIMIT = 200;

// Файл сохранённого вложения нужно откатить, если что-то после него — ещё
// одно сохранение или сама транзакция — не удалось. Бросаем этот класс из
// цикла сохранения, чтобы `return` не обошёл общий catch и не оставил
// файл сиротой, но при этом сохранить исходные 422 и сообщение для клиента.
class UploadFailedError extends Error {}

// Общий строитель скоупа для переходов статуса: id + (опционально) допустимые
// исходные статусы + филиалы сессии. Используется и в самом UPDATE, и в
// диагностическом SELECT ниже (notFoundOrConflict) — если эти два места
// когда-нибудь разойдутся, один переход сможет закрыть чужую заявку, а
// другой — перестать видеть свою.
function scopedTicketWhere(id: string, userTerminals: string[] | undefined, statusFilter?: TicketStatus[]): SQLWrapper[] {
  const where: SQLWrapper[] = [eq(tickets.id, id)];
  if (statusFilter) where.push(inArray(tickets.status, statusFilter));
  if (userTerminals && userTerminals.length > 0) where.push(inArray(tickets.terminal_id, userTerminals));
  return where;
}

// Ноль обновлённых строк значит "не найдена" или "не в допустимом статусе" —
// разные ответы, и второй нельзя выдавать для заявки, которую пользователь
// вообще не должен видеть (иначе это подтверждает её существование в чужом
// филиале). Различаем повторным SELECT в том же скоупе, но без фильтра по
// статусу.
async function notFoundOrConflict(
  drizzle: DrizzleDB,
  id: string,
  userTerminals: string[] | undefined,
  conflictMessage: string
): Promise<{ status: 404 | 409; body: { message: string } }> {
  const [ticket] = await drizzle
    .select({ id: tickets.id })
    .from(tickets)
    .where(and(...scopedTicketWhere(id, userTerminals)))
    .execute();
  if (!ticket) {
    return { status: 404, body: { message: "Заявка не найдена" } };
  }
  return { status: 409, body: { message: conflictMessage } };
}

const MAX_PAYMENT_IDS = 200;

// ids приходит от офиса пачкой — финансист разом закрывает недельную стопку
// актов чекбоксами. Любой элемент, не прошедший формат UUID, — это не
// "пропустить эту строку и обработать остальные", а отказ всей пачки:
// иначе он тихо выпадет из WHERE ниже, а финансист решит, что оплата по
// нему одобрена. Это уже четвёртый узел в плане с таким классом дефекта.
function validatePaymentIds(ids: unknown): { ok: true; ids: string[] } | { ok: false; message: string } {
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_PAYMENT_IDS) {
    return { ok: false, message: `Передайте от 1 до ${MAX_PAYMENT_IDS} заявок` };
  }
  const bad = ids.find((id) => typeof id !== "string" || !UUID_RE.test(id));
  if (bad !== undefined) {
    return { ok: false, message: `Некорректный id заявки: ${String(bad)}` };
  }
  return { ok: true, ids: ids as string[] };
}

type TicketUpdate = typeof tickets.$inferInsert;
type PaymentEventType = "payment_approved" | "payment_rejected";

// approve и reject отличаются только тем, что именно пишется в tickets и в
// payload события — сама механика (скоуп в WHERE, транзакция, событие на
// каждую реально задетую строку) у них одна и та же. Вынесена сюда, чтобы
// два места не расходились по одному из полей скоупа так, как это едва не
// случилось между close/reopen/cancel до Task 7.
async function applyPaymentDecision(
  drizzle: DrizzleDB,
  ids: string[],
  userTerminals: string[] | undefined,
  fields: Partial<TicketUpdate>,
  eventType: PaymentEventType,
  actorUserId: string,
  buildPayload: (row: { id: string; work_total_amount: string | null }) => Record<string, unknown>
): Promise<number> {
  const { rows: updated, notificationIds } = await drizzle.transaction(async (tx) => {
    // Идемпотентность — в самом WHERE, а не отдельной проверкой до UPDATE:
    // повторное нажатие на уже утверждённой/отклонённой заявке ничего не
    // меняет и не пишет второе событие. Статус тикета (`closed`) не трогаем —
    // деньги идут своим путём отдельно от жизненного цикла заявки.
    // isNotNull(work_total_amount): без суммы акта одобрять или отклонять
    // нечего — заявка не должна попадать в очередь «к оплате» с пустым
    // итогом. Сегодня эту колонку никто не пишет (мини-апп появится позже),
    // и это ровно причина закрыть условие здесь заранее.
    const where: SQLWrapper[] = [
      inArray(tickets.id, ids),
      eq(tickets.status, "closed"),
      eq(tickets.payment_status, "pending"),
      isNotNull(tickets.work_total_amount),
    ];
    // Офисные роли несут пустой terminals (= все филиалы), но если у сессии
    // филиалы всё же есть — например, роль с tickets.payment.approve по
    // ошибке выдали филиалу — скоуп применяется всё равно: чужие деньги
    // трогать нельзя.
    if (userTerminals && userTerminals.length > 0) where.push(inArray(tickets.terminal_id, userTerminals));

    const rows = await tx
      .update(tickets)
      .set(fields)
      .where(and(...where))
      .returning({ id: tickets.id, work_total_amount: tickets.work_total_amount });
    // Цикл может задеть много заявок одной пачкой (финансист чекает разом) —
    // id набираются здесь и ставятся в очередь одним enqueueNotifications
    // после коммита, а не по одному внутри цикла.
    const notificationIds: string[] = [];
    for (const r of rows) {
      const event = await writeEvent(tx, {
        ticket_id: r.id,
        type: eventType,
        actor_kind: "office",
        actor_user_id: actorUserId,
        payload: buildPayload(r),
      });
      // routeEvent вернёт пустой список для payment_approved/payment_rejected
      // (подрядчик не узнаёт о денежном решении офиса из бота) — вызов всё
      // равно делается, чтобы это решало routeEvent, а не отсутствие вызова.
      const ids = await recordNotifications(tx, {
        eventId: event.id,
        ticketId: r.id,
        eventType,
        actorKind: "office",
      });
      notificationIds.push(...ids);
    }
    return { rows, notificationIds };
  });
  await enqueueNotifications(notificationIds);
  return updated.length;
}

// PUT на ticket_types/ticket_contractors/ticket_executors ведёт себя как
// частичное обновление: непереданное поле не должно затираться. Три места
// копировали этот `if (body.x !== undefined) patch.x = body.x` дословно —
// вынесено сюда, чтобы не разойтись по одному полю так, как это едва не
// случилось между close/reopen/cancel до Task 7.
function buildPatch<T extends Record<string, unknown>>(body: Record<string, unknown>, fields: readonly (keyof T)[]): Partial<T> {
  const patch: Partial<T> = {};
  for (const f of fields) {
    const v = body[f as string];
    if (v !== undefined) patch[f] = v as T[typeof f];
  }
  return patch;
}

// 0 обновлённых строк для справочников однозначно значит "не найдена" — в
// отличие от tickets, здесь нет статусного скоупа, который стоило бы отличать
// отдельным SELECT (см. notFoundOrConflict выше).
function rowOrNotFound<T>(rows: T[], notFoundMessage: string): { status: 200; body: T } | { status: 404; body: { message: string } } {
  const row = rows[0];
  return row ? { status: 200, body: row } : { status: 404, body: { message: notFoundMessage } };
}

// Registered on the app root (src/app.ts) with an explicit /api prefix and a
// widened export, same as stoplistController: inside the apiController .use()
// chain these routes overflowed TS2589 and broke the admin type-check/build.
// HTTP-only, no Eden consumers. The hide guard keeps them out of /openapi, as
// the apiController guard did before the move.
const ticketsControllerImpl = new Elysia({ name: "@api/tickets", prefix: "/api" })
  .use(ctx)
  .guard({ detail: { hide: true } })
  .post(
    "/tickets",
    async ({ body, user, terminals: userTerminals, set, drizzle }) => {
      // type_id уходит прямиком в eq() ниже: мусорная строка вместо UUID
      // иначе доезжает до Postgres как сырая 500 "invalid input syntax for
      // type uuid" вместо понятной 422 — стухший кэш на планшете легко
      // присылает именно такую строку (код типа вместо его id).
      if (!UUID_RE.test(body.type_id)) {
        set.status = 422;
        return { message: "type_id должен быть UUID" };
      }
      const [type] = await drizzle
        .select()
        .from(ticket_types)
        .where(and(eq(ticket_types.id, body.type_id), eq(ticket_types.active, true)))
        .execute();
      if (!type) {
        set.status = 404;
        return { message: "Тип заявки не найден" };
      }
      // external с contractor_id = NULL — легальное состояние "фирма ещё не
      // привязана" (см. POST/PUT /ticket_types), но заявку на него завести
      // некому. Дешёвая проверка, до файлов — как и остальные ниже.
      if (type.executor_kind === "external" && !type.contractor_id) {
        set.status = 422;
        return { message: "У типа заявки не выбрана подрядная фирма — обратитесь к администратору" };
      }

      // Филиал берётся из сессии, а не из тела запроса: менеджер физически
      // не должен иметь возможности завести заявку на чужой филиал.
      const terminal_id = body.terminal_id ?? userTerminals?.[0];
      if (!terminal_id || (userTerminals?.length && !userTerminals.includes(terminal_id))) {
        set.status = 403;
        return { message: "Филиал недоступен" };
      }
      // Офисная роль несёт пустой userTerminals, и тогда includes() выше не
      // выполняется — terminal_id из тела долетает до eq() ниже непроверенным
      // и падает сырой 500 на мусорной строке. Ветка с непустыми
      // userTerminals уже гарантированно валидна (id из сессии), но проверяем
      // всё равно — единообразия ради.
      if (!UUID_RE.test(terminal_id)) {
        set.status = 422;
        return { message: "terminal_id должен быть UUID" };
      }

      let parsedDetails: unknown;
      try {
        parsedDetails = JSON.parse(body.details ?? "{}");
      } catch {
        set.status = 422;
        return { message: "details должен быть JSON-объектом" };
      }
      const detailsCheck = validateDetails(type.fields_schema as FieldDef[], parsedDetails);
      if (!detailsCheck.ok) {
        set.status = 422;
        return { message: "Поля заполнены неверно", errors: detailsCheck.errors };
      }

      // Явный список допустимых значений: опечатка вроде "Urgent" или "high"
      // не должна молча стать обычным приоритетом — это уже четвёртый случай
      // такой немой подмены в этом плане (T3 details, T4 qty/unit, T5 size).
      let priority: "normal" | "urgent";
      if (body.priority === undefined) {
        priority = "normal";
      } else if (body.priority === "normal" || body.priority === "urgent") {
        priority = body.priority;
      } else {
        set.status = 422;
        return { message: "priority должен быть normal или urgent" };
      }

      const files = (Array.isArray(body.photos) ? body.photos : body.photos ? [body.photos] : []) as File[];
      if (files.length === 0) {
        set.status = 422;
        return { message: "Нужна хотя бы одна фотография" };
      }
      if (files.length > MAX_FILES_PER_PHASE) {
        set.status = 422;
        return { message: `Не больше ${MAX_FILES_PER_PHASE} фотографий` };
      }
      for (const [i, f] of files.entries()) {
        const c = checkUpload({ mime: f.type, size: f.size, existingCount: i });
        if (!c.ok) {
          set.status = 422;
          return { message: c.error };
        }
      }

      const [terminal] = await drizzle
        .select({ organization_id: terminals.organization_id })
        .from(terminals)
        .where(eq(terminals.id, terminal_id))
        .execute();
      if (!terminal) {
        set.status = 404;
        return { message: "Филиал не найден" };
      }

      const ticket_id = crypto.randomUUID();
      const saved: { file_path: string; mime: string; size_bytes: number }[] = [];
      // Суперсет saved: путь попадает сюда синхронно до Bun.write внутри
      // saveAttachment, а не только после успешного возврата. Если запись
      // самого файла упадёт (диск полон, EIO), saved.push ниже до этого не
      // дойдёт — без onPath такой частично записанный файл не имел пути,
      // по которому его можно откатить, и оставался сиротой на диске.
      const attemptedPaths: string[] = [];
      try {
        for (const f of files) {
          const r = await saveAttachment(f, ticket_id, (p) => attemptedPaths.push(p));
          if (!r.ok) {
            // Не return: файлы 1..N-1 уже лежат на диске и должны быть
            // удалены общим catch ниже, а не оставлены сиротами.
            throw new UploadFailedError(r.error);
          }
          saved.push({ file_path: r.file_path, mime: r.mime, size_bytes: r.size_bytes });
        }

        const { row: created, notificationIds } = await drizzle.transaction(async (tx) => {
          const [row] = await tx
            .insert(tickets)
            .values({
              id: ticket_id,
              type_id: type.id,
              terminal_id,
              organization_id: terminal.organization_id,
              priority,
              details: detailsCheck.details,
              description: body.description?.trim() || null,
              created_by: user!.id,
            })
            .returning();

          await tx.insert(ticket_attachments).values(
            saved.map((s) => ({
              ticket_id,
              phase: "problem" as const,
              file_path: s.file_path,
              mime: s.mime,
              size_bytes: s.size_bytes,
              uploaded_by_kind: "manager" as const,
              uploaded_by_user_id: user!.id,
            }))
          );

          const event = await writeEvent(tx, {
            ticket_id,
            type: "created",
            actor_kind: "manager",
            actor_user_id: user!.id,
            payload: { type_code: type.code, priority: row.priority },
          });
          const notificationIds = await recordNotifications(tx, {
            eventId: event.id,
            ticketId: ticket_id,
            eventType: "created",
            actorKind: "manager",
          });

          return { row, notificationIds };
        });

        await enqueueNotifications(notificationIds);
        return { ...created, number: ticketNumber(type.number_prefix, created.seq) };
      } catch (e) {
        // Файлы легли раньше строк. Если транзакция упала (или один из файлов
        // партии не сохранился), на диске остаются сироты, на которые ничто
        // не ссылается — убираем их здесь. attemptedPaths, а не saved: он
        // включает и файл, на котором сама запись оборвалась (частично
        // записанный, до re.ok никогда не дошедший).
        for (const p of attemptedPaths) {
          try {
            fs.unlinkSync(p);
          } catch (unlinkErr) {
            console.error("tickets: failed to unlink orphan file", p, unlinkErr);
          }
        }
        // Каталог заявки создаётся раньше самих файлов (см. saveAttachment) —
        // после удаления файлов выше он либо не существовал вовсе (упали до
        // первой записи), либо пуст и годен под rmdir. Не трогаем, если в нём
        // всё же что-то осталось (не должно, но лучше не потерять чужой файл).
        try {
          fs.rmdirSync(`${uploadsBase()}/${ticket_id}`);
        } catch (rmdirErr: any) {
          if (rmdirErr?.code !== "ENOENT") {
            console.error("tickets: failed to remove empty ticket dir", ticket_id, rmdirErr);
          }
        }
        if (e instanceof UploadFailedError) {
          set.status = 422;
          return { message: e.message };
        }
        console.error("tickets: create failed", e);
        set.status = 500;
        return { message: "Не удалось создать заявку" };
      }
    },
    {
      permission: "tickets.create",
      type: "multipart/form-data",
      body: t.Object({
        type_id: t.String(),
        terminal_id: t.Optional(t.String()),
        priority: t.Optional(t.String()),
        details: t.Optional(t.String()),
        description: t.Optional(t.String()),
        photos: t.Files({ maxSize: "10m", maxItems: MAX_FILES_PER_PHASE }),
      }),
    }
  )
  .get(
    "/tickets",
    async ({ query: { limit, offset, filters }, terminals: userTerminals, set, drizzle }) => {
      // +limit/+offset без проверки превращают мусорную строку в NaN, который
      // доезжает до drizzle и падает сырой ошибкой Postgres вместо 422.
      const limitNum = Number(limit);
      if (!Number.isInteger(limitNum) || limitNum < 1 || limitNum > MAX_LIST_LIMIT) {
        set.status = 422;
        return { message: `limit должен быть целым числом от 1 до ${MAX_LIST_LIMIT}` };
      }
      const offsetNum = Number(offset);
      if (!Number.isInteger(offsetNum) || offsetNum < 0) {
        set.status = 422;
        return { message: "offset должен быть неотрицательным целым числом" };
      }

      const where: (SQLWrapper | undefined)[] = filters ? parseFilterFields(filters, tickets, {}) : [];
      // Скоупинг по филиалам сессии. Пустой массив у офисной роли означает
      // "все филиалы" — тот же смысл, что в остальных модулях.
      if (userTerminals && userTerminals.length > 0) {
        where.push(inArray(tickets.terminal_id, userTerminals));
      }

      const [{ count }] = await drizzle
        .select({ count: sql<number>`count(*)` })
        .from(tickets)
        .where(and(...where))
        .execute();

      const rows = await drizzle
        .select({
          id: tickets.id,
          seq: tickets.seq,
          status: tickets.status,
          priority: tickets.priority,
          details: tickets.details,
          created_at: tickets.created_at,
          assigned_at: tickets.assigned_at,
          done_at: tickets.done_at,
          manager_seen_at: tickets.manager_seen_at,
          work_total_amount: tickets.work_total_amount,
          payment_status: tickets.payment_status,
          type_name: ticket_types.name_ru,
          type_prefix: ticket_types.number_prefix,
          terminal_name: terminals.name,
          executor_name: ticket_executors.full_name,
        })
        .from(tickets)
        .leftJoin(ticket_types, eq(tickets.type_id, ticket_types.id))
        .leftJoin(terminals, eq(tickets.terminal_id, terminals.id))
        .leftJoin(ticket_executors, eq(tickets.assigned_executor_id, ticket_executors.id))
        .where(and(...where))
        .orderBy(desc(tickets.created_at))
        .limit(limitNum)
        .offset(offsetNum)
        .execute();

      return {
        total: count,
        data: rows.map((r) => ({ ...r, number: ticketNumber(r.type_prefix ?? "T", r.seq) })),
      };
    },
    {
      permission: "tickets.list",
      query: t.Object({
        limit: t.String(),
        offset: t.String(),
        sort: t.Optional(t.String()),
        filters: t.Optional(t.String()),
        fields: t.Optional(t.String()),
      }),
    }
  )
  .get(
    "/tickets/:id",
    async ({ params: { id }, terminals: userTerminals, set, drizzle }) => {
      // Не-UUID в params.id иначе долетает до драйвера как "invalid input
      // syntax for type uuid" — сырая 500 вместо предназначенной 404.
      if (!UUID_RE.test(id)) {
        set.status = 404;
        return { message: "Заявка не найдена" };
      }
      const where: SQLWrapper[] = [eq(tickets.id, id)];
      if (userTerminals && userTerminals.length > 0) {
        where.push(inArray(tickets.terminal_id, userTerminals));
      }
      const [ticket] = await drizzle
        .select()
        .from(tickets)
        .where(and(...where))
        .execute();
      if (!ticket) {
        set.status = 404;
        return { message: "Заявка не найдена" };
      }

      const [type] = await drizzle.select().from(ticket_types).where(eq(ticket_types.id, ticket.type_id)).execute();
      const [attachments, comments, workItems, events] = await Promise.all([
        drizzle.select().from(ticket_attachments).where(eq(ticket_attachments.ticket_id, id)).execute(),
        drizzle.select().from(ticket_comments).where(eq(ticket_comments.ticket_id, id)).orderBy(ticket_comments.created_at).execute(),
        drizzle.select().from(ticket_work_items).where(eq(ticket_work_items.ticket_id, id)).orderBy(ticket_work_items.position).execute(),
        drizzle.select().from(ticket_events).where(eq(ticket_events.ticket_id, id)).orderBy(ticket_events.created_at).execute(),
      ]);

      return {
        ...ticket,
        number: ticketNumber(type?.number_prefix ?? "T", ticket.seq),
        type,
        attachments: attachments.map(({ file_path, ...rest }) => rest),
        comments,
        work_items: workItems,
        events,
      };
    },
    { permission: "tickets.list" }
  )
  .get(
    "/tickets/attachments/:id/file",
    async ({ params: { id }, terminals: userTerminals, set, drizzle }) => {
      if (!UUID_RE.test(id)) {
        set.status = 404;
        return { message: "Файл не найден" };
      }
      const [row] = await drizzle
        .select({ file_path: ticket_attachments.file_path, mime: ticket_attachments.mime, terminal_id: tickets.terminal_id })
        .from(ticket_attachments)
        .leftJoin(tickets, eq(ticket_attachments.ticket_id, tickets.id))
        .where(eq(ticket_attachments.id, id))
        .execute();
      if (!row) {
        set.status = 404;
        return { message: "Файл не найден" };
      }
      // Доступ решается здесь, а не отдачей статики через nginx: по прямой
      // ссылке иначе виден любой файл любого филиала.
      if (userTerminals && userTerminals.length > 0 && !userTerminals.includes(row.terminal_id!)) {
        set.status = 404;
        return { message: "Файл не найден" };
      }
      set.headers["content-type"] = row.mime;
      return Bun.file(row.file_path);
    },
    { permission: "tickets.list" }
  )
  .post(
    "/tickets/:id/close",
    async ({ params: { id }, user, terminals: userTerminals, set, drizzle }) => {
      if (!UUID_RE.test(id)) {
        set.status = 404;
        return { message: "Заявка не найдена" };
      }
      const result = await drizzle.transaction(async (tx) => {
        // Переход проверяется тем же запросом, что и пишет: между SELECT и
        // UPDATE заявку успевают вернуть в работу с другого планшета. Область
        // видимости по филиалам — тоже в WHERE самого UPDATE, а не проверкой
        // постфактум: иначе можно успеть закрыть чужую заявку до проверки.
        const where = scopedTicketWhere(id, userTerminals, allowedFrom("accept"));
        const updated = await tx
          .update(tickets)
          .set({
            status: targetStatus("accept"),
            closed_at: new Date().toISOString(),
            closed_by: user!.id,
            updated_at: new Date().toISOString(),
          })
          .where(and(...where))
          .returning();
        if (updated.length === 0) return null;
        const event = await writeEvent(tx, { ticket_id: id, type: "closed", actor_kind: "manager", actor_user_id: user!.id });
        const notificationIds = await recordNotifications(tx, {
          eventId: event.id,
          ticketId: id,
          eventType: "closed",
          actorKind: "manager",
        });
        return { row: updated[0], notificationIds };
      });

      if (!result) {
        const { status, body } = await notFoundOrConflict(
          drizzle,
          id,
          userTerminals,
          "Заявку можно принять только из состояния «сдана»"
        );
        set.status = status;
        return body;
      }
      await enqueueNotifications(result.notificationIds);
      return result.row;
    },
    { permission: "tickets.close" }
  )
  .post(
    "/tickets/:id/reopen",
    async ({ params: { id }, body: { comment }, user, terminals: userTerminals, set, drizzle }) => {
      if (!UUID_RE.test(id)) {
        set.status = 404;
        return { message: "Заявка не найдена" };
      }
      if (!comment?.trim()) {
        set.status = 422;
        return { message: "Нужен комментарий: без него исполнитель не поймёт, что переделывать" };
      }
      const result = await drizzle.transaction(async (tx) => {
        const where = scopedTicketWhere(id, userTerminals, allowedFrom("reopen"));
        const updated = await tx
          .update(tickets)
          .set({
            status: targetStatus("reopen"),
            done_at: null,
            reopen_count: sql`${tickets.reopen_count} + 1`,
            updated_at: new Date().toISOString(),
          })
          .where(and(...where))
          .returning();
        if (updated.length === 0) return null;
        await tx.insert(ticket_comments).values({
          ticket_id: id,
          author_kind: "manager",
          author_user_id: user!.id,
          body: comment.trim(),
        });
        const event = await writeEvent(tx, {
          ticket_id: id,
          type: "reopened",
          actor_kind: "manager",
          actor_user_id: user!.id,
          payload: { comment: comment.trim() },
        });
        const notificationIds = await recordNotifications(tx, {
          eventId: event.id,
          ticketId: id,
          eventType: "reopened",
          actorKind: "manager",
        });
        return { row: updated[0], notificationIds };
      });
      if (!result) {
        const { status, body } = await notFoundOrConflict(
          drizzle,
          id,
          userTerminals,
          "Вернуть в работу можно только сданную заявку"
        );
        set.status = status;
        return body;
      }
      await enqueueNotifications(result.notificationIds);
      return result.row;
    },
    { permission: "tickets.close", body: t.Object({ comment: t.String() }) }
  )
  .post(
    "/tickets/:id/cancel",
    async ({ params: { id }, body: { comment }, user, terminals: userTerminals, set, drizzle }) => {
      if (!UUID_RE.test(id)) {
        set.status = 404;
        return { message: "Заявка не найдена" };
      }
      // Пустая или пробельная строка после trim — это отсутствие комментария,
      // а не комментарий из пустой строки: не даём "" осесть в payload.
      const trimmedComment = comment?.trim() || null;
      const result = await drizzle.transaction(async (tx) => {
        const where = scopedTicketWhere(id, userTerminals, allowedFrom("cancel"));
        const updated = await tx
          .update(tickets)
          .set({
            status: targetStatus("cancel"),
            cancelled_at: new Date().toISOString(),
            cancelled_by: user!.id,
            updated_at: new Date().toISOString(),
          })
          .where(and(...where))
          .returning();
        if (updated.length === 0) return null;
        const event = await writeEvent(tx, {
          ticket_id: id,
          type: "cancelled",
          actor_kind: "manager",
          actor_user_id: user!.id,
          payload: { comment: trimmedComment },
        });
        const notificationIds = await recordNotifications(tx, {
          eventId: event.id,
          ticketId: id,
          eventType: "cancelled",
          actorKind: "manager",
        });
        return { row: updated[0], notificationIds };
      });
      if (!result) {
        const { status, body } = await notFoundOrConflict(
          drizzle,
          id,
          userTerminals,
          "Отменить можно только новую или взятую в работу заявку"
        );
        set.status = status;
        return body;
      }
      await enqueueNotifications(result.notificationIds);
      return result.row;
    },
    { permission: "tickets.cancel", body: t.Object({ comment: t.Optional(t.String()) }) }
  )
  .post(
    "/tickets/:id/comments",
    async ({ params: { id }, body: { body: text }, user, terminals: userTerminals, set, drizzle }) => {
      if (!UUID_RE.test(id)) {
        set.status = 404;
        return { message: "Заявка не найдена" };
      }
      if (!text?.trim()) {
        set.status = 422;
        return { message: "Пустой комментарий" };
      }
      const where: SQLWrapper[] = [eq(tickets.id, id)];
      if (userTerminals && userTerminals.length > 0) where.push(inArray(tickets.terminal_id, userTerminals));
      const [ticket] = await drizzle.select({ id: tickets.id }).from(tickets).where(and(...where)).execute();
      if (!ticket) {
        set.status = 404;
        return { message: "Заявка не найдена" };
      }

      const { comment, notificationIds } = await drizzle.transaction(async (tx) => {
        const [comment] = await tx
          .insert(ticket_comments)
          .values({ ticket_id: id, author_kind: "manager", author_user_id: user!.id, body: text.trim() })
          .returning();
        const event = await writeEvent(tx, {
          ticket_id: id,
          type: "comment",
          actor_kind: "manager",
          actor_user_id: user!.id,
          payload: { comment_id: comment.id },
        });
        const notificationIds = await recordNotifications(tx, {
          eventId: event.id,
          ticketId: id,
          eventType: "comment",
          actorKind: "manager",
        });
        return { comment, notificationIds };
      });
      await enqueueNotifications(notificationIds);
      return comment;
    },
    { permission: "tickets.list", body: t.Object({ body: t.String() }) }
  )
  .post(
    "/tickets/:id/seen",
    async ({ params: { id }, terminals: userTerminals, drizzle, set }) => {
      if (!UUID_RE.test(id)) {
        set.status = 404;
        return { message: "Заявка не найдена" };
      }
      const where: SQLWrapper[] = [eq(tickets.id, id)];
      if (userTerminals && userTerminals.length > 0) where.push(inArray(tickets.terminal_id, userTerminals));
      const updated = await drizzle
        .update(tickets)
        .set({ manager_seen_at: new Date().toISOString() })
        .where(and(...where))
        .returning({ id: tickets.id, manager_seen_at: tickets.manager_seen_at });
      if (updated.length === 0) {
        set.status = 404;
        return { message: "Заявка не найдена" };
      }
      return updated[0];
    },
    { permission: "tickets.list" }
  )
  .post(
    "/tickets/payment/approve",
    async ({ body: { ids }, user, terminals: userTerminals, set, drizzle }) => {
      const idsCheck = validatePaymentIds(ids);
      if (!idsCheck.ok) {
        set.status = 422;
        return { message: idsCheck.message };
      }
      // Финансист разом чекает пачку — тот же id, отмеченный дважды в одной
      // отправке, это не два разных решения: считаем по уникальным id, иначе
      // approved/skipped в ответе не сойдётся с тем, что реально произошло.
      const uniqueIds = [...new Set(idsCheck.ids)];

      const approved = await applyPaymentDecision(
        drizzle,
        uniqueIds,
        userTerminals,
        {
          payment_status: "approved",
          payment_approved_by: user!.id,
          payment_approved_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        "payment_approved",
        user!.id,
        (r) => ({ amount: r.work_total_amount })
      );
      return { approved, skipped: uniqueIds.length - approved };
    },
    { permission: "tickets.payment.approve", body: t.Object({ ids: t.Array(t.String()) }) }
  )
  .post(
    "/tickets/payment/reject",
    async ({ body: { ids, comment }, user, terminals: userTerminals, set, drizzle }) => {
      const idsCheck = validatePaymentIds(ids);
      if (!idsCheck.ok) {
        set.status = 422;
        return { message: idsCheck.message };
      }
      if (!comment?.trim()) {
        set.status = 422;
        return { message: "Нужен комментарий с причиной отклонения" };
      }
      const trimmedComment = comment.trim();
      const uniqueIds = [...new Set(idsCheck.ids)];

      const rejected = await applyPaymentDecision(
        drizzle,
        uniqueIds,
        userTerminals,
        {
          payment_status: "rejected",
          payment_approved_by: user!.id,
          payment_approved_at: new Date().toISOString(),
          payment_comment: trimmedComment,
          updated_at: new Date().toISOString(),
        },
        "payment_rejected",
        user!.id,
        () => ({ comment: trimmedComment })
      );
      return { rejected, skipped: uniqueIds.length - rejected };
    },
    {
      permission: "tickets.payment.approve",
      body: t.Object({ ids: t.Array(t.String()), comment: t.String() }),
    }
  )
  .get(
    "/ticket_types",
    // По умолчанию отдаём только active: этот список рисует форму создания
    // заявки на планшете, и POST /tickets отвергает неактивный тип 404-й —
    // раньше планшет предлагал заведомо мёртвые типы. include_inactive нужен
    // только экрану админки и потому проверяется отдельно, правом
    // tickets.types.manage, а не общим tickets.create route-permission.
    async ({ query: { include_inactive }, role, cacheController, drizzle }) => {
      let showInactive = false;
      if (include_inactive === "true" && role) {
        const permissions = await cacheController.getPermissionsByRoleId(role.id);
        showInactive = permissions.includes("tickets.types.manage");
      }
      return {
        data: await drizzle
          .select()
          .from(ticket_types)
          .where(showInactive ? undefined : eq(ticket_types.active, true))
          .orderBy(ticket_types.sort, ticket_types.name_ru)
          .execute(),
      };
    },
    // tickets.create, а не tickets.types.manage: список типов рисует форму
    // создания заявки на планшете филиала, а не только экран админки.
    { permission: "tickets.create", query: t.Object({ include_inactive: t.Optional(t.String()) }) }
  )
  .post(
    "/ticket_types",
    async ({ body, set, drizzle }) => {
      const schemaCheck = validateSchema(body.fields_schema);
      if (!schemaCheck.ok) {
        set.status = 422;
        return { message: "Схема полей неверна", errors: schemaCheck.errors };
      }

      // executor_kind уходит напрямую в pgEnum-колонку: непроверенная строка
      // долетела бы до Postgres как "invalid input value for enum" и упала бы
      // сырой 500 вместо понятной 422 — тот же класс дефекта, что и с
      // priority выше.
      let executor_kind: "external" | "staff";
      if (body.executor_kind === "external" || body.executor_kind === "staff") {
        executor_kind = body.executor_kind;
      } else {
        set.status = 422;
        return { message: "executor_kind должен быть external или staff" };
      }
      // contractor_id уходит в eq()/insert как есть: мусорная строка иначе
      // доезжает до Postgres сырой 500 вместо понятной 422 — та же причина,
      // что и у guard'а contractor_id в GET /ticket_executors ниже.
      if (body.contractor_id !== undefined && !UUID_RE.test(body.contractor_id)) {
        set.status = 422;
        return { message: "contractor_id должен быть UUID" };
      }
      // external без фирмы — легальное состояние "фирма ещё не привязана":
      // её подписывают уже после создания типа. А вот staff с contractor_id
      // не имеет смысла ни на каком этапе — та же проверка, что и в PUT ниже.
      if (executor_kind === "staff" && body.contractor_id) {
        set.status = 422;
        return { message: "Типу с исполнителем-сотрудником фирма не нужна" };
      }

      try {
        const [row] = await drizzle
          .insert(ticket_types)
          .values({
            code: body.code,
            number_prefix: body.number_prefix,
            name_ru: body.name_ru,
            name_uz: body.name_uz,
            icon: body.icon ?? null,
            executor_kind,
            contractor_id: body.contractor_id ?? null,
            fields_schema: schemaCheck.schema,
            requires_cost: body.requires_cost ?? true,
            active: body.active ?? true,
            sort: body.sort ?? 0,
          })
          .returning();
        return row;
      } catch (e: any) {
        // idx_ticket_types_code — единственный уникальный индекс на таблице
        // сегодня, но проверяем имя constraint'а, а не только код 23505:
        // будущий уникальный индекс на этой таблице иначе тоже попадёт сюда
        // и получит неверное сообщение "код уже существует".
        const constraint = e?.constraint ?? e?.cause?.constraint;
        const code = e?.code ?? e?.cause?.code;
        if (code === "23505" && constraint === "idx_ticket_types_code") {
          set.status = 409;
          return { message: `Тип с кодом «${body.code}» уже существует` };
        }
        throw e;
      }
    },
    {
      permission: "tickets.types.manage",
      body: t.Object({
        code: t.String(),
        number_prefix: t.String(),
        name_ru: t.String(),
        name_uz: t.String(),
        icon: t.Optional(t.String()),
        executor_kind: t.String(),
        contractor_id: t.Optional(t.String()),
        fields_schema: t.Any(),
        requires_cost: t.Optional(t.Boolean()),
        active: t.Optional(t.Boolean()),
        sort: t.Optional(t.Number()),
      }),
    }
  )
  .put(
    "/ticket_types/:id",
    async ({ params: { id }, body, set, drizzle }) => {
      if (!UUID_RE.test(id)) {
        set.status = 404;
        return { message: "Тип не найден" };
      }
      if (body.contractor_id !== undefined && !UUID_RE.test(body.contractor_id)) {
        set.status = 422;
        return { message: "contractor_id должен быть UUID" };
      }

      // executor_kind здесь не редактируется. external с пустым contractor_id
      // — легальное состояние ("фирма ещё не привязана": её подписывают уже
      // после создания типа, отдельным PUT/ticket_contractors) — PUT не
      // должен блокировать даже переименование такого типа. А вот staff с
      // contractor_id смысла не имеет ни на каком этапе — это единственная
      // сторона инварианта, которую PUT обязан удержать, читая только тело
      // запроса без оглядки на уже сохранённый executor_kind строки.
      const [existing] = await drizzle.select().from(ticket_types).where(eq(ticket_types.id, id)).execute();
      if (!existing) {
        set.status = 404;
        return { message: "Тип не найден" };
      }
      const effectiveContractorId = body.contractor_id !== undefined ? body.contractor_id : existing.contractor_id;
      if (existing.executor_kind === "staff" && effectiveContractorId) {
        set.status = 422;
        return { message: "Типу с исполнителем-сотрудником фирма не нужна" };
      }

      const patch = buildPatch<typeof ticket_types.$inferInsert>(body, [
        "number_prefix",
        "name_ru",
        "name_uz",
        "icon",
        "contractor_id",
        "requires_cost",
        "active",
        "sort",
      ]);
      patch.updated_at = new Date().toISOString();
      if (body.fields_schema !== undefined) {
        const schemaCheck = validateSchema(body.fields_schema);
        if (!schemaCheck.ok) {
          set.status = 422;
          return { message: "Схема полей неверна", errors: schemaCheck.errors };
        }
        patch.fields_schema = schemaCheck.schema;
      }
      const rows = await drizzle.update(ticket_types).set(patch).where(eq(ticket_types.id, id)).returning();
      const result = rowOrNotFound(rows, "Тип не найден");
      set.status = result.status;
      return result.body;
    },
    {
      permission: "tickets.types.manage",
      body: t.Object({
        number_prefix: t.Optional(t.String()),
        name_ru: t.Optional(t.String()),
        name_uz: t.Optional(t.String()),
        icon: t.Optional(t.String()),
        contractor_id: t.Optional(t.String()),
        fields_schema: t.Optional(t.Any()),
        requires_cost: t.Optional(t.Boolean()),
        active: t.Optional(t.Boolean()),
        sort: t.Optional(t.Number()),
      }),
    }
  )
  .get(
    "/ticket_contractors",
    async ({ drizzle }) => ({
      data: await drizzle.select().from(ticket_contractors).orderBy(ticket_contractors.name).execute(),
    }),
    { permission: "tickets.contractors.manage" }
  )
  .post(
    "/ticket_contractors",
    async ({ body, drizzle }) => {
      const [row] = await drizzle
        .insert(ticket_contractors)
        .values({ name: body.name, phone: body.phone ?? null, note: body.note ?? null })
        .returning();
      return row;
    },
    {
      permission: "tickets.contractors.manage",
      body: t.Object({ name: t.String(), phone: t.Optional(t.String()), note: t.Optional(t.String()) }),
    }
  )
  .put(
    "/ticket_contractors/:id",
    async ({ params: { id }, body, set, drizzle }) => {
      if (!UUID_RE.test(id)) {
        set.status = 404;
        return { message: "Фирма не найдена" };
      }
      const patch = buildPatch<typeof ticket_contractors.$inferInsert>(body, ["name", "phone", "note", "is_active"]);
      patch.updated_at = new Date().toISOString();
      const rows = await drizzle.update(ticket_contractors).set(patch).where(eq(ticket_contractors.id, id)).returning();
      const result = rowOrNotFound(rows, "Фирма не найдена");
      set.status = result.status;
      return result.body;
    },
    {
      permission: "tickets.contractors.manage",
      body: t.Object({
        name: t.Optional(t.String()),
        phone: t.Optional(t.String()),
        note: t.Optional(t.String()),
        is_active: t.Optional(t.Boolean()),
      }),
    }
  )
  .get(
    "/ticket_executors",
    async ({ query: { contractor_id }, set, drizzle }) => {
      // Значение уходит прямиком в eq() ниже: мусорная строка вместо UUID
      // иначе доезжает до Postgres как сырая 500, а не понятная 422.
      if (contractor_id !== undefined && !UUID_RE.test(contractor_id)) {
        set.status = 422;
        return { message: "contractor_id должен быть UUID" };
      }
      const where = contractor_id ? [eq(ticket_executors.contractor_id, contractor_id)] : [];
      return {
        data: await drizzle
          .select()
          .from(ticket_executors)
          .where(and(...where))
          .orderBy(ticket_executors.full_name)
          .execute(),
      };
    },
    { permission: "tickets.contractors.manage", query: t.Object({ contractor_id: t.Optional(t.String()) }) }
  )
  .post(
    "/ticket_executors",
    async ({ body, set, drizzle }) => {
      // kind уходит напрямую в pgEnum-колонку — та же причина проверки, что
      // и у executor_kind в POST /ticket_types выше.
      let kind: "external" | "staff";
      if (body.kind === "external" || body.kind === "staff") {
        kind = body.kind;
      } else {
        set.status = 422;
        return { message: "kind должен быть external или staff" };
      }
      // Оба поля уходят в eq()/insert как есть: мусорная строка вместо UUID
      // иначе доезжает до Postgres сырой 500 вместо понятной 422.
      if (body.contractor_id !== undefined && !UUID_RE.test(body.contractor_id)) {
        set.status = 422;
        return { message: "contractor_id должен быть UUID" };
      }
      if (body.user_id !== undefined && !UUID_RE.test(body.user_id)) {
        set.status = 422;
        return { message: "user_id должен быть UUID" };
      }
      // Ограничение ticket_executors_kind_target в БД требует ровно одного
      // из contractor_id/user_id. Проверяем обе стороны здесь, а не только
      // отсутствие нужного поля: лишнее поле иначе уронит insert этим же
      // ограничением как сырую 500 вместо понятной 422.
      if (kind === "external") {
        if (!body.contractor_id) {
          set.status = 422;
          return { message: "Внешнему исполнителю нужна фирма" };
        }
        if (body.user_id) {
          set.status = 422;
          return { message: "Внешнему исполнителю нельзя указывать учётную запись" };
        }
      } else {
        if (!body.user_id) {
          set.status = 422;
          return { message: "Сотруднику нужна учётная запись" };
        }
        if (body.contractor_id) {
          set.status = 422;
          return { message: "Сотруднику нельзя указывать фирму" };
        }
      }
      const [row] = await drizzle
        .insert(ticket_executors)
        .values({
          kind,
          contractor_id: kind === "external" ? body.contractor_id! : null,
          user_id: kind === "staff" ? body.user_id! : null,
          full_name: body.full_name,
          phone: body.phone ?? null,
          lang: body.lang ?? "ru",
        })
        .returning();
      return row;
    },
    {
      permission: "tickets.contractors.manage",
      body: t.Object({
        kind: t.String(),
        contractor_id: t.Optional(t.String()),
        user_id: t.Optional(t.String()),
        full_name: t.String(),
        phone: t.Optional(t.String()),
        lang: t.Optional(t.String()),
      }),
    }
  )
  .put(
    "/ticket_executors/:id",
    async ({ params: { id }, body, set, drizzle }) => {
      if (!UUID_RE.test(id)) {
        set.status = 404;
        return { message: "Исполнитель не найден" };
      }
      const patch = buildPatch<typeof ticket_executors.$inferInsert>(body, ["full_name", "phone", "lang", "is_active"]);
      patch.updated_at = new Date().toISOString();
      const rows = await drizzle.update(ticket_executors).set(patch).where(eq(ticket_executors.id, id)).returning();
      const result = rowOrNotFound(rows, "Исполнитель не найден");
      set.status = result.status;
      return result.body;
    },
    {
      permission: "tickets.contractors.manage",
      body: t.Object({
        full_name: t.Optional(t.String()),
        phone: t.Optional(t.String()),
        lang: t.Optional(t.String()),
        is_active: t.Optional(t.Boolean()),
      }),
    }
  )
  .post(
    "/ticket_executors/:id/invite",
    async ({ params: { id }, set, drizzle }) => {
      if (!UUID_RE.test(id)) {
        set.status = 404;
        return { message: "Исполнитель не найден" };
      }
      // Без имени бота ссылка получается вида https://t.me/?start=inv_...  —
      // формально 200, а на деле открывает пустой t.me и никуда не ведёт.
      // Проверяем до ротации кода: если ссылку выдать нельзя, старая ссылка
      // должна остаться рабочей, а не сгореть вместе с несостоявшейся новой.
      const bot = process.env.TICKETS_BOT_USERNAME;
      if (!bot) {
        console.error("tickets: TICKETS_BOT_USERNAME is not configured, cannot issue an invite link");
        set.status = 500;
        return { message: "Бот приглашений не настроен — обратитесь к администратору" };
      }
      // Новый код на каждый запрос: старую ссылку могли переслать не туда,
      // и она перестаёт работать в тот момент, когда выписана новая.
      const [row] = await drizzle
        .update(ticket_executors)
        .set({ invite_code: sql`gen_random_uuid()`, invite_used_at: null, updated_at: new Date().toISOString() })
        .where(eq(ticket_executors.id, id))
        .returning({ invite_code: ticket_executors.invite_code });
      if (!row) {
        set.status = 404;
        return { message: "Исполнитель не найден" };
      }
      return { invite_code: row.invite_code, link: `https://t.me/${bot}?start=inv_${row.invite_code}` };
    },
    { permission: "tickets.contractors.manage" }
  );

export const ticketsController = ticketsControllerImpl as unknown as Elysia;
