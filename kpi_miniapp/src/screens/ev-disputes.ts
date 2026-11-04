// Список споров оценщика: рисует evDisputesView. Строка ведёт на карточку спора.
// Строки с сервера (имя, причина) попадают в DOM только текстом через h().
import type { EvDisputes } from "@backend/modules/kpi/tg-app/ev-types";
import { lang, t } from "../i18n";
import { chevron, h, noWidow } from "../ui";
import { evDisputesView } from "../view/ev-disputes";
import { inAppLink } from "./ev-common";

export function renderEvDisputes(d: EvDisputes): HTMLElement {
  const vm = evDisputesView(d, lang());
  return h("main", { class: "screen" }, h("h1", { class: "title" }, t("ev_dsp_title")),
    vm.empty ? h("p", { class: "card ev-empty", role: "status" }, t("ev_dsp_empty"))
      : h("section", { class: "card rows" }, ...vm.rows.map((r) => inAppLink(r.hash, "row",
          h("span", { class: "row-body" },
            h("span", { class: "row-text" }, h("span", { class: "ev-name" }, r.kind), r.who ? h("span", { class: "ev-sub" }, r.who) : null, h("span", { class: "ev-sub" }, noWidow(r.reason))),
            h("span", { class: "ev-end" }, h("span", { class: `chip chip-${r.chip.tone}` }, r.chip.text), h("span", { class: "ev-score" }, r.when)),
            chevron())))));
}
