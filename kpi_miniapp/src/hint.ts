// Строки подсказки о прибавке и плашка на карточке (без DOM).
import type { TgNextTier, TgRaiseHint } from "@backend/modules/kpi/tg-app/types";
import { pct1, sum } from "./format";
import { type Lang, monthsList, tIn } from "./i18n";

/**
 * Исчерпывающий перебор проверяет tsc: не хватает варианта TgRaiseHint — сюда придёт не never.
 * Во время работы сюда попадает только вид от сервера новее клиента (кэш WebView держит старый
 * бандл): карточка прибавки тогда не падает, а рисуется без строк подсказки и «предварительно».
 */
function unknownHint(_x: never): void {
  // ничего: решает вызывающий
}

/** Строка про следующую ступень; null — ступени нет. */
function nextLines(next: TgNextTier | null, l: Lang): string[] {
  if (!next) return [];
  if (!next.reachable) return [tIn(l, "h_next_no", { sum: sum(next.amount) })];
  return [tIn(l, "h_next", { sum: sum(next.amount), pct: pct1(next.need_pct), months: monthsList(next.periods, "nom", l) })];
}

export function hintLines(h: TgRaiseHint, l: Lang): string[] {
  switch (h.kind) {
    case "decided":
      return [];
    case "none":
      return [tIn(l, "h_none")];
    case "impossible":
      // Без суммы, без «для X» и без «сохранится»: прибавки в квартале уже не будет.
      return [tIn(l, "h_impossible", { k: h.scored, min: h.min_months })];
    case "waiting_hr":
      return [h.amount > 0 ? tIn(l, "h_wait", { sum: sum(h.amount) }) : tIn(l, "h_wait_zero")];
    case "too_few":
      return [
        tIn(l, h.scored === 1 ? "h_few_1" : "h_few_n", { k: h.scored, min: h.min_months }),
        h.amount > 0
          ? tIn(l, "h_hold", { months: monthsList(h.keep_periods, "gen", l), sum: sum(h.amount) })
          : tIn(l, "h_hold_zero"),
        ...nextLines(h.next, l),
      ];
    case "running":
      return [
        h.amount > 0 ? tIn(l, "h_now", { sum: sum(h.amount) }) : tIn(l, "h_now_zero"),
        ...(h.keep ? [tIn(l, "h_keep", { months: monthsList(h.keep.periods, "prep", l), pct: pct1(h.keep.need_pct) })] : []),
        ...nextLines(h.next, l),
      ];
    default:
      unknownHint(h);
      return [];
  }
}

export function raiseBadge(h: TgRaiseHint, l: Lang): { text: string; tone: "prelim" | "ok" | "muted" } {
  switch (h.kind) {
    case "decided":
      return h.amount > 0
        ? { text: tIn(l, "hist_approved", { sum: sum(h.amount) }), tone: "ok" }
        : { text: tIn(l, "badge_no_raise"), tone: "muted" };
    case "impossible":
      // Суммы нет, «предварительно» было бы неправдой.
      return { text: tIn(l, "badge_no_raise"), tone: "muted" };
    case "none":
    case "waiting_hr":
    case "too_few":
    case "running":
      return { text: tIn(l, "badge_prelim"), tone: "prelim" };
    default:
      unknownHint(h);
      return { text: tIn(l, "badge_prelim"), tone: "prelim" };
  }
}
