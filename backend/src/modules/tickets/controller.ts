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

const ticketNumber = (prefix: string, seq: number) => `${prefix}-${String(seq).padStart(6, "0")}`;

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
            set.status = 422;
            return { message: r.error };
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
              priority: body.priority === "urgent" ? "urgent" : "normal",
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
        // Файлы легли раньше строк. Если транзакция упала, на диске остаются
        // сироты, на которые ничто не ссылается — убираем их здесь.
        for (const s of saved) {
          try {
            fs.unlinkSync(s.file_path);
          } catch {}
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
    async ({ query: { limit, offset, filters }, terminals: userTerminals, drizzle }) => {
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
        .limit(+limit)
        .offset(+offset)
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
  );
