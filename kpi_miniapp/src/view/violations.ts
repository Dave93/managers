// «Нарушения» как данные (без DOM): что рисует screens/violations.ts. Порядок — макет
// screens.html, экран 2: нарушения месяца новыми сверху (как прислал сервер), внизу
// пояснение, что нарушение само балл не снижает.
//
// У нарушения «Оспорить» — при тех же условиях, что у оценки (спека 4.5); без кнопки —
// строка, почему нельзя. Спор нарушения пишется своими словами (dsp_open_violation), а не
// «оспорили оценку».
import type { TgDisputeInfo, TgViolation, TgViolations } from "@backend/modules/kpi/tg-app/types";
import { dayMonth, hhmm } from "../format";
import { type Lang, monthName, tIn } from "../i18n";

export interface ViolationVM {
  id: string;
  item: string; // пункт карты на языке или «Без пункта карты»
  when: string; // «14 октября, 19:40» по Ташкенту
  comment: string; // комментарий записавшего как есть
  status: { text: string; tone: "active" | "muted" | "warn" };
  cancelReason: string | null; // только у отменённого
  photoIds: string[];
  canDispute: boolean;
  line: string | null; // у каждого нарушения без «Оспорить»; при «можно» — null
}

/** Пустая строка с сервера — то же, что её нет. */
const filled = (s: string | null): s is string => s !== null && s.trim() !== "";

function itemOf(v: TgViolation, l: Lang): string {
  // Узбекского названия нет — русское, как на главном и во «Вся оценка».
  const title = l === "uz" && filled(v.item_title_uz) ? v.item_title_uz : v.item_title_ru;
  return filled(title) ? title : tIn(l, "viol_no_item");
}

function statusOf(v: TgViolation, l: Lang): ViolationVM["status"] {
  if (v.status === "cancelled") return { text: tIn(l, "viol_cancelled"), tone: "muted" };
  if (v.dispute.state === "open") return { text: tIn(l, "viol_dispute"), tone: "warn" };
  return { text: tIn(l, "viol_active"), tone: "active" };
}

/** Строка вместо «Оспорить» (спека 4.5); при «можно» строки нет. */
function lineOf(d: TgDisputeInfo, l: Lang): string | null {
  switch (d.state) {
    case "can":
      return null;
    case "open":
      // Сервер даёт дату всегда, когда спор открыт; без неё — просто статус.
      return d.opened_at ? tIn(l, "dsp_open_violation", { date: dayMonth(d.opened_at, l) }) : tIn(l, "st_dispute_open");
    case "cancelled":
      return tIn(l, "dsp_cancelled");
    case "window_closed":
      return tIn(l, "dsp_window_closed");
    case "period_closed":
      return tIn(l, "dsp_period_closed");
  }
}

function itemView(v: TgViolation, l: Lang): ViolationVM {
  return {
    id: v.id,
    item: itemOf(v, l),
    when: `${dayMonth(v.occurred_at, l)}, ${hhmm(Date.parse(v.occurred_at))}`,
    comment: v.comment,
    status: statusOf(v, l),
    cancelReason: v.status === "cancelled" && filled(v.cancel_reason) ? v.cancel_reason : null,
    photoIds: v.photo_ids.slice(),
    canDispute: v.dispute.state === "can",
    line: lineOf(v.dispute, l),
  };
}

export function violationsView(v: TgViolations, l: Lang): { title: string; items: ViolationVM[]; note: string; empty: boolean } {
  return {
    title: tIn(l, "viol_title", { month: monthName(v.period, "nom", l) }),
    items: v.items.map((x) => itemView(x, l)),
    // Пояснение внизу всегда, и у пустого месяца тоже.
    note: tIn(l, "viol_note"),
    empty: v.items.length === 0,
  };
}
