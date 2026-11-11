import { and, eq, sql } from "drizzle-orm";
import { pos_storno_commands, pos_storno_terminals } from "backend/drizzle/schema";
import type { DrizzleDB } from "@backend/lib/db";
import { hashToken, LEASE_SECONDS, PENDING_TTL_MINUTES } from "./rules";

// Работа с базой для POS storno. Правила (что принять, что истекло) - в rules.ts; SQL здесь повторяет их
// timeoutTransition одним запросом, чтобы не гонять строки через приложение.

export type Terminal = typeof pos_storno_terminals.$inferSelect;
export type Command = typeof pos_storno_commands.$inferSelect;

export async function authenticateTerminal(db: DrizzleDB, token: string): Promise<Terminal | null> {
  const rows = await db
    .select()
    .from(pos_storno_terminals)
    .where(and(eq(pos_storno_terminals.token_hash, hashToken(token)), eq(pos_storno_terminals.active, true)))
    .limit(1)
    .execute();
  return rows[0] ?? null;
}

/**
 * Обновляет «живость» терминала и привязывает токен к станции iikoFront одним запросом:
 * станция запоминается при первом claim; другая станция с тем же токеном строки не получит (null).
 */
export async function touchTerminal(
  db: DrizzleDB,
  terminalRowId: string,
  info: { iikoTerminalId: string; name: string | null; numbers: number[]; dryRun: boolean; pluginVersion: string | null }
): Promise<Terminal | null> {
  const result = await db.execute(sql`
    UPDATE pos_storno_terminals
       SET iiko_terminal_id = COALESCE(iiko_terminal_id, ${info.iikoTerminalId}),
           iiko_terminal_name = ${info.name},
           cash_register_numbers = ${JSON.stringify(info.numbers)}::jsonb,
           dry_run = ${info.dryRun},
           plugin_version = ${info.pluginVersion},
           last_seen_at = now()
     WHERE id = ${terminalRowId}
       AND active
       AND (iiko_terminal_id IS NULL OR lower(iiko_terminal_id) = lower(${info.iikoTerminalId}))
    RETURNING *
  `);
  return ((result as any).rows?.[0] as Terminal | undefined) ?? null;
}

/** Ленивое истечение вместо крона: вызывается из claim и списков. Согласовано с rules.timeoutTransition. */
export async function expireStale(db: DrizzleDB): Promise<void> {
  await db.execute(sql`
    UPDATE pos_storno_commands
       SET status = 'expired', finished_at = now()
     WHERE status = 'pending'
       AND created_at < now() - make_interval(mins => ${PENDING_TTL_MINUTES})
  `);
  await db.execute(sql`
    UPDATE pos_storno_commands
       SET status = 'unknown', finished_by = 'timeout', finished_at = now(),
           message = 'Нет ответа от кассы: возврат мог выполниться. Проверьте чек на кассе и в OLAP.'
     WHERE status = 'claimed'
       AND lease_until < now()
  `);
}

export type ClaimedCommand = {
  id: string;
  order_id: string;
  cash_register_number: number;
  payment_type_id: string;
  removal_type_id: string | null;
};

/**
 * Атомарный захват: один UPDATE с подзапросом FOR UPDATE SKIP LOCKED, два опрашивающих не получат одну команду.
 * Только своя организация и только кассы терминала.
 */
export async function claimNext(db: DrizzleDB, terminal: Terminal, numbers: number[]): Promise<ClaimedCommand | null> {
  if (numbers.length === 0) return null;
  const result = await db.execute(sql`
    UPDATE pos_storno_commands c
       SET status = 'claimed',
           claimed_by = ${terminal.id},
           claimed_at = now(),
           lease_until = now() + make_interval(secs => ${LEASE_SECONDS})
     WHERE c.id = (
       SELECT id FROM pos_storno_commands
        WHERE status = 'pending'
          AND organization_id = ${terminal.organization_id}
          AND cash_register_number = ANY(${sql.raw(`ARRAY[${numbers.map((n) => Number(n)).join(",")}]::int[]`)})
        ORDER BY created_at
        FOR UPDATE SKIP LOCKED
        LIMIT 1
     )
    RETURNING c.id, c.order_id, c.cash_register_number, c.payment_type_id, c.removal_type_id
  `);
  return ((result as any).rows?.[0] as ClaimedCommand | undefined) ?? null;
}

export function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}
