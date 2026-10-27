// Обработка апдейта Telegram: /start с приглашением, язык, /my, спор через кнопку и ответ с причиной.
// Всё, что идёт после проверки секрета, отвечает 200 даже при ошибке: здесь ошибки ловятся и превращаются в общее сообщение.
import type { DrizzleDB } from "@backend/lib/db";
import { kpi_card_items, kpi_reviews, kpi_violations } from "backend/drizzle/schema";
import { and, asc, desc, eq } from "drizzle-orm";
import type { Redis } from "ioredis";
import type { Actor } from "../access";
import { now } from "../clock";
import { openDispute } from "../disputes";
import { UUID_RE } from "../employees";
import { KpiError } from "../errors";
import { iso } from "../iso";
import { collectDeliveries } from "../notify";
import { laggingEvaluators } from "../periods";
import { loadSettings } from "../settings";
import { currentReviewPeriod, disputeDeadline, periodOf, reviewDeadline } from "../time";
import { hasRejectedDispute } from "../violations";
import type { BotApi } from "./bot-api";
import { bindingOf, langOf, redeemInvite, setLang } from "./bindings";
import { LANG_KEYBOARD, botText, joinMy, myEmployeeText, myUserText, openAppMarkup, type BotTextKey, type Lang, type OutMessage } from "./messages";
import { syncMenuButton } from "./menu";
import { miniAppUrl } from "./miniapp-url";
import type { BotUpdate } from "./updates";

export const DISPUTE_STATE_TTL = 900;

export function disputeStateKey(chatId: number): string {
  return `${process.env.PROJECT_PREFIX ?? ""}kpi_tg_dispute:${chatId}`;
}

type Deps = { db: DrizzleDB; redis: Redis; api: BotApi };
type SubjectType = "review" | "violation";
type DisputeState = { subject_type: SubjectType; subject_id: string; employee_id: string };

// Спор от имени сотрудника: пользователя нет, права не нужны, владельца записи проверяем сами.
const TG_ACTOR: Actor = { userId: "", perms: new Set(), isHq: false, terminals: [] };

// В логи не должны попадать ни токен приглашения (32 hex), ни токен бота.
function redact(s: string): string {
  return s.replace(/[0-9a-f]{32}/gi, "***").replace(/\d{6,}:[A-Za-z0-9_-]{30,}/g, "***");
}

const errText = (e: unknown): string => redact(e instanceof Error ? (e.stack ?? e.message) : String(e));

async function ownerOf(db: DrizzleDB, type: SubjectType, id: string): Promise<{ employee_id: string; period: string } | null> {
  const [row] =
    type === "review"
      ? await db.select({ employee_id: kpi_reviews.employee_id, period: kpi_reviews.period }).from(kpi_reviews).where(eq(kpi_reviews.id, id))
      : await db.select({ employee_id: kpi_violations.employee_id, period: kpi_violations.period }).from(kpi_violations).where(eq(kpi_violations.id, id));
  return row ?? null;
}

function parseState(raw: string | null): DisputeState | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw);
    if (
      s &&
      (s.subject_type === "review" || s.subject_type === "violation") &&
      typeof s.subject_id === "string" && UUID_RE.test(s.subject_id) &&
      typeof s.employee_id === "string" && UUID_RE.test(s.employee_id)
    ) {
      return { subject_type: s.subject_type, subject_id: s.subject_id, employee_id: s.employee_id };
    }
  } catch {
    // мусор в Redis — как будто состояния нет
  }
  return null;
}

async function myEmployeeSummary(db: DrizzleDB, lang: Lang, employeeId: string): Promise<string> {
  const at = now();
  const reviews = await db
    .select({ period: kpi_reviews.period, score_pct: kpi_reviews.score_pct })
    .from(kpi_reviews)
    .where(and(eq(kpi_reviews.employee_id, employeeId), eq(kpi_reviews.status, "submitted")))
    .orderBy(desc(kpi_reviews.period))
    .limit(3);
  const viol = await db
    .select({ occurred_at: kpi_violations.occurred_at, title_ru: kpi_violations.item_title_ru, title_uz: kpi_card_items.title_uz })
    .from(kpi_violations)
    .leftJoin(kpi_card_items, eq(kpi_card_items.id, kpi_violations.card_item_id))
    .where(and(eq(kpi_violations.employee_id, employeeId), eq(kpi_violations.status, "active"), eq(kpi_violations.period, periodOf(at))))
    .orderBy(asc(kpi_violations.occurred_at))
    .limit(30);
  return myEmployeeText(
    lang,
    reviews.map((r) => ({ period: r.period, score_pct: r.score_pct === null ? null : Number(r.score_pct) })),
    viol.map((v) => ({ occurred_at: iso(v.occurred_at), title_ru: v.title_ru, title_uz: v.title_uz }))
  );
}

async function myUserSummary(db: DrizzleDB, lang: Lang, userId: string): Promise<string> {
  const at = now();
  const s = await loadSettings(db);
  const period = currentReviewPeriod(at, s.review_deadline_day);
  const row = (await laggingEvaluators(db, period)).find((l) => l.user_id === userId);
  return myUserText(lang, period, row?.pending ?? 0, reviewDeadline(period, s.review_deadline_day).toISOString());
}

// Код ошибки openDispute → ключ ответа. Неизвестное — общее сообщение.
const DISPUTE_ERRORS: Record<string, BotTextKey> = {
  comment_required: "err_short",
  dispute_window_closed: "err_window",
  dispute_exists: "err_exists",
  dispute_rejected: "err_rejected",
  period_closed: "err_closed",
  not_submitted: "err_unavailable",
  already_cancelled: "err_unavailable",
  not_found: "err_unavailable",
  out_of_scope: "err_unavailable",
  forbidden: "err_unavailable",
};

async function handle(u: Exclude<BotUpdate, { type: "ignore" }>, { db, redis, api }: Deps, setLangOf: (l: Lang) => void) {
  const say = async (lang: Lang, key: BotTextKey, extra: { min?: number; name?: string; reply_markup?: object } = {}) => {
    const msg: OutMessage = { text: botText(key, lang, { min: extra.min, name: extra.name }) };
    if (extra.reply_markup) msg.reply_markup = extra.reply_markup;
    const res = await api.send(u.chatId, msg);
    if (!res.ok) console.error(`kpi bot: sendMessage не удался (${key}): ${redact(res.error)}`);
  };
  const stateKey = disputeStateKey(u.chatId);

  if (u.type === "start") {
    if (u.token) {
      const r = await redeemInvite(db, u.token, u.fromId);
      if (r.status === "invalid") return say("ru", "start_bad");
      return say("ru", r.dual ? "start_ok_dual" : "start_ok", { name: r.name, reply_markup: LANG_KEYBOARD });
    }
    if (u.hasPayload) return say("ru", "start_bad");
    const pair = await bindingOf(db, u.fromId);
    const any = !!(pair.employee || pair.user);
    if (any) setLangOf(langOf(pair));
    return any ? say(langOf(pair), "already_bound") : say("ru", "not_bound");
  }

  if (u.type === "callback") {
    // Ответ на нажатие только гасит «часики» на кнопке: результат не важен и не повторяется.
    await api.answerCallback(u.callbackId).catch(() => undefined);
    const a = u.action;
    if (a.kind === "unknown") return;
    if (a.kind === "lang") {
      // Кнопку меню переставляем только при смене языка (решение 16): повторное нажатие не должно дёргать Telegram.
      const before = langOf(await bindingOf(db, u.fromId));
      const p = await setLang(db, u.fromId, a.lang);
      if (!p) return say("ru", "not_bound");
      if (before !== a.lang) await syncMenuButton(api, u.chatId, a.lang);
      return say(langOf(p), "lang_set");
    }
    const pair = await bindingOf(db, u.fromId);
    const lang = langOf(pair);
    if (pair.employee || pair.user) setLangOf(lang);
    // Спорить может только сотрудник; у одной привязки оценщика кнопки «Оспорить» нет, а чужая нажатая — «не подключён».
    if (!pair.employee) return say(lang, "not_bound");
    const employeeId = pair.employee.employee_id!;
    const owner = await ownerOf(db, a.subject_type, a.subject_id);
    if (!owner || owner.employee_id !== employeeId) return say(lang, "err_unavailable");
    // Кнопка из старого сообщения после отказа: причину не спрашиваем (план 8). openDispute всё равно проверит под блокировкой.
    if (await hasRejectedDispute(db, a.subject_type, a.subject_id)) return say(lang, "err_rejected");
    const settings = await loadSettings(db);
    if (now().getTime() > disputeDeadline(owner.period, settings.dispute_deadline_day).getTime()) return say(lang, "err_window");
    const state: DisputeState = { subject_type: a.subject_type, subject_id: a.subject_id, employee_id: employeeId };
    await redis.set(stateKey, JSON.stringify(state), "EX", DISPUTE_STATE_TTL);
    return say(lang, "ask_reason", { min: settings.change_comment_min, reply_markup: { force_reply: true } });
  }

  const pair = await bindingOf(db, u.fromId);
  const bound = !!(pair.employee || pair.user);
  const lang: Lang = langOf(pair);
  if (bound) setLangOf(lang);

  if (u.type === "my") {
    if (!bound) return say(lang, "not_bound");
    // Сначала оценщик, потом сотрудник.
    const parts = [
      ...(pair.user ? [await myUserSummary(db, lang, pair.user.user_id!)] : []),
      ...(pair.employee ? [await myEmployeeSummary(db, lang, pair.employee.employee_id!)] : []),
    ];
    const out: OutMessage = { text: joinMy(parts) };
    const appUrl = miniAppUrl();
    if (appUrl) out.reply_markup = openAppMarkup(lang, appUrl);
    const res = await api.send(u.chatId, out);
    if (!res.ok) console.error(`kpi bot: sendMessage не удался (my): ${redact(res.error)}`);
    return;
  }
  if (u.type === "help") return say(lang, bound ? "help" : "not_bound");

  // text
  const state = parseState(await redis.get(stateKey));
  if (!state) {
    // Состояния нет (истекло, спор уже открыт или в Redis мусор): как /help.
    return say(lang, bound ? "help" : "not_bound");
  }
  const owner = await ownerOf(db, state.subject_type, state.subject_id);
  if (!pair.employee || pair.employee.employee_id !== state.employee_id || !owner || owner.employee_id !== state.employee_id) {
    await redis.del(stateKey);
    return say(lang, "err_unavailable");
  }
  try {
    // collectDeliveries только вокруг openDispute: задача доставки ставится лишь после успешного коммита спора.
    await collectDeliveries(() =>
      openDispute(db, TG_ACTOR, { subject_type: state.subject_type, subject_id: state.subject_id, reason: u.text, via: "telegram", employee_actor: true })
    );
  } catch (e) {
    if (!(e instanceof KpiError)) throw e;
    const key = DISPUTE_ERRORS[e.code] ?? "err_generic";
    // Короткая причина: состояние живёт, человек пишет ещё раз. Остальные ошибки повтором не лечатся.
    if (key === "err_short") return say(lang, key, { min: typeof e.extra.min === "number" ? e.extra.min : undefined });
    await redis.del(stateKey);
    return say(lang, key);
  }
  await redis.del(stateKey);
  return say(lang, "dispute_ok");
}

export async function handleUpdate(u: BotUpdate, deps: Deps): Promise<void> {
  if (u.type === "ignore") return;
  let lang: Lang = "ru";
  try {
    await handle(u, deps, (l) => {
      lang = l;
    });
  } catch (e) {
    console.error(`kpi bot: ошибка обработки апдейта (${u.type}): ${errText(e)}`);
    try {
      await deps.api.send(u.chatId, { text: botText("err_generic", lang) });
    } catch (e2) {
      console.error(`kpi bot: общее сообщение об ошибке не ушло: ${errText(e2)}`);
    }
  }
}
