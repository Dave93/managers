// «Кому выдать выходной»: поиск по имени, фильтр по филиалу, строка ведёт в форму выдачи (ev_dayoff).
// Фильтры меняют список без запроса. Строки с сервера (имена, филиалы) попадают в DOM только текстом через h().
import type { EvDayOffEmployees } from "@backend/modules/kpi/tg-app/ev-types";
import { lang, t } from "../i18n";
import { chevron, h } from "../ui";
import { type DayOffPickFilter, dayOffPickView } from "../view/ev-dayoff-pick";
import { fill, inAppLink } from "./ev-common";

// Выбор живёт в памяти до закрытия приложения: возврат с формы не сбрасывает поиск.
let filter: DayOffPickFilter = { terminal_id: null, search: "" };

export function renderEvDayOffPick(d: EvDayOffEmployees): HTMLElement {
  // Сохранённый филиал мог пропасть из назначений.
  if (filter.terminal_id && !d.terminals.some((x) => x.id === filter.terminal_id)) filter = { ...filter, terminal_id: null };
  const first = dayOffPickView(d, filter, lang());
  const list = h("div", { class: "ev-list" });
  const counter = h("p", { class: "ev-counter", "aria-live": "polite" });

  const refresh = (): void => {
    const vm = dayOffPickView(d, filter, lang());
    counter.textContent = vm.counter;
    fill(list, [
      vm.empty
        ? h("p", { class: "card ev-empty", role: "status" }, t(vm.empty))
        : h("section", { class: "card rows" }, ...vm.rows.map((r) =>
            inAppLink(r.hash, "row",
              h("span", { class: "row-body" },
                h("span", { class: "row-text" }, h("span", { class: "ev-name" }, r.name), r.sub ? h("span", { class: "ev-sub" }, r.sub) : null),
                chevron())))),
    ]);
  };

  const branch = h("select", { class: "ev-field", "aria-label": t("ev_f_branch"), onchange: (e: Event) => { filter = { ...filter, terminal_id: (e.target as HTMLSelectElement).value || null }; refresh(); } },
    ...first.branches.map((o) => h("option", { value: o.id ?? "" }, o.label))) as HTMLSelectElement;
  branch.value = filter.terminal_id ?? "";
  const search = h("input", { class: "ev-field", type: "search", "aria-label": t("ev_search_ph"), placeholder: t("ev_search_ph"), autocomplete: "off", oninput: (e: Event) => { filter = { ...filter, search: (e.target as HTMLInputElement).value }; refresh(); } }) as HTMLInputElement;
  search.value = filter.search;

  const view = h("main", { class: "screen" },
    h("h1", { class: "title" }, first.title),
    h("section", { class: "card ev-filters" }, first.showBranch ? branch : null, search, counter),
    list);
  refresh();
  return view;
}
