// Сессия мини-приложения «Мой KPI» и Bearer-guard его роутов. Образец — passport/tg-ctx.ts.
// Токен сессии и есть доступ: в этом файле он нигде не логируется.
import { ctx } from "@backend/context";
import Elysia from "elysia";
import type { DbLike } from "../access";
import { KpiError } from "../errors";
import { bindingOf, langOf } from "../tg/bindings";

// Лежит в Redis под kpiTgSessionKey(token). Хотя бы один из двух id задан.
export type KpiTgSession = { telegram_id: number; employee_id: string | null; user_id: string | null; lang: "ru" | "uz" };
// Сессия после перепроверки привязок; lang — из привязки, а не из сессии.
export type KpiTgPrincipal = KpiTgSession;

export const KPI_TG_SESSION_TTL_SEC = 43_200;

export function kpiTgSessionKey(token: string): string {
  return `${process.env.PROJECT_PREFIX}kpi_tg_session:${token}`;
}

// Токен — randomBytes(32) в hex. Всё остальное в заголовке (без «Bearer», другая схема, лишние слова) — нет сессии.
const BEARER_RE = /^bearer ([0-9a-f]{64})$/i;

const isId = (v: unknown): v is string | null => v === null || typeof v === "string";

// В Redis может оказаться что угодно: сессией считаем только объект нужной формы.
function asSession(v: unknown): KpiTgSession | null {
  if (!v || typeof v !== "object") return null;
  const s = v as Record<string, unknown>;
  if (typeof s.telegram_id !== "number" || !Number.isSafeInteger(s.telegram_id) || s.telegram_id <= 0) return null;
  if (!isId(s.employee_id) || !isId(s.user_id)) return null;
  return { telegram_id: s.telegram_id, employee_id: s.employee_id, user_id: s.user_id, lang: s.lang === "uz" ? "uz" : "ru" };
}

// Привязки перепроверяются на каждом запросе: снятая привязка или увольнение закрывают доступ сразу,
// а не через 12 часов. Каждая часть сессии живёт, только пока та же привязка того же человека активна;
// у руководителя увольнение отрезает часть сотрудника, а часть оценщика остаётся.
export async function principalOf(db: DbLike, s: KpiTgSession): Promise<KpiTgPrincipal | null> {
  const pair = await bindingOf(db, s.telegram_id);
  const employee_id = s.employee_id !== null && pair.employee?.employee_id === s.employee_id ? s.employee_id : null;
  const user_id = s.user_id !== null && pair.user?.user_id === s.user_id ? s.user_id : null;
  if (employee_id === null && user_id === null) return null;
  return { telegram_id: s.telegram_id, employee_id, user_id, lang: langOf(pair) };
}

export function requireEmployee(p: KpiTgPrincipal): string {
  if (p.employee_id === null) throw new KpiError(403, "not_employee");
  return p.employee_id;
}

// Guard для роутов мини-приложения под POST /kpi/tg/auth.
//
// Именно .as("scoped"), как у passportTgCtx: derive поднимается ровно на уровень выше — в плагин
// tgAppRoutes, который его подключает, и действует только на роуты, объявленные там после .use().
// "global" прошёл бы дальше в контроллер KPI и корень приложения и потребовал бы Bearer-токен
// от cookie-роутов админки и от вебхука бота.
export const kpiTgCtx = new Elysia({ name: "@api/kpi/tg-ctx" })
  .use(ctx)
  .derive(async ({ headers, redis, drizzle, status }) => {
    const m = BEARER_RE.exec(headers["authorization"] ?? "");
    if (!m) return status(401, { error: "unauthorized" as const });
    let raw: string | null;
    try {
      raw = await redis.get(kpiTgSessionKey(m[1]));
    } catch {
      // Сбой Redis — как нет сессии: клиент войдёт заново.
      return status(401, { error: "unauthorized" as const });
    }
    if (!raw) return status(401, { error: "unauthorized" as const });
    let session: KpiTgSession | null;
    try {
      session = asSession(JSON.parse(raw));
    } catch {
      session = null;
    }
    if (!session) return status(401, { error: "unauthorized" as const });
    const tg = await principalOf(drizzle, session);
    if (!tg) return status(401, { error: "unauthorized" as const });
    return { tg };
  })
  .as("scoped");
