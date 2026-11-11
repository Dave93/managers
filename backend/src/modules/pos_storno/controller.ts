import { ctx } from "@backend/context";
import { pos_storno_commands, pos_storno_terminals } from "backend/drizzle/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import Elysia, { t } from "elysia";
import { claimBody, reportBody } from "./contract";
import {
  bearerToken,
  cancelDecision,
  clip,
  decideReport,
  generateToken,
  hashToken,
  identityDecision,
  MAX_MESSAGE_LENGTH,
  normalizeRegisterNumbers,
  pinForOrganization,
  scrubSecret,
  servingTerminals,
  type CommandState,
} from "./rules";
import { authenticateTerminal, claimNext, expireStale, isUniqueViolation, touchTerminal } from "./service";

// Возврат закрытых чеков с касс. Плагин (storno_plugin) ходит сюда сам: Bearer-токен терминала.
// Админка (permission pos_storno.manage) заводит терминалы и команды. PIN служебного сотрудника выдаётся
// только в ответе claim, в базу и логи не пишется. Тела запросов здесь не логируются.

const UUID = t.String({ format: "uuid" });

const stateOf = (c: typeof pos_storno_commands.$inferSelect): CommandState => ({
  status: c.status,
  finishedBy: c.finished_by as CommandState["finishedBy"],
  claimedBy: c.claimed_by,
  leaseUntil: c.lease_until ? new Date(c.lease_until) : null,
  createdAt: new Date(c.created_at),
});

const asUuidOrNull = (value: string | null | undefined) =>
  value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value : null;

export const posStornoController = new Elysia({ name: "@api/pos_storno" })
  .use(ctx)

  // ─── плагин: взять команду ───
  .post(
    "/pos_storno/claim",
    async ({ headers, body, set, drizzle }) => {
      const token = bearerToken(headers["authorization"]);
      const terminal = token ? await authenticateTerminal(drizzle, token) : null;
      if (!terminal) {
        set.status = 401;
        return { message: "Токен не найден или терминал выключен" };
      }

      const numbers = normalizeRegisterNumbers(body.cashRegisterNumbers);
      const touched = await touchTerminal(drizzle, terminal.id, {
        iikoTerminalId: body.terminalId,
        name: body.terminalName ?? null,
        numbers,
        dryRun: body.dryRun,
        pluginVersion: body.pluginVersion ?? null,
      });
      if (!touched || identityDecision(terminal.iiko_terminal_id, body.terminalId) === "mismatch") {
        set.status = 403;
        return { message: "Токен привязан к другой станции iikoFront" };
      }

      await expireStale(drizzle);

      const pin = pinForOrganization(process.env.POS_STORNO_PINS, terminal.organization_id);
      if (!pin) {
        console.warn(`[pos_storno] нет PIN в POS_STORNO_PINS для организации ${terminal.organization_id}`);
        set.status = 204;
        return;
      }

      const command = await claimNext(drizzle, terminal, numbers);
      if (!command) {
        set.status = 204;
        return;
      }

      return {
        command: {
          id: command.id,
          orderId: command.order_id,
          cashRegisterNumber: command.cash_register_number,
          pin,
          paymentTypeId: command.payment_type_id,
          removalTypeId: command.removal_type_id,
          sectionId: null,
          orderTypeId: null,
        },
      };
    },
    { body: claimBody }
  )

  // ─── плагин: итог ───
  .post(
    "/pos_storno/:id/report",
    async ({ headers, params, body, set, drizzle }) => {
      const token = bearerToken(headers["authorization"]);
      const terminal = token ? await authenticateTerminal(drizzle, token) : null;
      if (!terminal) {
        set.status = 401;
        return { message: "Токен не найден или терминал выключен" };
      }

      const rows = await drizzle
        .select()
        .from(pos_storno_commands)
        .where(and(eq(pos_storno_commands.id, params.id), eq(pos_storno_commands.organization_id, terminal.organization_id)))
        .limit(1)
        .execute();
      const command = rows[0];
      // Плагин считает итоговыми только 2xx и 409 и повторяет отчёт на любой другой ответ (иначе настоящий done мог бы
      // потеряться на ответе прокси). Поэтому неприменимый отчёт - 409 с кодом, а не 403/404.
      if (!command) {
        set.status = 409;
        return { code: "not_found", message: "Команда не найдена" };
      }

      const decision = decideReport(stateOf(command), terminal.id);
      if (decision === "forbidden") {
        set.status = 409;
        return { code: "not_claimed_by_you", message: "Команду забрал другой терминал или она не выдавалась" };
      }
      if (decision === "conflict") {
        set.status = 409;
        return { message: "Итог по команде уже получен" };
      }

      const pin = pinForOrganization(process.env.POS_STORNO_PINS, terminal.organization_id);
      // PIN затирается, длинное обрезается (а не отклоняется: отклонённый отчёт плагин повторял бы вечно).
      const message = clip(scrubSecret(body.message ?? null, pin), MAX_MESSAGE_LENGTH);

      // Условие finished_by исключает гонку двух одновременных отчётов.
      const updated = await drizzle
        .update(pos_storno_commands)
        .set({
          status: body.status,
          finished_by: "plugin",
          finished_at: sql`now()`,
          message,
          storno_order_id: asUuidOrNull(body.stornoOrderId),
          plugin_version: clip(body.pluginVersion ?? null, 32),
        })
        .where(
          and(
            eq(pos_storno_commands.id, command.id),
            eq(pos_storno_commands.claimed_by, terminal.id),
            sql`${pos_storno_commands.finished_by} is distinct from 'plugin'`
          )
        )
        .returning({ id: pos_storno_commands.id })
        .execute();
      if (updated.length === 0) {
        set.status = 409;
        return { message: "Итог по команде уже получен" };
      }
      return { ok: true };
    },
    { params: t.Object({ id: UUID }), body: reportBody }
  )

  // ─── админка: терминалы ───
  .post(
    "/pos_storno/terminals",
    async ({ body, user, drizzle }) => {
      const token = generateToken();
      const [row] = await drizzle
        .insert(pos_storno_terminals)
        .values({
          organization_id: body.organization_id,
          name: body.name,
          token_hash: hashToken(token),
          created_by: user?.id ?? null,
        })
        .returning({ id: pos_storno_terminals.id })
        .execute();
      // Токен виден один раз: в базе только хэш.
      return { id: row.id, token };
    },
    {
      permission: "pos_storno.manage",
      body: t.Object({ organization_id: UUID, name: t.String({ minLength: 1, maxLength: 120 }) }),
    }
  )
  .get(
    "/pos_storno/terminals",
    async ({ drizzle }) =>
      drizzle
        .select({
          id: pos_storno_terminals.id,
          organization_id: pos_storno_terminals.organization_id,
          name: pos_storno_terminals.name,
          iiko_terminal_id: pos_storno_terminals.iiko_terminal_id,
          iiko_terminal_name: pos_storno_terminals.iiko_terminal_name,
          cash_register_numbers: pos_storno_terminals.cash_register_numbers,
          dry_run: pos_storno_terminals.dry_run,
          plugin_version: pos_storno_terminals.plugin_version,
          last_seen_at: pos_storno_terminals.last_seen_at,
          active: pos_storno_terminals.active,
          created_at: pos_storno_terminals.created_at,
        })
        .from(pos_storno_terminals)
        .orderBy(desc(pos_storno_terminals.created_at))
        .execute(),
    { permission: "pos_storno.manage" }
  )
  .patch(
    "/pos_storno/terminals/:id",
    async ({ params, body, set, drizzle }) => {
      const patch: Partial<typeof pos_storno_terminals.$inferInsert> = {};
      if (body.active !== undefined) patch.active = body.active;
      if (body.name !== undefined) patch.name = body.name;
      if (Object.keys(patch).length === 0) {
        set.status = 422;
        return { message: "Нечего менять" };
      }
      const updated = await drizzle
        .update(pos_storno_terminals)
        .set(patch)
        .where(eq(pos_storno_terminals.id, params.id))
        .returning({ id: pos_storno_terminals.id })
        .execute();
      if (updated.length === 0) {
        set.status = 404;
        return { message: "Терминал не найден" };
      }
      return { ok: true };
    },
    {
      permission: "pos_storno.manage",
      params: t.Object({ id: UUID }),
      body: t.Object({ active: t.Optional(t.Boolean()), name: t.Optional(t.String({ minLength: 1, maxLength: 120 })) }),
    }
  )

  // ─── админка: команды ───
  .post(
    "/pos_storno/commands",
    async ({ body, user, set, drizzle }) => {
      if (!pinForOrganization(process.env.POS_STORNO_PINS, body.organization_id)) {
        set.status = 409;
        return { code: "no_pin", message: "PIN служебного сотрудника для этого бренда не настроен на сервере" };
      }

      const terminalRows = await drizzle
        .select()
        .from(pos_storno_terminals)
        .where(eq(pos_storno_terminals.organization_id, body.organization_id))
        .execute();
      const serving = servingTerminals(
        terminalRows.map((r) => ({
          active: r.active,
          organizationId: r.organization_id,
          cashRegisterNumbers: r.cash_register_numbers,
          lastSeenAt: r.last_seen_at ? new Date(r.last_seen_at) : null,
          dryRun: r.dry_run,
        })),
        body.organization_id,
        body.cash_register_number,
        new Date()
      );
      if (serving.length === 0) {
        set.status = 409;
        return {
          code: "no_terminal",
          message: `Нет активного плагина на связи для кассы ${body.cash_register_number}: возврат некому выполнить`,
        };
      }

      await expireStale(drizzle);
      try {
        const [row] = await drizzle
          .insert(pos_storno_commands)
          .values({
            organization_id: body.organization_id,
            order_id: body.order_id,
            order_number: body.order_number ?? null,
            cash_register_number: body.cash_register_number,
            payment_type_id: body.payment_type_id,
            removal_type_id: body.removal_type_id ?? null,
            amount: body.amount !== undefined ? String(body.amount) : null,
            created_by: user!.id,
          })
          .returning({ id: pos_storno_commands.id })
          .execute();
        // dry_run: хотя бы один обслуживающий кассу плагин в режиме сухого прогона, тогда возврат может не выполниться
        // (команда уйдёт в dry_run_ok). Админка должна показать это до подтверждения.
        return { id: row.id, dry_run: serving.some((t) => t.dryRun) };
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        const existing = await drizzle
          .select({ id: pos_storno_commands.id, status: pos_storno_commands.status })
          .from(pos_storno_commands)
          .where(
            and(
              eq(pos_storno_commands.organization_id, body.organization_id),
              eq(pos_storno_commands.order_id, body.order_id),
              sql`${pos_storno_commands.status} not in ('rejected', 'expired', 'dry_run_ok', 'cancelled')`
            )
          )
          .limit(1)
          .execute();
        set.status = 409;
        return {
          code: "already_exists",
          message: "По этому чеку уже есть команда на возврат",
          commandId: existing[0]?.id ?? null,
          status: existing[0]?.status ?? null,
        };
      }
    },
    {
      permission: "pos_storno.manage",
      body: t.Object({
        organization_id: UUID,
        order_id: UUID,
        order_number: t.Optional(t.Integer()),
        cash_register_number: t.Integer({ minimum: 0 }),
        // Для чека прошлой смены плагин требует тип оплаты возврата, а чек текущей смены админка отличить не может.
        payment_type_id: UUID,
        removal_type_id: t.Optional(UUID),
        amount: t.Optional(t.Number()),
      }),
    }
  )
  .post(
    "/pos_storno/commands/:id/cancel",
    async ({ params, body, user, set, drizzle }) => {
      const rows = await drizzle
        .select({ status: pos_storno_commands.status })
        .from(pos_storno_commands)
        .where(eq(pos_storno_commands.id, params.id))
        .limit(1)
        .execute();
      if (rows.length === 0) {
        set.status = 404;
        return { message: "Команда не найдена" };
      }
      const note = body.note?.trim() || null;
      const decision = cancelDecision(rows[0].status, note);
      if (decision === "forbidden") {
        set.status = 409;
        return { code: "not_cancellable", message: `Команду в статусе «${rows[0].status}» отменить нельзя` };
      }
      if (decision === "note_required") {
        set.status = 422;
        return { code: "note_required", message: "Сначала проверьте кассу и OLAP, затем укажите, что выяснили (от 3 знаков)" };
      }

      const prefix = note ? `Отменено админом: ${note}` : "Отменено админом";
      // Атомарно по статусу: pending не отменится, если его в этот момент забрал плагин; claimed не отменяется никогда.
      const updated = await drizzle
        .update(pos_storno_commands)
        .set({
          status: "cancelled",
          cancelled_by: user!.id,
          finished_at: sql`now()`,
          message: sql`${prefix}::text || coalesce(E'\nБыло: ' || ${pos_storno_commands.message}, '')`,
        })
        .where(
          and(
            eq(pos_storno_commands.id, params.id),
            sql`${pos_storno_commands.status} in ('pending', 'failed', 'unknown')`,
            eq(pos_storno_commands.status, rows[0].status)
          )
        )
        .returning({ id: pos_storno_commands.id })
        .execute();
      if (updated.length === 0) {
        set.status = 409;
        return { code: "state_changed", message: "Статус команды изменился, обновите список" };
      }
      return { ok: true };
    },
    {
      permission: "pos_storno.manage",
      params: t.Object({ id: UUID }),
      body: t.Object({ note: t.Optional(t.String({ maxLength: 1000 })) }),
    }
  )
  .get(
    "/pos_storno/commands",
    async ({ query, drizzle }) => {
      await expireStale(drizzle);
      const conditions = [];
      if (query.organization_id) conditions.push(eq(pos_storno_commands.organization_id, query.organization_id));
      if (query.status) conditions.push(eq(pos_storno_commands.status, query.status));
      return drizzle
        .select()
        .from(pos_storno_commands)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(pos_storno_commands.created_at))
        .limit(Math.min(Number(query.limit ?? 50), 200))
        .offset(Number(query.offset ?? 0))
        .execute();
    },
    {
      permission: "pos_storno.manage",
      query: t.Object({
        organization_id: t.Optional(UUID),
        status: t.Optional(t.String({ maxLength: 16 })),
        limit: t.Optional(t.String()),
        offset: t.Optional(t.String()),
      }),
    }
  );
