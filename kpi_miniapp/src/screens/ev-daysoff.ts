// «Выданные выходные»: рисует evDaysOffView. Строка — день, кто и причина, статус; у своего неотменённого выходного
// в открытом месяце — тихая «Отменить» (без подтверждения: выходной можно выдать заново). Любой отказ сервера
// перерисовывает список, и человек видит настоящее состояние (уже отменён, месяц закрыт).
// Строки с сервера (имена, причины) попадают в DOM только текстом через h().
import type { EvDaysOff } from "@backend/modules/kpi/tg-app/ev-types";
import { appApi } from "../api";
import { lang, t } from "../i18n";
import { rerender } from "../nav";
import { hashOf } from "../route";
import { haptic } from "../telegram";
import { h } from "../ui";
import { latch } from "../util";
import { type EvDayOffVM, type EvDaysOffNavVM, evDaysOffView } from "../view/ev-daysoff";
import { inAppLink } from "./ev-common";

const CHIP: Record<EvDayOffVM["status"]["tone"], string> = { active: "chip chip-ink", muted: "chip chip-muted" };

// Соседний месяц: ссылка «‹ Сентябрь» / «Ноябрь ›»; имя для чтения с экрана начинается с видимой надписи (WCAG 2.5.3).
function slot(n: EvDaysOffNavVM, side: "prev" | "next"): HTMLElement {
  const a = inAppLink(n.hash, "btn btn-quiet att-slot", side === "prev" ? `‹ ${n.label}` : `${n.label} ›`);
  a.setAttribute("aria-label", `${n.label}, ${n.aria}`);
  return a;
}

export function renderEvDaysOff(d: EvDaysOff): HTMLElement {
  const vm = evDaysOffView(d, lang());
  const busy = latch();
  const cancel = (id: string): void => {
    if (!busy.take()) return;
    void appApi().send("POST", `/ev/days-off/${id}/cancel`, {}).then((res) => {
      haptic(res.kind === "ok" ? "success" : "error");
      busy.release();
      rerender();
    });
  };
  const row = (r: EvDayOffVM): HTMLElement =>
    h("div", { class: r.status.tone === "muted" ? "row is-static is-cancelled" : "row is-static" },
      h("span", { class: "row-body" },
        h("span", { class: "row-text" }, h("span", { class: "ev-name" }, r.day), h("span", { class: "ev-sub" }, [r.who, r.reason].filter(Boolean).join(" · "))),
        h("span", { class: "row-end" }, h("span", { class: CHIP[r.status.tone] }, r.status.text),
          r.canCancel ? h("button", { type: "button", class: "btn btn-quiet dayoff-cancel", onclick: () => cancel(r.id) }, t("ev_daysoff_cancel")) : null)));
  return h("main", { class: "screen" },
    h("h1", { class: "title" }, vm.title),
    inAppLink(hashOf({ name: "ev_dayoff_pick" }), "btn btn-primary", t("ev_dayoff_give")),
    h("div", { class: "att-switch" }, slot(vm.prev, "prev"), h("h2", { class: "att-month" }, vm.month), slot(vm.next, "next")),
    vm.closed ? h("p", { class: "ev-info" }, t("ev_daysoff_closed")) : null,
    vm.empty ? h("p", { class: "card ev-empty", role: "status" }, t("ev_daysoff_empty")) : h("section", { class: "card rows" }, ...vm.items.map(row)));
}
