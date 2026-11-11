import { createHash, randomBytes } from "node:crypto";

// Чистые правила POS storno: без базы и сети, покрыты rules.test.ts.

/** Сколько секунд команда принадлежит плагину, забравшему её. Поздний отчёт после этого всё равно принимается. */
export const LEASE_SECONDS = 120;
/** Команда, которую никто не забрал за столько минут (касса выключена), протухает. */
export const PENDING_TTL_MINUTES = 10;
/** Терминал считается «на связи», если опрашивал сервер не позже, чем столько минут назад. */
export const TERMINAL_FRESH_MINUTES = 5;

export const PLUGIN_STATUSES = ["done", "dry_run_ok", "rejected", "failed", "unknown"] as const;
export type PluginStatus = (typeof PLUGIN_STATUSES)[number];
export type CommandStatus = "pending" | "claimed" | "expired" | "cancelled" | PluginStatus;
export type FinishedBy = "plugin" | "timeout" | null;

export function isPluginStatus(value: string): value is PluginStatus {
  return (PLUGIN_STATUSES as readonly string[]).includes(value);
}

// ─── токены терминалов ───

export function generateToken(): string {
  return "pst_" + randomBytes(32).toString("base64url");
}

/** В базе хранится только хэш: токен показывается админу один раз при создании терминала. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function bearerToken(header: string | undefined | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

// ─── PIN служебного сотрудника «API-возврат» ───

/**
 * У каждого бренда свой RMS и свой служебный сотрудник, поэтому PIN по организации:
 * env POS_STORNO_PINS='{"<organization uuid>":"<pin>", ...}'. Нет записи или битый JSON - null (возврат не выдаётся).
 */
export function pinForOrganization(raw: string | undefined, organizationId: string): string | null {
  if (!raw) return null;
  try {
    const map = JSON.parse(raw) as Record<string, unknown>;
    const pin = map?.[organizationId];
    return typeof pin === "string" && pin.length > 0 ? pin : null;
  } catch {
    return null;
  }
}

/** PIN не должен попасть в базу и логи, даже если плагин по ошибке вставил его в сообщение. */
export function scrubSecret(text: string | null | undefined, secret: string | null): string | null {
  if (text == null) return null;
  if (!secret) return text;
  return text.split(secret).join("***");
}

// ─── привязка токена к станции iikoFront ───

export type IdentityDecision = "pin" | "ok" | "mismatch";

/** Первый claim запоминает станцию, дальше токен работает только с ней (украденный токен не уедет на другую кассу). */
export function identityDecision(pinned: string | null, reported: string): IdentityDecision {
  if (!pinned) return "pin";
  return pinned.toLowerCase() === reported.toLowerCase() ? "ok" : "mismatch";
}

export function normalizeRegisterNumbers(input: readonly number[]): number[] {
  return [...new Set(input.filter((n) => Number.isInteger(n) && n >= 0))].sort((a, b) => a - b);
}

// ─── жизненный цикл команды ───

export type CommandState = {
  status: string;
  finishedBy: FinishedBy;
  claimedBy: string | null;
  leaseUntil: Date | null;
  createdAt: Date;
};

export type TimeoutTransition =
  | null
  | { status: "expired" }
  | { status: "unknown"; finishedBy: "timeout"; message: string };

/**
 * Что делать с командой по времени. Взятая, но не завершённая за аренду команда НЕ переотдаётся (возврат вслепую
 * повторять нельзя): уходит в unknown/timeout, админ смотрит кассу и OLAP. Никто не взял - expired.
 */
export function timeoutTransition(c: CommandState, now: Date): TimeoutTransition {
  if (c.status === "pending" && now.getTime() - c.createdAt.getTime() > PENDING_TTL_MINUTES * 60_000) {
    return { status: "expired" };
  }
  if (c.status === "claimed" && c.leaseUntil && now.getTime() > c.leaseUntil.getTime()) {
    return {
      status: "unknown",
      finishedBy: "timeout",
      message: "Нет ответа от кассы: возврат мог выполниться. Проверьте чек на кассе и в OLAP.",
    };
  }
  return null;
}

export type ReportDecision = "accept" | "conflict" | "forbidden";

/**
 * Принять ли отчёт плагина.
 * - отчитаться может только терминал, забравший команду;
 * - итог от плагина уже сохранён - 409 (плагин считает это доставкой и не повторяет);
 * - итог от таймаута (unknown/timeout) - поздний честный отчёт принимается: реальный done не должен потеряться.
 */
export function decideReport(c: CommandState, terminalId: string): ReportDecision {
  if (!c.claimedBy || c.claimedBy !== terminalId) return "forbidden";
  if (c.finishedBy === "plugin") return "conflict";
  if (c.status === "claimed") return "accept";
  if (c.status === "unknown" && c.finishedBy === "timeout") return "accept";
  return "forbidden";
}

// ─── создание команды ───

export type TerminalView = {
  active: boolean;
  organizationId: string;
  cashRegisterNumbers: number[];
  lastSeenAt: Date | null;
  dryRun?: boolean;
};

/** Активные, недавно опрашивавшие терминалы организации, обслуживающие эту кассу. */
export function servingTerminals<T extends TerminalView>(
  terminals: readonly T[],
  organizationId: string,
  cashRegisterNumber: number,
  now: Date
): T[] {
  return terminals.filter(
    (t) =>
      t.active &&
      t.organizationId === organizationId &&
      t.cashRegisterNumbers.includes(cashRegisterNumber) &&
      t.lastSeenAt !== null &&
      now.getTime() - t.lastSeenAt.getTime() <= TERMINAL_FRESH_MINUTES * 60_000
  );
}

export function terminalServesRegister(
  terminals: readonly TerminalView[],
  organizationId: string,
  cashRegisterNumber: number,
  now: Date
): boolean {
  return servingTerminals(terminals, organizationId, cashRegisterNumber, now).length > 0;
}

// ─── отмена команды админом ───

export type CancelDecision = "ok" | "note_required" | "forbidden";

/**
 * Выход из тупика: иначе failed/unknown навсегда блокируют повтор по заказу (уникальный индекс), и нужен SQL на проде.
 * pending отменяется свободно; failed/unknown - только с пояснением (админ сначала посмотрел кассу и OLAP).
 * claimed не отменяется никогда: плагин может прямо сейчас выполнять возврат.
 */
export function cancelDecision(status: string, note: string | null | undefined): CancelDecision {
  if (status === "pending") return "ok";
  if (status === "failed" || status === "unknown") return note && note.trim().length >= 3 ? "ok" : "note_required";
  return "forbidden";
}

/** Длинные сообщения iiko обрезаются, а не отклоняются: отклонённый отчёт плагин повторял бы вечно. */
export const MAX_MESSAGE_LENGTH = 2000;
export function clip(text: string | null | undefined, max: number): string | null {
  if (text == null) return null;
  return text.length > max ? text.slice(0, max) : text;
}
