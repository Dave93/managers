// Время приготовления для оценщика: рисует EvCookingVM (view/ev-cooking.ts). Смена переключается ссылкой на тот же
// экран с другой сменой (запрос заново, стек «назад» не растёт). Строки с сервера (названия блюд) — только текстом через h().
import type { EvCooking } from "@backend/modules/kpi/tg-app/ev-types";
import { lang, t } from "../i18n";
import { navigate } from "../nav";
import { parseHash } from "../route";
import { h } from "../ui";
import { COOKING_DISH_LIMIT, type CookingShiftVM, evCookingView } from "../view/ev-cooking";
import { fill } from "./ev-common";

function shiftSwitch(items: CookingShiftVM[]): HTMLElement {
  return h(
    "div",
    { class: "evc-tabs", role: "group", "aria-label": t("ev_cook_shift_label") },
    ...items.map((s) =>
      h("button", { type: "button", class: "evc-tab", "aria-pressed": String(s.selected), onclick: () => { if (!s.selected) navigate(parseHash(s.hash)); } }, s.label),
    ),
  );
}

function dishesCard(items: ReturnType<typeof evCookingView>["dishes"]): HTMLElement {
  let all = false;
  const list = h("div", {});
  const more = h("button", { type: "button", class: "btn btn-quiet evc-more" }) as HTMLButtonElement;
  const draw = (): void => {
    fill(
      list,
      (all ? items : items.slice(0, COOKING_DISH_LIMIT)).map((d) =>
        h(
          "div",
          { class: "row is-static" },
          h(
            "span",
            { class: "row-body" },
            h("span", { class: "row-text" }, d.name, h("span", { class: "evc-times" }, `${d.qty} · ${d.over}`), d.slow ? h("span", { class: "chip chip-warn evc-cook-slow" }, d.slow) : null),
            h("span", { class: "row-end evc-week-end" }, h("span", { class: "evc-week-avg" }, d.avg)),
          ),
        ),
      ),
    );
    more.textContent = all ? t("ev_cook_dish_less") : t("ev_cook_dish_all", { n: items.length });
  };
  more.onclick = () => {
    all = !all;
    draw();
  };
  draw();
  return h("section", { class: "card rows" }, h("h2", { class: "evc-h" }, t("ev_cook_dishes")), list, items.length > COOKING_DISH_LIMIT ? more : null);
}

export function renderEvCooking(d: EvCooking): HTMLElement {
  const vm = evCookingView(d, lang());
  const bar = (n: number): HTMLElement => {
    const inner = h("span", {});
    inner.style.width = `${n}%`;
    return h("span", { class: "evc-bar", "aria-hidden": "true" }, inner);
  };
  return h(
    "main",
    { class: "screen evc" },
    h("h1", { class: "title" }, vm.title),
    h("p", { class: "ev-info" }, vm.sub),
    vm.shifts ? shiftSwitch(vm.shifts) : null,
    vm.empty
      ? h("p", { class: "card hist-empty evc-panel", role: "status" }, vm.empty)
      : h(
          "div",
          { class: "evc-stack evc-panel" },
          h("section", { class: "card" }, h("dl", { class: "evc-sum" }, ...vm.figures.map((f) => h("div", { class: "evc-sum-item" }, h("dd", { class: "evc-sum-val evc-sum-money" }, f.value), h("dt", { class: "evc-sum-label" }, f.label)))), h("p", { class: "evc-none-line" }, vm.norms)),
          h(
            "section",
            { class: "card rows" },
            h("h2", { class: "evc-h" }, t("ev_cook_days")),
            h(
              "div",
              {},
              ...vm.days.map((x) =>
                h(
                  "div",
                  { class: "row is-static" },
                  h("span", { class: "row-body" }, h("span", { class: "row-text" }, x.label, h("span", { class: "evc-times" }, x.orders), bar(x.bar)), h("span", { class: "row-end evc-week-end evc-cook-end" }, h("span", { class: "evc-week-avg" }, x.avg), h("span", { class: "evc-week-delta" }, x.onTime))),
                ),
              ),
            ),
          ),
          vm.dishes.length > 0 ? dishesCard(vm.dishes) : null,
          vm.dishesEmpty ? h("p", { class: "card hist-empty", role: "status" }, vm.dishesEmpty) : null,
          h("p", { class: "ev-info" }, vm.note),
        ),
  );
}
