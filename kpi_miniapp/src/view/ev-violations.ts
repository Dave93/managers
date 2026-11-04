// «Мои нарушения» оценщика как данные (без DOM): строки, статусы, право отмены.
import type { EvViolations } from "@backend/modules/kpi/tg-app/ev-types";
import { dayMonth, hhmm } from "../format";
import type { Lang } from "../i18n";
import { monthName, tIn } from "../i18n";

export interface EvViolationVM {
  id: string; who: string; item: string; when: string; comment: string;
  status: { text: string; tone: "active" | "muted" | "warn" }; cancelReason: string | null;
  photoIds: string[]; canCancel: boolean; line: string | null;
}

export function evViolationsView(d: EvViolations, l: Lang): { title: string; items: EvViolationVM[]; empty: boolean } {
  const items = d.items.map((v): EvViolationVM => {
    const cancelled = v.status === "cancelled";
    const status: EvViolationVM["status"] = cancelled
      ? { text: tIn(l, "viol_cancelled"), tone: "muted" }
      : v.open_dispute
        ? { text: tIn(l, "viol_dispute"), tone: "warn" }
        : { text: tIn(l, "viol_active"), tone: "active" };
    // Почему отменить нельзя: спор важнее закрытого месяца.
    const line = cancelled || v.can_cancel ? null : v.open_dispute ? tIn(l, "ev_viol_open_dispute") : d.period_status === "closed" ? tIn(l, "ev_viol_closed") : null;
    return {
      id: v.id,
      who: [v.employee_name, v.terminal_name].filter((x): x is string => !!x).join(" · "),
      item: v.item_title_ru ?? tIn(l, "ev_viol_item_none"),
      when: `${dayMonth(v.occurred_at, l)}, ${hhmm(Date.parse(v.occurred_at))}`,
      comment: v.comment,
      status,
      cancelReason: cancelled ? v.cancel_reason : null,
      photoIds: v.photo_ids,
      canCancel: v.can_cancel,
      line,
    };
  });
  return { title: tIn(l, "ev_myviol_title", { month: monthName(d.period, "nom", l) }), items, empty: items.length === 0 };
}
