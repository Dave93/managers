// Тексты RU/UZ и языковые помощники (без DOM). Таблица — дословно из плана 7.
// Узбекский — латиница: oʻ/gʻ с U+02BB, eʼ/maʼ с U+02BC, ASCII-апострофа нет.
// Пробел внутри чисел и перед «сум», «soʻm», «%», «тыс» — U+00A0.
import type { FailStatus } from "./api";
import { capFirst } from "./util";

export type Lang = "ru" | "uz";

const RU = {
  app_title: "Мой KPI",
  st_ready: "Оценка готова",
  st_dispute_open: "Спор на рассмотрении",
  st_dispute_resolved: "Спор разобран",
  st_changed: "Изменена",
  dsp_can: "Оспорить можно до {date}.",
  dsp_open: "Вы оспорили оценку {date}. Ответ придёт в бот.",
  dsp_open_violation: "Вы оспорили нарушение {date}. Ответ придёт в бот.",
  dsp_cancelled: "Нарушение отменено, оспаривать нечего.",
  dsp_window_closed: "Срок спора прошёл.",
  dsp_period_closed: "Месяц закрыт, оспорить нельзя.",
  dsp_accepted: "Спор принят",
  dsp_rejected: "Спор отклонён",
  lost_title: "Где потеряны баллы",
  lost_none: "Все пункты на максимуме",
  btn_full: "Вся оценка и комментарии",
  pending_title: "{month} ещё не оценён",
  pending_from: "Оценку поставят с {date}.",
  pending_until: "Оценку поставят до {date}.",
  pending_viol: "Нарушений в {month}: {n}",
  raise_title: "Прибавка за {quarter}",
  badge_prelim: "предварительно",
  badge_approved: "Утверждено: +{sum}\u00a0сум",
  badge_no_raise: "Без прибавки",
  h_none: "Оценок в этом квартале ещё нет.",
  h_impossible: "В этом квартале прибавки не будет: оценено {k} мес., а нужно не меньше {min}.",
  h_few_1: "Оценён {k} месяц из 3, а прибавку считают от {min}.",
  h_few_n: "Оценено {k} месяца из 3, а прибавку считают от {min}.",
  h_hold: "Держите уровень {months} — выйдет {sum}\u00a0сум.",
  h_hold_zero: "При таком уровне прибавки не будет.",
  h_now: "Сейчас выходит {sum}\u00a0сум.",
  h_now_zero: "Пока без прибавки.",
  h_keep: "Сохранится, если в {months} будет от {pct}\u00a0%.",
  h_next: "Для {sum}\u00a0сум — в среднем {pct}\u00a0% за {months}.",
  h_next_no: "{sum}\u00a0сум в этом квартале уже не получится.",
  h_wait: "Ждём решения HR. Предварительно: {sum}\u00a0сум.",
  h_wait_zero: "Ждём решения HR. Предварительно: без прибавки.",
  m_pending: "не оценён",
  m_upcoming: "с {ddmm}",
  m_not_rated: "не оценивался",
  link_viol: "Нарушения в {month}",
  link_history: "История",
  hist_running: "идёт",
  hist_waiting: "Ждём решения HR",
  hist_approved: "Утверждено +{sum}\u00a0сум",
  hist_no_raise: "Без прибавки",
  hist_pending: "ещё не оценён",
  hist_avg: "Средний",
  hist_empty: "Истории пока нет",
  hist_upcoming: "с {date}",
  grp_base: "Основные пункты",
  grp_extra: "Дополнительные пункты",
  src_attendance: "по данным Workly",
  src_branch: "по баллу филиала",
  no_data: "нет данных",
  no_data_hint: "Пункт не учтён в итоге: данных за месяц нет.",
  changes_title: "Изменения",
  change_reason: "Причина: {text}",
  comment: "Комментарий: {text}",
  btn_dispute: "Оспорить",
  sheet_review: "Оспорить оценку за {month}",
  sheet_violation: "Оспорить нарушение",
  sheet_hint: "Напишите, с чем не согласны. Ответ придёт в бот.",
  sheet_placeholder: "Например: 18 октября у меня был выходной…",
  sheet_min: "Не меньше {min} букв или цифр",
  sheet_send: "Отправить спор",
  err_comment_required: "Слишком коротко: нужно не меньше {min} букв или цифр.",
  err_dispute_window_closed: "Срок спора прошёл.",
  err_dispute_exists: "Спор уже открыт.",
  err_period_closed: "Месяц закрыт.",
  err_already_cancelled: "Нарушение уже отменено.",
  err_not_found: "Запись не найдена.",
  err_generic: "Не получилось. Попробуйте ещё раз.",
  viol_title: "Нарушения · {month}",
  viol_no_item: "Без пункта карты",
  viol_active: "действует",
  viol_cancelled: "отменено",
  viol_dispute: "спор открыт",
  viol_note: "Нарушение само балл не снижает. Его учитывает оценщик, когда ставит оценку.",
  viol_empty: "Нарушений нет",
  photo_failed: "Фото не загрузилось",
  eval_pending: "Нужно оценить {n} {employees} до {date}",
  eval_done: "Все ваши сотрудники оценены",
  eval_link: "Открыть в админке",
  no_card: "Для вашей должности KPI пока не настроен",
  offline_stamp: "Обновлено в {time} — нет связи",
  slow: "Связь плохая, ещё пробуем",
  btn_retry: "Повторить",
} as const;

export type Key = keyof typeof RU;

const UZ: Record<Key, string> = {
  app_title: "Mening KPI",
  st_ready: "Baho tayyor",
  st_dispute_open: "Eʼtiroz koʻrib chiqilmoqda",
  st_dispute_resolved: "Eʼtiroz koʻrib chiqildi",
  st_changed: "Oʻzgartirildi",
  dsp_can: "{date} gacha eʼtiroz bildirish mumkin.",
  dsp_open: "Siz {date} kuni eʼtiroz bildirdingiz. Javob botga keladi.",
  dsp_open_violation: "Siz {date} kuni qoidabuzarlikka eʼtiroz bildirdingiz. Javob botga keladi.",
  dsp_cancelled: "Qoidabuzarlik bekor qilingan, eʼtiroz kerak emas.",
  dsp_window_closed: "Eʼtiroz muddati oʻtdi.",
  dsp_period_closed: "Oy yopilgan, eʼtiroz bildirib boʻlmaydi.",
  dsp_accepted: "Eʼtiroz qabul qilindi",
  dsp_rejected: "Eʼtiroz rad etildi",
  lost_title: "Ballar qayerda yoʻqotildi",
  lost_none: "Barcha bandlar maksimumda",
  btn_full: "Toʻliq baho va izohlar",
  pending_title: "{month} hali baholanmagan",
  pending_from: "Baho {date} dan qoʻyiladi.",
  pending_until: "Baho {date} gacha qoʻyiladi.",
  pending_viol: "{month}dagi qoidabuzarliklar: {n}",
  raise_title: "{quarter}: maosh oshirilishi",
  badge_prelim: "taxminiy",
  badge_approved: "Tasdiqlandi: +{sum}\u00a0soʻm",
  badge_no_raise: "Oshirishsiz",
  h_none: "Bu chorakda hali baho yoʻq.",
  h_impossible: "Bu chorakda oshirish boʻlmaydi: {k} oy baholangan, kerak esa kamida {min} oy.",
  h_few_1: "3 oydan {k} tasi baholangan, oshirish esa kamida {min} oy boʻyicha hisoblanadi.",
  h_few_n: "3 oydan {k} tasi baholangan, oshirish esa kamida {min} oy boʻyicha hisoblanadi.",
  h_hold: "{months} darajasini saqlang — {sum}\u00a0soʻm chiqadi.",
  h_hold_zero: "Bu darajada oshirish boʻlmaydi.",
  h_now: "Hozir {sum}\u00a0soʻm chiqmoqda.",
  h_now_zero: "Hozircha oshirishsiz.",
  h_keep: "{months} boʻyicha kamida {pct}\u00a0% boʻlsa, saqlanadi.",
  h_next: "{sum}\u00a0soʻm uchun {months} boʻyicha oʻrtacha {pct}\u00a0% kerak.",
  h_next_no: "Bu chorakda {sum}\u00a0soʻm endi chiqmaydi.",
  h_wait: "HR qarorini kutyapmiz. Taxminan: {sum}\u00a0soʻm.",
  h_wait_zero: "HR qarorini kutyapmiz. Taxminan: oshirishsiz.",
  m_pending: "baholanmagan",
  m_upcoming: "{ddmm} dan",
  m_not_rated: "baholanmadi",
  link_viol: "{month}dagi qoidabuzarliklar",
  link_history: "Tarix",
  hist_running: "davom etmoqda",
  hist_waiting: "HR qarori kutilmoqda",
  hist_approved: "Tasdiqlandi +{sum}\u00a0soʻm",
  hist_no_raise: "Oshirishsiz",
  hist_pending: "hali baholanmagan",
  hist_avg: "Oʻrtacha",
  hist_empty: "Hozircha tarix yoʻq",
  hist_upcoming: "{date}dan",
  grp_base: "Asosiy bandlar",
  grp_extra: "Qoʻshimcha bandlar",
  src_attendance: "Workly maʼlumotlari boʻyicha",
  src_branch: "filial bali boʻyicha",
  no_data: "maʼlumot yoʻq",
  no_data_hint: "Band natijaga kirmadi: oy uchun maʼlumot yoʻq.",
  changes_title: "Oʻzgarishlar",
  change_reason: "Sabab: {text}",
  comment: "Izoh: {text}",
  btn_dispute: "Eʼtiroz bildirish",
  sheet_review: "{month} bahosiga eʼtiroz",
  sheet_violation: "Qoidabuzarlikka eʼtiroz",
  sheet_hint: "Nimaga rozi emasligingizni yozing. Javob botga keladi.",
  sheet_placeholder: "Masalan: 18-oktabr kuni dam olish kunim edi…",
  sheet_min: "Kamida {min} ta harf yoki raqam",
  sheet_send: "Eʼtirozni yuborish",
  err_comment_required: "Juda qisqa: kamida {min} ta harf yoki raqam kerak.",
  err_dispute_window_closed: "Eʼtiroz muddati oʻtdi.",
  err_dispute_exists: "Eʼtiroz allaqachon ochilgan.",
  err_period_closed: "Oy yopilgan.",
  err_already_cancelled: "Qoidabuzarlik allaqachon bekor qilingan.",
  err_not_found: "Yozuv topilmadi.",
  err_generic: "Xatolik. Yana urinib koʻring.",
  viol_title: "Qoidabuzarliklar · {month}",
  viol_no_item: "Kartadan tashqari",
  viol_active: "kuchda",
  viol_cancelled: "bekor qilingan",
  viol_dispute: "eʼtiroz ochilgan",
  viol_note: "Qoidabuzarlik balni oʻzi pasaytirmaydi. Uni baholovchi baho qoʻyishda hisobga oladi.",
  viol_empty: "Qoidabuzarlik yoʻq",
  photo_failed: "Rasm yuklanmadi",
  eval_pending: "{date} gacha {n} ta xodimni baholash kerak",
  eval_done: "Barcha xodimlaringiz baholangan",
  eval_link: "Admin panelda ochish",
  no_card: "Lavozimingiz uchun KPI hali sozlanmagan",
  offline_stamp: "{time} da yangilangan — aloqa yoʻq",
  slow: "Aloqa yomon, yana urinib koʻryapmiz",
  btn_retry: "Qayta urinish",
};

export const DICT: Record<Lang, Record<Key, string>> = { ru: RU, uz: UZ };

/** Экраны отказа двуязычные: язык до ответа сервера неизвестен. */
export const STATUS_TEXT: Record<FailStatus, { ru: string; uz: string }> = {
  sdk_failed: { ru: "Не загрузился Telegram. Обновите или откройте позже", uz: "Telegram yuklanmadi. Yangilang yoki keyinroq oching" },
  outside: { ru: "Откройте приложение из бота", uz: "Ilovani botdan oching" },
  not_bound: { ru: "Попросите у HR ссылку-приглашение в бот", uz: "HR dan botga taklif havolasini soʻrang" },
  inactive: { ru: "Доступ закрыт", uz: "Kirish yopilgan" },
  not_configured: { ru: "Приложение ещё не настроено на сервере", uz: "Ilova serverda hali sozlanmagan" },
  expired: { ru: "Сессия устарела. Закройте приложение и откройте его из бота снова", uz: "Sessiya eskirdi. Ilovani yoping va botdan qayta oching" },
  offline: { ru: "Нет связи. Проверьте интернет и попробуйте снова", uz: "Aloqa yoʻq. Internetni tekshiring va qayta urinib koʻring" },
  unknown: { ru: "Что-то пошло не так. Попробуйте позже", uz: "Nimadir xato ketdi. Keyinroq urinib koʻring" },
};

// Язык приходит с сервера и живёт только в памяти.
let current: Lang = "ru";
export function setLang(l: Lang): void {
  current = l;
}
export function lang(): Lang {
  return current;
}

/**
 * Текст на заданном языке (hintLines знает язык явно). Заглавная буква — только
 * если шаблон начинается с «{»: «{month}dagi…» → «Noyabrdagi…», а
 * «предварительно» и «идёт» остаются строчными.
 */
export function tIn(l: Lang, key: Key, vars?: Record<string, string | number>): string {
  const tpl = DICT[l][key];
  const out = vars ? tpl.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m)) : tpl;
  return tpl.startsWith("{") ? capFirst(out) : out;
}
export function t(key: Key, vars?: Record<string, string | number>): string {
  return tIn(current, key, vars);
}

const MONTHS_RU = {
  nom: ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"],
  gen: ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"],
  prep: ["январе", "феврале", "марте", "апреле", "мае", "июне", "июле", "августе", "сентябре", "октябре", "ноябре", "декабре"],
};
const MONTHS_UZ = ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr"];

/** Номер месяца 0..11 из «YYYY-MM-DD…». */
function monthIndex(period: string): number {
  return Number(period.slice(5, 7)) - 1;
}

/** Название месяца строчными: у узбекского падежей нет, форма игнорируется. */
export function monthName(period: string, form: "nom" | "gen" | "prep", l: Lang): string {
  const i = monthIndex(period);
  return (l === "ru" ? MONTHS_RU[form][i] : MONTHS_UZ[i]) ?? "";
}

/** «ноябрь и декабрь» / «noyabr va dekabr». */
export function monthsList(periods: string[], form: "nom" | "gen" | "prep", l: Lang): string {
  return periods.map((p) => monthName(p, form, l)).join(l === "ru" ? " и " : " va ");
}

const ROMAN = ["I", "II", "III", "IV"];

/** «IV квартал» / «IV chorak»; с годом «IV квартал 2026» / «2026-yil IV chorak». */
export function quarterTitle(q: string, l: Lang, withYear = false): string {
  const roman = ROMAN[Math.floor(monthIndex(q) / 3)] ?? "";
  const year = q.slice(0, 4);
  if (l === "ru") return `${roman} квартал${withYear ? ` ${year}` : ""}`;
  return `${withYear ? `${year}-yil ` : ""}${roman} chorak`;
}

/** Русское склонение: forms = [1, 2–4, 5+]. */
export function ruPlural(n: number, forms: [string, string, string]): string {
  const a = Math.abs(n);
  const m10 = a % 10;
  const m100 = a % 100;
  if (m10 === 1 && m100 !== 11) return forms[0];
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return forms[1];
  return forms[2];
}
