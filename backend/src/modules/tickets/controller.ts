import { ctx } from "@backend/context";
import { parseFilterFields } from "@backend/lib/parseFilterFields";
import {
  ticket_attachments,
  ticket_comments,
  ticket_events,
  ticket_types,
  ticket_work_items,
  ticket_executors,
  tickets,
  terminals,
} from "backend/drizzle/schema";
import { and, desc, eq, inArray, sql, SQLWrapper } from "drizzle-orm";
import fs from "node:fs";
import Elysia, { t } from "elysia";
import { writeEvent } from "./events";
import { validateDetails, type FieldDef } from "./fields";
import { checkUpload, MAX_FILES_PER_PHASE, saveAttachment } from "./storage";
import { allowedFrom } from "./state";

const ticketNumber = (prefix: string, seq: number) => `${prefix}-${String(seq).padStart(6, "0")}`;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_LIST_LIMIT = 200;

// Файл сохранённого вложения нужно откатить, если что-то после него — ещё
// одно сохранение или сама транзакция — не удалось. Бросаем этот класс из
// цикла сохранения, чтобы `return` не обошёл общий catch и не оставил
// файл сиротой, но при этом сохранить исходные 422 и сообщение для клиента.
class UploadFailedError extends Error {}

export const ticketsController = new Elysia({ name: "@api/tickets" })
  .use(ctx)
  .post(
    "/tickets",
    async ({ body, user, terminals: userTerminals, set, drizzle }) => {
      const [type] = await drizzle
        .select()
        .from(ticket_types)
        .where(and(eq(ticket_types.id, body.type_id), eq(ticket_types.active, true)))
        .execute();
      if (!type) {
        set.status = 404;
        return { message: "Тип заявки не найден" };
      }

      // Филиал берётся из сессии, а не из тела запроса: менеджер физически
      // не должен иметь возможности завести заявку на чужой филиал.
      const terminal_id = body.terminal_id ?? userTerminals?.[0];
      if (!terminal_id || (userTerminals?.length && !userTerminals.includes(terminal_id))) {
        set.status = 403;
        return { message: "Филиал недоступен" };
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
      try {
        for (const f of files) {
          const r = await saveAttachment(f, ticket_id);
          if (!r.ok) {
            // Не return: файлы 1..N-1 уже лежат на диске и должны быть
            // удалены общим catch ниже, а не оставлены сиротами.
            throw new UploadFailedError(r.error);
          }
          saved.push({ file_path: r.file_path, mime: r.mime, size_bytes: r.size_bytes });
        }

        const created = await drizzle.transaction(async (tx) => {
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

          await writeEvent(tx, {
            ticket_id,
            type: "created",
            actor_kind: "manager",
            actor_user_id: user!.id,
            payload: { type_code: type.code, priority: row.priority },
          });

          return row;
        });

        return { ...created, number: ticketNumber(type.number_prefix, created.seq) };
      } catch (e) {
        // Файлы легли раньше строк. Если транзакция упала (или один из файлов
        // партии не сохранился), на диске остаются сироты, на которые ничто
        // не ссылается — убираем их здесь.
        for (const s of saved) {
          try {
            fs.unlinkSync(s.file_path);
          } catch (unlinkErr) {
            console.error("tickets: failed to unlink orphan file", s.file_path, unlinkErr);
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
        const where: SQLWrapper[] = [eq(tickets.id, id), inArray(tickets.status, allowedFrom("accept"))];
        if (userTerminals && userTerminals.length > 0) where.push(inArray(tickets.terminal_id, userTerminals));
        const updated = await tx
          .update(tickets)
          .set({ status: "closed", closed_at: new Date().toISOString(), closed_by: user!.id, updated_at: new Date().toISOString() })
          .where(and(...where))
          .returning();
        if (updated.length === 0) return null;
        await writeEvent(tx, { ticket_id: id, type: "closed", actor_kind: "manager", actor_user_id: user!.id });
        return updated[0];
      });

      if (!result) {
        // Ноль обновлённых строк значит "не найдена" или "не в том статусе" —
        // это разные ответы, и второй нельзя выдавать для заявки, которую
        // пользователь вообще не должен видеть (иначе это подтверждает её
        // существование в чужом филиале).
        const scopeWhere: SQLWrapper[] = [eq(tickets.id, id)];
        if (userTerminals && userTerminals.length > 0) scopeWhere.push(inArray(tickets.terminal_id, userTerminals));
        const [ticket] = await drizzle.select({ id: tickets.id }).from(tickets).where(and(...scopeWhere)).execute();
        if (!ticket) {
          set.status = 404;
          return { message: "Заявка не найдена" };
        }
        set.status = 409;
        return { message: "Заявку можно принять только из состояния «сдана»" };
      }
      return result;
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
        const where: SQLWrapper[] = [eq(tickets.id, id), inArray(tickets.status, allowedFrom("reopen"))];
        if (userTerminals && userTerminals.length > 0) where.push(inArray(tickets.terminal_id, userTerminals));
        const updated = await tx
          .update(tickets)
          .set({
            status: "in_progress",
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
        await writeEvent(tx, {
          ticket_id: id,
          type: "reopened",
          actor_kind: "manager",
          actor_user_id: user!.id,
          payload: { comment: comment.trim() },
        });
        return updated[0];
      });
      if (!result) {
        const scopeWhere: SQLWrapper[] = [eq(tickets.id, id)];
        if (userTerminals && userTerminals.length > 0) scopeWhere.push(inArray(tickets.terminal_id, userTerminals));
        const [ticket] = await drizzle.select({ id: tickets.id }).from(tickets).where(and(...scopeWhere)).execute();
        if (!ticket) {
          set.status = 404;
          return { message: "Заявка не найдена" };
        }
        set.status = 409;
        return { message: "Вернуть в работу можно только сданную заявку" };
      }
      return result;
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
      const result = await drizzle.transaction(async (tx) => {
        const where: SQLWrapper[] = [eq(tickets.id, id), inArray(tickets.status, allowedFrom("cancel"))];
        if (userTerminals && userTerminals.length > 0) where.push(inArray(tickets.terminal_id, userTerminals));
        const updated = await tx
          .update(tickets)
          .set({
            status: "cancelled",
            cancelled_at: new Date().toISOString(),
            cancelled_by: user!.id,
            updated_at: new Date().toISOString(),
          })
          .where(and(...where))
          .returning();
        if (updated.length === 0) return null;
        await writeEvent(tx, {
          ticket_id: id,
          type: "cancelled",
          actor_kind: "manager",
          actor_user_id: user!.id,
          payload: { comment: comment?.trim() ?? null },
        });
        return updated[0];
      });
      if (!result) {
        const scopeWhere: SQLWrapper[] = [eq(tickets.id, id)];
        if (userTerminals && userTerminals.length > 0) scopeWhere.push(inArray(tickets.terminal_id, userTerminals));
        const [ticket] = await drizzle.select({ id: tickets.id }).from(tickets).where(and(...scopeWhere)).execute();
        if (!ticket) {
          set.status = 404;
          return { message: "Заявка не найдена" };
        }
        set.status = 409;
        return { message: "Отменить можно только новую или взятую в работу заявку" };
      }
      return result;
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

      return drizzle.transaction(async (tx) => {
        const [comment] = await tx
          .insert(ticket_comments)
          .values({ ticket_id: id, author_kind: "manager", author_user_id: user!.id, body: text.trim() })
          .returning();
        await writeEvent(tx, {
          ticket_id: id,
          type: "comment",
          actor_kind: "manager",
          actor_user_id: user!.id,
          payload: { comment_id: comment.id },
        });
        return comment;
      });
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
  );
