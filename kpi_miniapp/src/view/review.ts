// «Вся оценка» как данные (без DOM): что рисуют screens/review.ts и шторка спора.
// Порядок блоков — макет screens.html, экран 1: заголовок «месяц · балл», основные и
// дополнительные пункты, внизу изменения после отправки и спор.
//
// disputeErrorText живёт здесь, а не в sheet.ts: тест не может импортировать модуль с DOM.
import type { TgDisputeInfo, TgItemSource, TgReview, TgReviewItem, TgTier } from "@backend/modules/kpi/tg-app/types";
import { dayMonth, pct1 } from "../format";
import { type Key, type Lang, monthName, t, tIn } from "../i18n";
import { capFirst } from "../util";

const NBSP = " ";
const DASH = "—";

export interface ReviewItemVM {
  title: string;
  score: string; // целое («75») или «—»
  bar: number | null; // доля 0..1; без балла — null
  source: string | null; // «по данным Workly» / «по баллу филиала»; ручной пункт — null
  note: string | null; // заметка оценщика как есть
  noData: boolean; // балла нет: под пунктом пояснение no_data_hint
}

export interface ReviewVM {
  title: string; // «Октябрь · 90,3 %»
  groups: { title: string; items: ReviewItemVM[] }[];
  changes: { line: string; reason: string | null }[]; // «12 октября: 85,0 % → 90,3 %»
  resolved: { title: string; comment: string | null } | null;
  dispute: { can: true; label: string } | { can: false; line: string };
}

// Автопункты: посещаемость — из Workly, скорость, план продаж и фудкост — балл филиала.
const SOURCE_KEY: Record<TgItemSource, Key | null> = {
  manual: null,
  attendance: "src_attendance",
  cooking_speed: "src_branch",
  sales_plan: "src_branch",
  food_cost: "src_branch",
};

/**
 * Пороги ступеней для защиты процента (решение 6): 89,96 при ступени 90 — «89,9», как на главном.
 * Ответ без tiers (backend до этой правки, копия из кэша) — обычное округление.
 */
export function tierMins(tiers: TgTier[] | undefined): number[] {
  return Array.isArray(tiers) ? tiers.map((t) => t.min_pct) : [];
}

/** Процент изменения: «85,0 %», пустой — «—» без знака (pct1 с null не зовётся). */
const pctOrDash = (n: number | null, mins: number[]): string => (n === null ? DASH : `${pct1(n, mins)}${NBSP}%`);

function itemView(i: TgReviewItem, l: Lang): ReviewItemVM {
  const key = SOURCE_KEY[i.source];
  const note = i.note !== null && i.note.trim() !== "" ? i.note : null;
  // Узбекского названия нет — русское, как на главном.
  const title = l === "ru" ? i.title_ru : i.title_uz || i.title_ru;
  if (i.score === null) return { title, score: DASH, bar: null, source: key ? tIn(l, key) : null, note, noData: true };
  return {
    title,
    // Баллы пунктов — целые (решение 6).
    score: String(Math.round(i.score)),
    bar: Math.min(1, Math.max(0, i.score / 100)),
    source: key ? tIn(l, key) : null,
    note,
    noData: false,
  };
}

/** Строка про спор вместо кнопки. Отменённой оценка не бывает: такой строки нет. */
function disputeLine(d: TgDisputeInfo, l: Lang): string {
  switch (d.state) {
    case "open":
      // Сервер даёт дату всегда, когда спор открыт; без неё — просто статус.
      return d.opened_at ? tIn(l, "dsp_open", { date: dayMonth(d.opened_at, l) }) : tIn(l, "st_dispute_open");
    case "window_closed":
      return tIn(l, "dsp_window_closed");
    case "period_closed":
      return tIn(l, "dsp_period_closed");
    case "can":
    case "cancelled":
      return "";
  }
}

export function reviewView(r: TgReview, l: Lang): ReviewVM {
  const month = capFirst(monthName(r.period, "nom", l));
  const base = r.items.filter((i) => i.group_key !== "extra").map((i) => itemView(i, l));
  const extra = r.items.filter((i) => i.group_key === "extra").map((i) => itemView(i, l));
  const groups: ReviewVM["groups"] = [];
  if (base.length) groups.push({ title: tIn(l, "grp_base"), items: base });
  if (extra.length) groups.push({ title: tIn(l, "grp_extra"), items: extra });

  const lr = r.dispute.last_resolved;
  // Каждый процент экрана — с защитой порога: заголовок не скажет «90,0», когда главный говорит «89,9».
  const mins = tierMins(r.tiers);
  return {
    // Без балла заголовок — только месяц: «Октябрь · —» ничего не добавляет.
    title: r.score_pct === null ? month : `${month} · ${pct1(r.score_pct, mins)}${NBSP}%`,
    groups,
    changes: r.changes.map((c) => ({
      line: `${dayMonth(c.at, l)}: ${pctOrDash(c.old_score_pct, mins)} → ${pctOrDash(c.new_score_pct, mins)}`,
      reason: c.comment !== null && c.comment.trim() !== "" ? tIn(l, "change_reason", { text: c.comment }) : null,
    })),
    resolved: lr
      ? {
          title: tIn(l, lr.decision === "accepted" ? "dsp_accepted" : "dsp_rejected"),
          comment: lr.comment !== null && lr.comment.trim() !== "" ? tIn(l, "comment", { text: lr.comment }) : null,
        }
      : null,
    dispute: r.dispute.state === "can" ? { can: true, label: tIn(l, "btn_dispute") } : { can: false, line: disputeLine(r.dispute, l) },
  };
}

// Коды POST /disputes, у которых есть свой текст (план 6). Прочее — «Не получилось».
const ERROR_KEY: Record<string, Key> = {
  comment_required: "err_comment_required",
  dispute_window_closed: "err_dispute_window_closed",
  dispute_exists: "err_dispute_exists",
  period_closed: "err_period_closed",
  already_cancelled: "err_already_cancelled",
  not_found: "err_not_found",
};

/** Текст ошибки спора под полем, на языке интерфейса. min — минимум из ответа 422 или reason_min. */
export function disputeErrorText(code: string | null, min: number): string {
  const key = code !== null && Object.prototype.hasOwnProperty.call(ERROR_KEY, code) ? ERROR_KEY[code] : undefined;
  return key ? t(key, { min }) : t("err_generic");
}
