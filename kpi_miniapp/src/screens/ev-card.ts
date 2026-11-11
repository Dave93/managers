// Карточка сотрудника оценщика: рисует EvCardVM (view/ev-card.ts). Всё приходит одним ответом, поэтому
// переключение разделов не ходит в сеть; выбранный раздел живёт в памяти, пока оценщик смотрит того же
// сотрудника (смена месяца его не сбрасывает). Строки с сервера (имена, комментарии) — только текстом через h().
import type { EvCard } from "@backend/modules/kpi/tg-app/ev-types";
import { lang, t } from "../i18n";
import { navigate } from "../nav";
import { parseHash } from "../route";
import { h } from "../ui";
import { type CalCellVM, type CardTab, type EvCardVM, type SwitchVM, evCardView } from "../view/ev-card";
import { fill } from "./ev-common";

let shown: { employee: string; tab: CardTab } = { employee: "", tab: "attendance" };

const CHIP = { bad: "chip chip-warn", warn: "chip chip-wait", info: "chip chip-muted" } as const;

function slot(n: SwitchVM | null, side: "prev" | "next"): HTMLElement {
  if (n === null) return h("span", { class: "att-slot", "aria-hidden": "true" });
  // Имя для чтения с экрана начинается с видимой надписи (WCAG 2.5.3): «Октябрь, Более ранний месяц с данными».
  return h(
    "a",
    {
      class: "btn btn-quiet att-slot",
      href: n.hash,
      "aria-label": `${n.label}, ${n.aria}`,
      onclick: (e: Event) => {
        e.preventDefault();
        navigate(parseHash(n.hash));
      },
    },
    side === "prev" ? `‹ ${n.label}` : `${n.label} ›`,
  );
}

function cell(c: CalCellVM): HTMLElement {
  return h("div", { class: `evc-day evc-${c.state}`, role: "img", "aria-label": c.aria }, h("span", { class: "evc-n" }, String(c.day)), c.badge ? h("span", { class: "evc-badge" }, c.badge) : null);
}

function attendance(vm: EvCardVM["att"]): HTMLElement {
  if (vm.empty) return h("p", { class: "card hist-empty", role: "status" }, vm.empty);
  return h(
    "div",
    { class: "evc-stack" },
    h(
      "section",
      { class: "card" },
      h("dl", { class: "evc-sum" }, ...vm.summary.map((s) => h("div", { class: "evc-sum-item" }, h("dd", { class: "evc-sum-val" }, String(s.value)), h("dt", { class: "evc-sum-label" }, h("span", { class: `evc-dot evc-${s.state}`, "aria-hidden": "true" }), s.label)))),
      vm.streak ? h("p", { class: "evc-streak", role: "status" }, vm.streak) : null,
      h("div", { class: "evc-wd", "aria-hidden": "true" }, ...vm.weekdays.map((w) => h("span", {}, w))),
      h("div", { class: "evc-cal" }, ...Array.from({ length: vm.lead }, () => h("div", { "aria-hidden": "true" })), ...vm.cells.map(cell)),
    ),
    h(
      "section",
      { class: "card rows" },
      h("h2", { class: "evc-h" }, t("ev_card_dev")),
      vm.deviations.length === 0
        ? h("p", { class: "evc-none" }, t("ev_card_dev_none"))
        : h(
            "div",
            {},
            ...vm.deviations.map((d) =>
              h(
                "div",
                { class: "row is-static" },
                h("span", { class: "row-body" }, h("span", { class: "row-text" }, `${d.day} · ${d.weekday}`, d.times ? h("span", { class: "evc-times" }, d.times) : null), h("span", { class: "row-end" }, h("span", { class: CHIP[d.tone] }, d.text))),
              ),
            ),
          ),
    ),
    h("p", { class: "ev-info" }, t("ev_card_note")),
  );
}

// Столбики среднего чека по дням: высота от лучшего дня. Подпись целиком у контейнера, отдельные столбики для чтения не нужны.
function dailyChart(d: NonNullable<NonNullable<EvCardVM["sales"]>["daily"]>): HTMLElement {
  return h(
    "section",
    { class: "card" },
    h("h2", { class: "evc-h evc-h-flush" }, t("ev_card_sales_days")),
    h(
      "div",
      { class: "evc-spark", role: "img", "aria-label": d.aria },
      ...d.bars.map((b) => {
        const bar = h("span", { class: "evc-spark-bar" });
        bar.style.height = `${b.h}%`;
        return bar;
      }),
    ),
    h("div", { class: "evc-spark-axis", "aria-hidden": "true" }, h("span", {}, d.from), h("span", {}, d.to)),
  );
}

function sales(vm: NonNullable<EvCardVM["sales"]>): HTMLElement {
  const bar = (n: number): HTMLElement => {
    const fill = h("span", {});
    fill.style.width = `${n}%`;
    return h("span", { class: "evc-bar", "aria-hidden": "true" }, fill);
  };
  return h(
    "div",
    { class: "evc-stack" },
    h(
      "section",
      { class: "card" },
      h("dl", { class: "evc-sum" }, ...vm.figures.map((f) => h("div", { class: "evc-sum-item" }, h("dd", { class: "evc-sum-val evc-sum-money" }, f.value), h("dt", { class: "evc-sum-label" }, f.label)))),
      vm.delta ? h("p", { class: `evc-delta${vm.delta.tone ? ` evc-${vm.delta.tone}` : ""}`, role: "status" }, vm.delta.text) : null,
      vm.empty ? h("p", { class: "evc-none-line", role: "status" }, vm.empty) : null,
    ),
    vm.daily ? dailyChart(vm.daily) : null,
    vm.weeks.length === 0
      ? null
      : h(
          "section",
          { class: "card rows" },
          h("h2", { class: "evc-h" }, t("ev_card_sales_weeks")),
          h(
            "div",
            {},
            ...vm.weeks.map((w) =>
              h(
                "div",
                { class: "row is-static" },
                h(
                  "span",
                  { class: "row-body" },
                  h("span", { class: "row-text" }, w.label, h("span", { class: "evc-times" }, w.checks), bar(w.bar)),
                  h("span", { class: "row-end evc-week-end" }, h("span", { class: "evc-week-avg" }, w.avg), w.delta ? h("span", { class: `evc-week-delta evc-${w.tone}` }, w.delta) : null),
                ),
              ),
            ),
          ),
        ),
    vm.cashier ? h("p", { class: "ev-info" }, vm.cashier) : null,
    h("p", { class: "ev-info" }, vm.note),
  );
}

function review(vm: EvCardVM["review"]): HTMLElement {
  if (vm.empty) return h("p", { class: "card hist-empty", role: "status" }, vm.empty);
  return h(
    "div",
    { class: "evc-stack" },
    h("section", { class: "card evc-score-card" }, h("span", { class: "evc-score" }, vm.score ?? ""), vm.status ? h("span", { class: "chip chip-muted" }, vm.status) : null),
    h(
      "ul",
      { class: "card ev-ro-list" },
      ...vm.items.map((i) => h("li", { class: "ev-ro" }, h("span", { class: "ev-ro-name" }, i.title), h("span", { class: "ev-ro-score" }, i.score), i.note ? h("span", { class: "ev-ro-note" }, i.note) : null)),
    ),
  );
}

function violations(vm: EvCardVM["violations"]): HTMLElement {
  if (vm.empty) return h("p", { class: "card hist-empty", role: "status" }, vm.empty);
  return h(
    "section",
    { class: "card rows" },
    ...vm.items.map((v) =>
      h(
        "div",
        { class: "row is-static" },
        h(
          "span",
          { class: "row-body" },
          h("span", { class: "row-text" }, h("span", { class: "ev-name" }, v.title), h("span", { class: "ev-sub" }, v.comment), h("span", { class: "ev-sub" }, v.date)),
          v.cancelled ? h("span", { class: "row-end" }, h("span", { class: "chip chip-muted" }, v.cancelled)) : null,
        ),
      ),
    ),
  );
}

function history(vm: EvCardVM["history"]): HTMLElement {
  if (vm.empty) return h("p", { class: "card hist-empty", role: "status" }, vm.empty);
  const row = (label: string, value: string, cls = ""): HTMLElement =>
    h("div", { class: `row hist-row is-static${cls}` }, h("span", { class: "row-body" }, h("span", { class: "row-text" }, label), h("span", { class: "row-end hist-score" }, value), h("span", { class: "chev-gap" })));
  return h(
    "div",
    { class: "evc-stack" },
    ...vm.quarters.map((q) =>
      h(
        "section",
        { class: "card card-split quarter" },
        h("div", { class: "card-body" }, h("div", { class: "card-head" }, h("h2", { class: "card-title" }, q.title))),
        ...q.months.map((m) => row(m.label, m.value)),
        q.avg === null ? null : row(t("hist_avg"), q.avg, " hist-avg"),
      ),
    ),
  );
}

export function renderEvCard(d: EvCard, nowMs: number): HTMLElement {
  const vm = evCardView(d, lang(), nowMs);
  if (shown.employee !== d.employee.id) shown = { employee: d.employee.id, tab: "attendance" };

  const panel = h("div", { class: "evc-panel", role: "tabpanel" });
  const tabs = h("div", { class: "evc-tabs", role: "tablist", "aria-label": t("ev_card_tabs") });
  const draw = (): void => {
    fill(
      tabs,
      vm.tabs.map((x) =>
        h(
          "button",
          {
            type: "button",
            role: "tab",
            class: "evc-tab",
            "aria-selected": String(shown.tab === x.value),
            onclick: () => {
              shown = { ...shown, tab: x.value };
              draw();
              // Пять вкладок в ряд на узком экране не помещаются: выбранную подводим в видимую часть ряда.
              const sel = tabs.querySelector('[aria-selected="true"]') as HTMLElement | null;
              if (sel && typeof sel.scrollIntoView === "function") sel.scrollIntoView({ block: "nearest", inline: "nearest" });
            },
          },
          x.count === null ? x.label : `${x.label} ${x.count}`,
        ),
      ),
    );
    fill(panel, [shown.tab === "attendance" ? attendance(vm.att) : shown.tab === "sales" && vm.sales ? sales(vm.sales) : shown.tab === "review" ? review(vm.review) : shown.tab === "violations" ? violations(vm.violations) : history(vm.history)]);
  };
  draw();

  return h(
    "main",
    { class: "screen evc" },
    h("h1", { class: "title" }, vm.name),
    h("p", { class: "ev-info" }, vm.sub, vm.inactive ? h("span", { class: "chip chip-muted evc-inactive" }, vm.inactive) : null),
    h("div", { class: "att-switch" }, slot(vm.prev, "prev"), h("h2", { class: "att-month" }, vm.month), slot(vm.next, "next")),
    h("dl", { class: "card evc-figs" }, ...vm.figures.map((f) => h("div", { class: "evc-fig" }, h("dd", { class: `evc-fig-val${f.tone ? ` evc-tone-${f.tone}` : ""}` }, f.value), h("dt", { class: "evc-fig-label" }, f.label)))),
    tabs,
    panel,
  );
}
