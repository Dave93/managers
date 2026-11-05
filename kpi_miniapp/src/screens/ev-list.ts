// Экран «Мои сотрудники»: рисует EvListVM (view/ev-list.ts). Фильтры меняют список без запроса;
// выбор живёт в памяти до закрытия приложения, чтобы возврат с формы оценки не сбрасывал его.
// Строки с сервера (имена, филиалы) попадают в DOM только текстом через h().
import type { EvEmployees } from "@backend/modules/kpi/tg-app/ev-types";
import { lang, t } from "../i18n";
import { hashOf } from "../route";
import { chevron, h } from "../ui";
import { type EvFilter, evListView } from "../view/ev-list";
import { fill, inAppLink, linkRow } from "./ev-common";

let filter: EvFilter = { terminal_id: null, card_id: null, status: "all", search: "" };

function select(label: string, options: { id: string | null; label: string }[], value: string | null, onPick: (v: string | null) => void): HTMLElement {
  const sel = h("select", { class: "ev-field", "aria-label": label, onchange: (e: Event) => onPick((e.target as HTMLSelectElement).value || null) }, ...options.map((o) => h("option", { value: o.id ?? "" }, o.label)));
  (sel as HTMLSelectElement).value = value ?? "";
  return sel;
}

export function renderEvList(d: EvEmployees, nowMs: number): HTMLElement {
  // Сохранённый выбор мог устареть: филиал или карту убрали из назначений.
  if (filter.terminal_id && !d.terminals.some((x) => x.id === filter.terminal_id)) filter = { ...filter, terminal_id: null };
  if (filter.card_id && !d.cards.some((x) => x.id === filter.card_id)) filter = { ...filter, card_id: null };

  const first = evListView(d, filter, lang(), nowMs);
  const chips = h("div", { class: "ev-chips", role: "group", "aria-label": t("ev_f_branch") });
  const list = h("div", { class: "ev-list" });
  const counter = h("p", { class: "ev-counter", "aria-live": "polite" });

  const refresh = (): void => {
    const vm = evListView(d, filter, lang(), nowMs);
    fill(
      chips,
      vm.statuses.map((s) =>
        h("button", { type: "button", class: "ev-st", "aria-pressed": String(filter.status === s.value), onclick: () => { filter = { ...filter, status: s.value }; refresh(); } }, `${s.label} ${s.count}`),
      ),
    );
    counter.textContent = vm.counter;
    fill(list, [
      vm.empty
        ? h("p", { class: "card ev-empty", role: "status" }, t(vm.empty))
        : h("section", { class: "card rows" }, ...vm.rows.map((r) =>
            inAppLink(
              r.hash,
              "row",
              h("span", { class: "row-body" },
                h("span", { class: "row-text" }, h("span", { class: "ev-name" }, r.name), r.sub ? h("span", { class: "ev-sub" }, r.sub) : null, r.late ? h("span", { class: "ev-late" }, r.late) : null),
                h("span", { class: "ev-end" }, h("span", { class: `chip chip-${r.chip.tone}` }, r.chip.text), r.score ? h("span", { class: "ev-score" }, r.score) : null),
                chevron()),
            ),
          )),
    ]);
  };

  const search = h("input", { class: "ev-field", type: "search", "aria-label": t("ev_search_ph"), placeholder: t("ev_search_ph"), autocomplete: "off", oninput: (e: Event) => { filter = { ...filter, search: (e.target as HTMLInputElement).value }; refresh(); } });
  (search as HTMLInputElement).value = filter.search;

  const view = h(
    "main",
    { class: "screen" },
    h("h1", { class: "title" }, first.title),
    h("p", { class: "ev-info" }, first.info),
    h(
      "section",
      { class: "card ev-filters" },
      first.showBranch ? select(t("ev_f_branch"), first.branches, filter.terminal_id, (v) => { filter = { ...filter, terminal_id: v }; refresh(); }) : null,
      first.showCard ? select(t("ev_f_card"), first.cards, filter.card_id, (v) => { filter = { ...filter, card_id: v }; refresh(); }) : null,
      search,
      chips,
      counter,
    ),
    list,
    h("section", { class: "card rows" }, linkRow(t("ev_my_violations"), null, hashOf({ name: "ev_violations", period: null })), linkRow(t("ev_my_daysoff"), null, hashOf({ name: "ev_daysoff", period: null }))),
  );
  refresh();
  return view;
}
