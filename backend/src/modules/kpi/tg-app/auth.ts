// Вход в мини-приложение по initData Telegram. Ни init_data, ни токены здесь не логируются
// и не попадают в тексты ошибок.
import { createHash, randomBytes } from "node:crypto";
import type Redis from "ioredis";
import { verifyInitData } from "@backend/modules/passport/tg-auth";
import type { DbLike } from "../access";
import { KpiError } from "../errors";
import { bindingOf, hasAnyActiveBinding, langOf } from "../tg/bindings";
import { KPI_TG_SESSION_TTL_SEC, kpiTgSessionKey, type KpiTgSession } from "./ctx";
import { tokenAllowed } from "./init-data";
import type { TgAuthResponse, TgRole } from "./types";

// nowSec — параметр, чтобы срок жизни initData (24 часа) проверялся детерминированно, как в паспорте.
export async function authenticate(db: DbLike, redis: Redis, initData: unknown, nowSec: number): Promise<TgAuthResponse> {
  const botToken = process.env.KPI_BOT_TOKEN;
  if (!botToken) throw new KpiError(503, "not_configured");
  // Тестовый токен из репозитория вне тестов и стенда — как незаданный (решение 21).
  if (!tokenAllowed(botToken, process.env.PROJECT_PREFIX)) throw new KpiError(503, "not_configured");
  // Причину отказа (подпись, срок, нет user) наружу не отдаём: всё это одно «bad_init_data».
  const verified = typeof initData === "string" ? verifyInitData(initData, botToken, nowSec) : null;
  if (!verified?.ok) throw new KpiError(401, "bad_init_data");
  const telegramId = verified.telegramId;

  const pair = await bindingOf(db, telegramId);
  if (!pair.employee && !pair.user) {
    // Активная строка есть, но человек уволен или заблокирован — «доступ закрыт»; строк нет — «нет привязки».
    throw new KpiError(403, (await hasAnyActiveBinding(db, telegramId)) ? "inactive" : "not_bound");
  }

  const session: KpiTgSession = {
    telegram_id: telegramId,
    employee_id: pair.employee?.employee_id ?? null,
    user_id: pair.user?.user_id ?? null,
    lang: langOf(pair),
  };
  const token = randomBytes(32).toString("hex");
  await redis.set(kpiTgSessionKey(token), JSON.stringify(session), "EX", KPI_TG_SESSION_TTL_SEC);

  const roles: TgRole[] = [];
  if (session.employee_id) roles.push("employee");
  if (session.user_id) roles.push("evaluator");
  return { token, roles, lang: session.lang, who: whoOf(session.employee_id, session.user_id) };
}

/**
 * Отпечаток того, кто стоит за этим Telegram. redeemInvite может переназначить привязку
 * на другого сотрудника, и тогда кэш экранов прежнего на телефоне надо стереть: клиент
 * сравнивает who с запомненным. Сами id наружу не уходят — только начало хеша.
 */
export function whoOf(employeeId: string | null, userId: string | null): string {
  return createHash("sha256").update(`${employeeId ?? "-"}:${userId ?? "-"}`).digest("hex").slice(0, 16);
}
