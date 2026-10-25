// Тексты Telegram: русский и узбекский (латиница), parse_mode HTML. Чистые функции.
// Любой вставляемый текст проходит clip + escapeHtml; готовое сообщение не длиннее 4096.
// В узбекском: oʻ/gʻ с U+02BB, тутуқ белгиси (eʼtiroz, maʼlumot) с U+02BC; ASCII-апострофа нет.
export type Lang = "ru" | "uz";
export type OutMessage = { text: string; reply_markup?: object };
export type MessageCtx = { lang: Lang; disputeUntil: string | null };

export class UnknownKindError extends Error {}

export const KPI_KINDS: readonly string[] = [
  "review_submitted",
  "review_changed",
  "violation_recorded",
  "dispute_opened",
  "dispute_resolved",
  "raise_approved",
  "remind_evaluate",
  "overdue_summary",
];
export const DISPUTABLE_KINDS = ["review_submitted", "review_changed", "violation_recorded"] as const;

const TG_LIMIT = 4096;
const FREE_MAX = 500;
const NAME_MAX = 100;
const CHANGES_MAX = 15;
const LAGGING_MAX = 20;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DASH = "—";

// ---------- форматы ----------

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Обрезка по символам (без разрыва суррогатной пары), «…» в конце.
function clip(s: string, max: number): string {
  const cps = Array.from(s);
  return cps.length <= max ? s : cps.slice(0, max).join("") + "…";
}

// Свободный текст: строка без пробелов по краям, клип, экранирование. Пусто или не строка → null.
function text(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : escapeHtml(clip(t, max));
}

function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

const MONTHS: Record<Lang, string[]> = {
  ru: ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"],
  uz: ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr"],
};
const ROMAN = ["I", "II", "III", "IV"];

function ymOf(s: unknown): { y: string; m: number } | null {
  if (typeof s !== "string") return null;
  const r = /^(\d{4})-(\d{2})-\d{2}$/.exec(s);
  if (!r) return null;
  const m = Number(r[2]);
  return m >= 1 && m <= 12 ? { y: r[1], m } : null;
}

export function monthLabel(period: string, lang: Lang): string {
  const ym = ymOf(period);
  if (!ym) return DASH;
  const name = MONTHS[lang][ym.m - 1];
  return lang === "ru" ? `${name} ${ym.y}` : `${ym.y}-yil ${name}`;
}

export function quarterLabel(q: string, lang: Lang): string {
  const ym = ymOf(q);
  if (!ym) return DASH;
  const r = ROMAN[Math.ceil(ym.m / 3) - 1];
  return lang === "ru" ? `${r} квартал ${ym.y}` : `${ym.y}-yil ${r} chorak`;
}

export function fmtPct(n: number | string | null | undefined): string {
  const v = num(n);
  if (v === null) return DASH;
  const r = Number(v.toFixed(2));
  return `${Number.isInteger(r) ? String(r) : r.toFixed(2).replace(".", ",")} %`;
}

export function fmtSum(n: number | string): string {
  const v = num(n);
  if (v === null) return DASH;
  const r = Math.round(Math.abs(v));
  const g = String(r).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return v < 0 && r > 0 ? `-${g}` : g;
}

const pad = (n: number) => String(n).padStart(2, "0");

// Дата и время по Ташкенту (UTC+5, без перехода на летнее время)
export function fmtDateTime(iso: string): string {
  const t = typeof iso === "string" ? new Date(iso).getTime() : NaN;
  if (Number.isNaN(t)) return DASH;
  const d = new Date(t + 5 * 3600 * 1000);
  return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export function ruPlural(n: number, forms: [string, string, string]): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b === 1) return forms[0];
  if (b >= 2 && b <= 4) return forms[1];
  return forms[2];
}

// Длина ≤ 4096: режем по границе строки, чтобы не разорвать сущность или тег; в конце «\n…».
function fitTelegram(t: string): string {
  if (t.length <= TG_LIMIT) return t;
  const lines = t.split("\n");
  let out = "";
  for (const line of lines) {
    const next = out === "" ? line : `${out}\n${line}`;
    if (next.length + 2 > TG_LIMIT) break;
    out = next;
  }
  if (out === "") out = t.slice(0, TG_LIMIT - 2).replace(/&[a-z]*$/, "");
  return `${out}\n…`;
}

const join = (lines: (string | null)[]): string => lines.filter((l): l is string => l !== null).join("\n");

// ---------- уведомления ----------

type P = Record<string, unknown>;

const BTN_DISPUTE: Record<Lang, string> = { ru: "Оспорить", uz: "Eʼtiroz bildirish" };

function disputePart(
  kind: "review" | "violation",
  id: unknown,
  ctx: MessageCtx
): { line: string; markup: object } | null {
  if (!ctx.disputeUntil || typeof id !== "string" || !UUID_RE.test(id)) return null;
  const until = fmtDateTime(ctx.disputeUntil);
  if (until === DASH) return null;
  const line =
    ctx.lang === "ru"
      ? `Не согласны — нажмите «Оспорить» до ${until}.`
      : `Rozi boʻlmasangiz, ${until} gacha «Eʼtiroz bildirish» tugmasini bosing.`;
  return {
    line,
    markup: { inline_keyboard: [[{ text: BTN_DISPUTE[ctx.lang], callback_data: `dispute:${kind}:${id}` }]] },
  };
}

function withDispute(lines: (string | null)[], d: ReturnType<typeof disputePart>): OutMessage {
  if (!d) return { text: join(lines) };
  return { text: join([...lines, d.line]), reply_markup: d.markup };
}

function reviewSubmitted(p: P, ctx: MessageCtx): OutMessage {
  const ru = ctx.lang === "ru";
  const month = monthLabel(p.period as string, ctx.lang);
  const pct = fmtPct(p.score_pct as number);
  return withDispute(
    [ru ? `<b>Оценка за ${month}</b>` : `<b>${month} uchun baho</b>`, ru ? `Итог: ${pct}.` : `Natija: ${pct}.`],
    disputePart("review", p.review_id, ctx)
  );
}

const cell = (v: unknown): string => {
  const n = num(v);
  return n === null ? DASH : String(n);
};

function reviewChanged(p: P, ctx: MessageCtx): OutMessage {
  const ru = ctx.lang === "ru";
  const month = monthLabel(p.period as string, ctx.lang);
  const pct = fmtPct(p.score_pct as number);
  const all = Array.isArray(p.changes)
    ? (p.changes as unknown[]).filter((c): c is P => typeof c === "object" && c !== null)
    : [];
  const rows = all.slice(0, CHANGES_MAX).map((c) => {
    const uz = ctx.lang === "uz" ? text(c.title_uz, NAME_MAX) : null;
    const title = uz ?? text(c.title_ru, NAME_MAX) ?? DASH;
    return `• ${title}: ${cell(c.old)} → ${cell(c.new)}`;
  });
  const more = all.length - CHANGES_MAX;
  if (more > 0) rows.push(ru ? `• …и ещё ${more}` : `• …yana ${more} ta`);
  const comment = text(p.comment, FREE_MAX);
  return withDispute(
    [
      ru ? `<b>Оценка за ${month} изменена</b>` : `<b>${month} uchun baho oʻzgartirildi</b>`,
      ru ? `Новый итог: ${pct}.` : `Yangi natija: ${pct}.`,
      ...rows,
      comment === null ? null : ru ? `Комментарий: ${comment}` : `Izoh: ${comment}`,
    ],
    disputePart("review", p.review_id, ctx)
  );
}

function violationRecorded(p: P, ctx: MessageCtx): OutMessage {
  const ru = ctx.lang === "ru";
  const titleRu = text(p.item_title_ru, NAME_MAX);
  const title = ru ? titleRu : (text(p.item_title_uz, NAME_MAX) ?? titleRu);
  const when = typeof p.occurred_at === "string" ? fmtDateTime(p.occurred_at) : DASH;
  const comment = text(p.comment, FREE_MAX);
  return withDispute(
    [
      ru ? "<b>Зафиксировано нарушение</b>" : "<b>Qoidabuzarlik qayd etildi</b>",
      ru ? `Пункт: ${title ?? "без пункта карты"}` : `Band: ${title ?? "kartadan tashqari"}`,
      when === DASH ? null : ru ? `Когда: ${when}` : `Qachon: ${when}`,
      comment === null ? null : ru ? `Комментарий: ${comment}` : `Izoh: ${comment}`,
    ],
    disputePart("violation", p.violation_id, ctx)
  );
}

function disputeResolved(p: P, ctx: MessageCtx): OutMessage {
  const ru = ctx.lang === "ru";
  const accepted = p.decision === "accepted";
  const comment = text(p.comment, FREE_MAX);
  const commentLine = comment === null ? null : ru ? `Комментарий: ${comment}` : `Izoh: ${comment}`;
  if (p.subject_type === "violation") {
    const head = accepted
      ? ru
        ? "<b>Спор по нарушению принят</b>"
        : "<b>Qoidabuzarlik boʻyicha eʼtiroz qabul qilindi</b>"
      : ru
        ? "<b>Спор по нарушению отклонён</b>"
        : "<b>Qoidabuzarlik boʻyicha eʼtiroz rad etildi</b>";
    const status = accepted
      ? ru
        ? "Нарушение отменено."
        : "Qoidabuzarlik bekor qilindi."
      : ru
        ? "Нарушение остаётся."
        : "Qoidabuzarlik kuchda qoladi.";
    return { text: join([head, status, commentLine]) };
  }
  const month = monthLabel(p.period as string, ctx.lang);
  const head = accepted
    ? ru
      ? `<b>Спор по оценке за ${month} принят</b>`
      : `<b>${month} bahosi boʻyicha eʼtiroz qabul qilindi</b>`
    : ru
      ? `<b>Спор по оценке за ${month} отклонён</b>`
      : `<b>${month} bahosi boʻyicha eʼtiroz rad etildi</b>`;
  const score = accepted ? num(p.score_pct) : null;
  const scoreLine = score === null ? null : ru ? `Новый итог: ${fmtPct(score)}.` : `Yangi natija: ${fmtPct(score)}.`;
  return { text: join([head, scoreLine, commentLine]) };
}

function raiseApproved(p: P, ctx: MessageCtx): OutMessage {
  const ru = ctx.lang === "ru";
  const q = quarterLabel(p.quarter_start as string, ctx.lang);
  const amount = num(p.amount);
  if (amount !== null && amount > 0) {
    const sum = fmtSum(amount);
    return {
      text: ru
        ? `<b>Повышение оклада: ${q}</b>\nРешение HR: +${sum} сум.`
        : `<b>Maosh oshirilishi: ${q}</b>\nHR qarori: +${sum} soʻm.`,
    };
  }
  const line = amount === null ? `${DASH}.` : ru ? "без повышения." : "oshirishsiz.";
  return {
    text: ru ? `<b>Итоги квартала: ${q}</b>\nРешение HR: ${line}` : `<b>Chorak yakunlari: ${q}</b>\nHR qarori: ${line}`,
  };
}

function remindText(lang: Lang, period: unknown, pending: unknown, deadline: unknown): string {
  const ru = lang === "ru";
  const month = monthLabel(period as string, lang);
  const n = num(pending);
  const until = typeof deadline === "string" ? fmtDateTime(deadline) : DASH;
  return join([
    ru ? `<b>Оценки за ${month}</b>` : `<b>${month} baholari</b>`,
    n === null
      ? null
      : ru
        ? `Ждут вашей оценки: ${n} ${ruPlural(n, ["сотрудник", "сотрудника", "сотрудников"])}.`
        : `Baho kutayotgan xodimlar: ${n} ta.`,
    until === DASH ? null : ru ? `Срок: ${until}.` : `Muddat: ${until}.`,
  ]);
}

function disputeOpened(p: P, ctx: MessageCtx): OutMessage {
  const ru = ctx.lang === "ru";
  const month = monthLabel(p.period as string, ctx.lang);
  const name = text(p.employee_name, NAME_MAX);
  const reason = text(p.reason, FREE_MAX);
  const review = p.subject_type !== "violation";
  const subject = ru
    ? review
      ? `Предмет: оценка за ${month}`
      : `Предмет: нарушение, ${month}`
    : review
      ? `Mavzu: ${month} bahosi`
      : `Mavzu: qoidabuzarlik, ${month}`;
  return {
    text: join([
      ru ? "<b>Новый спор</b>" : "<b>Yangi eʼtiroz</b>",
      name === null ? null : ru ? `Сотрудник: ${name}` : `Xodim: ${name}`,
      subject,
      reason === null ? null : ru ? `Причина: ${reason}` : `Sabab: ${reason}`,
      ru ? "Разберите в админке: KPI → Споры." : "Admin panelda koʻrib chiqing: KPI → Споры.",
    ]),
  };
}

function overdueSummary(p: P, ctx: MessageCtx): OutMessage {
  const ru = ctx.lang === "ru";
  const month = monthLabel(p.period as string, ctx.lang);
  const head = ru ? `<b>Срок оценок за ${month} прошёл</b>` : `<b>${month}: baholash muddati tugadi</b>`;
  const all = Array.isArray(p.lagging)
    ? (p.lagging as unknown[]).filter((c): c is P => typeof c === "object" && c !== null)
    : [];
  const total = Math.max(num(p.lagging_total) ?? 0, all.length);
  if (total === 0) return { text: join([head, ru ? "Все оценщики отправили оценки." : "Barcha baholovchilar baholarni yubordi."]) };
  const shown = all.slice(0, LAGGING_MAX);
  const rows = shown.map((l) => `• ${text(l.user_name, NAME_MAX) ?? DASH} — ${cell(l.pending)}`);
  const rest = total - shown.length;
  if (rest > 0) rows.push(ru ? `• …и ещё ${rest}` : `• …yana ${rest} ta`);
  return { text: join([head, ru ? "Не отправили оценки:" : "Baho yubormaganlar:", ...rows]) };
}

export function buildMessage(kind: string, payload: Record<string, unknown>, ctx: MessageCtx): OutMessage {
  const p: P = typeof payload === "object" && payload !== null ? payload : {};
  let m: OutMessage;
  switch (kind) {
    case "review_submitted":
      m = reviewSubmitted(p, ctx);
      break;
    case "review_changed":
      m = reviewChanged(p, ctx);
      break;
    case "violation_recorded":
      m = violationRecorded(p, ctx);
      break;
    case "dispute_resolved":
      m = disputeResolved(p, ctx);
      break;
    case "raise_approved":
      m = raiseApproved(p, ctx);
      break;
    case "remind_evaluate":
      m = { text: remindText(ctx.lang, p.period, p.pending, p.deadline) };
      break;
    case "dispute_opened":
      m = disputeOpened(p, ctx);
      break;
    case "overdue_summary":
      m = overdueSummary(p, ctx);
      break;
    default:
      throw new UnknownKindError(kind);
  }
  return { ...m, text: fitTelegram(m.text) };
}

// ---------- бот ----------

export type BotTextKey =
  | "start_ok"
  | "start_bad"
  | "not_bound"
  | "already_bound"
  | "lang_set"
  | "help"
  | "ask_reason"
  | "dispute_ok"
  | "err_window"
  | "err_exists"
  | "err_short"
  | "err_unavailable"
  | "err_closed"
  | "err_generic";

const BOTH_START_OK =
  "Готово! Уведомления KPI будут приходить сюда.\nTayyor! KPI xabarlari shu yerga keladi.\n\nВыберите язык / Tilni tanlang:";
const BOTH_START_BAD =
  "Ссылка недействительна или устарела. Попросите новую у HR.\nHavola yaroqsiz yoki eskirgan. HR dan yangisini soʻrang.";
const BOTH_NOT_BOUND =
  "Этот чат не подключён к KPI. Откройте ссылку-приглашение от HR.\nBu chat KPI ga ulanmagan. HR bergan taklif havolasini oching.";

const BOT_TEXT: Record<BotTextKey, Record<Lang, string>> = {
  start_ok: { ru: BOTH_START_OK, uz: BOTH_START_OK },
  start_bad: { ru: BOTH_START_BAD, uz: BOTH_START_BAD },
  not_bound: { ru: BOTH_NOT_BOUND, uz: BOTH_NOT_BOUND },
  already_bound: {
    ru: "Вы уже подключены. Команда /my — ваша сводка.",
    uz: "Siz allaqachon ulangansiz. /my buyrugʻi — qisqacha maʼlumot.",
  },
  lang_set: {
    ru: "Язык: русский. Команда /my — ваша сводка.",
    uz: "Til: oʻzbekcha. /my buyrugʻi — qisqacha maʼlumot.",
  },
  help: { ru: "Команда /my — ваша сводка.", uz: "/my buyrugʻi — qisqacha maʼlumot." },
  ask_reason: {
    ru: "Напишите причину спора ответом на это сообщение, не короче {min} символов. Ждём 15 минут.",
    uz: "Eʼtiroz sababini shu xabarga javob qilib yozing, kamida {min} ta belgi. 15 daqiqa kutamiz.",
  },
  dispute_ok: { ru: "Спор открыт. Решение придёт сюда.", uz: "Eʼtirozingiz yuborildi. Qaror shu yerga keladi." },
  err_window: { ru: "Срок споров за этот месяц прошёл.", uz: "Bu oy uchun eʼtiroz muddati tugagan." },
  err_exists: {
    ru: "Спор по этой записи уже открыт.",
    uz: "Bu yozuv boʻyicha eʼtiroz allaqachon ochilgan.",
  },
  err_short: {
    ru: "Причина слишком короткая: нужно не меньше {min} символов. Напишите ещё раз.",
    uz: "Sabab juda qisqa: kamida {min} ta belgi kerak. Qaytadan yozing.",
  },
  err_unavailable: { ru: "Эту запись оспорить нельзя.", uz: "Bu yozuvga eʼtiroz bildirib boʻlmaydi." },
  err_closed: { ru: "Месяц уже закрыт.", uz: "Oy allaqachon yopilgan." },
  err_generic: { ru: "Не получилось. Попробуйте позже.", uz: "Xatolik yuz berdi. Keyinroq urinib koʻring." },
};

export const BOT_TEXT_KEYS = Object.keys(BOT_TEXT) as BotTextKey[];

export function botText(key: BotTextKey, lang: Lang, vars?: { min?: number }): string {
  return BOT_TEXT[key][lang].replace("{min}", String(vars?.min ?? DASH));
}

export const LANG_KEYBOARD = {
  inline_keyboard: [
    [
      { text: "Русский", callback_data: "lang:ru" },
      { text: "Oʻzbekcha", callback_data: "lang:uz" },
    ],
  ],
};

export function myEmployeeText(
  lang: Lang,
  reviews: { period: string; score_pct: number | null }[],
  violations: { occurred_at: string; title_ru: string | null; title_uz: string | null }[]
): string {
  const ru = lang === "ru";
  const rRows = reviews.map((r) => `• ${monthLabel(r.period, lang)} — ${fmtPct(r.score_pct)}`);
  const vRows = violations.map((v) => {
    const titleRu = text(v.title_ru, NAME_MAX);
    const title = (ru ? titleRu : (text(v.title_uz, NAME_MAX) ?? titleRu)) ?? (ru ? "без пункта карты" : "kartadan tashqari");
    return `• ${fmtDateTime(v.occurred_at).slice(0, 10)} ${title}`;
  });
  return fitTelegram(
    [
      ru ? "<b>Ваши оценки</b>" : "<b>Sizning baholaringiz</b>",
      ...(rRows.length ? rRows : [ru ? "Отправленных оценок пока нет." : "Hozircha yuborilgan baho yoʻq."]),
      "",
      ru ? "<b>Нарушения в этом месяце</b>" : "<b>Shu oydagi qoidabuzarliklar</b>",
      ...(vRows.length ? vRows : [ru ? "Нарушений в этом месяце нет." : "Bu oyda qoidabuzarlik yoʻq."]),
    ].join("\n")
  );
}

export function myUserText(lang: Lang, period: string, pending: number, deadline: string): string {
  if (pending > 0) return fitTelegram(remindText(lang, period, pending, deadline));
  const month = monthLabel(period, lang);
  return lang === "ru"
    ? `<b>Оценки за ${month}</b>\nВсе ваши сотрудники оценены.`
    : `<b>${month} baholari</b>\nBarcha xodimlaringiz baholangan.`;
}
