// «Вся оценка»: рисует ReviewVM (view/review.ts). Порядок блоков — макет screens.html,
// экран 1: заголовок «месяц · балл», основные и дополнительные пункты, изменения после
// отправки, решение по прошлому спору, внизу «Оспорить» или строка, почему нельзя.
//
// Полоска пункта — главный элемент данных экрана, поэтому её заливка — оттенок Telegram
// (button_color) на дорожке --rail, как шкала прибавки на главном. Недобранное до 100 видно
// как пустая часть дорожки. Хром остаётся чернилами; «Оспорить» — единственная главная кнопка.
//
// Строки с сервера (названия пунктов, заметки оценщика, причины правок, комментарий к
// решению) попадают в DOM только текстом через h().
import type { TgReview } from "@backend/modules/kpi/tg-app/types";
import { lang, monthName, t } from "../i18n";
import { rerender } from "../nav";
import { openDisputeSheet } from "../sheet";
import { h, noWidow } from "../ui";
import type { ReviewItemVM, ReviewVM } from "../view/review";

/** Число не отрывается от следующего слова («14 и 18 октября», «27 октября»), последнее слово — от предыдущего. */
const tie = (s: string): string => noWidow(s.replace(/(\d) (?=\S)/g, "$1 "));

function itemRow(x: ReviewItemVM): HTMLElement {
  return h(
    "li",
    { class: x.noData ? "item is-empty" : "item" },
    h(
      "div",
      { class: "item-head" },
      h("div", { class: "item-name" }, h("span", { class: "item-title" }, x.title), x.source ? h("span", { class: "item-src" }, x.source) : null),
      // Балла нет — серый прочерк меньше цифры, а не 0 и не пустая полоска.
      h("span", { class: x.noData ? "item-score is-empty" : "item-score" }, x.score),
    ),
    x.bar === null
      ? null
      : h(
          "div",
          { class: "item-bar", "aria-hidden": "true" },
          h("span", { class: "item-fill", style: `width:${(x.bar * 100).toFixed(1)}%` }),
        ),
    x.noData ? h("p", { class: "item-hint" }, t("no_data_hint")) : null,
    // Заметка оценщика — прямо под пунктом, который она объясняет.
    x.note ? h("p", { class: "item-note" }, tie(x.note)) : null,
  );
}

function groupBlock(g: ReviewVM["groups"][number]): HTMLElement {
  return h("section", { class: "card items" }, h("h2", { class: "card-title" }, g.title), h("ul", { class: "item-list" }, ...g.items.map(itemRow)));
}

function changesBlock(v: ReviewVM["changes"]): HTMLElement {
  return h(
    "section",
    { class: "card changes" },
    h("h2", { class: "card-title" }, t("changes_title")),
    h(
      "ul",
      { class: "change-list" },
      ...v.map((c) =>
        h(
          "li",
          { class: "change" },
          h("p", { class: "change-line" }, c.line),
          c.items.length ? h("ul", { class: "change-items" }, ...c.items.map((x) => h("li", { class: "change-item" }, x))) : null,
          c.reason ? h("p", { class: "change-reason" }, c.reason) : null,
        ),
      ),
    ),
  );
}

function resolvedBlock(v: NonNullable<ReviewVM["resolved"]>): HTMLElement {
  return h(
    "section",
    { class: "card resolved" },
    h("h2", { class: "card-title" }, v.title),
    v.comment ? h("p", { class: "resolved-comment" }, v.comment) : null,
  );
}

function disputeBlock(v: ReviewVM["dispute"], r: TgReview): HTMLElement | null {
  if (!v.can) return v.line ? h("p", { class: "dispute-line" }, tie(v.line)) : null;
  const btn = h(
    "button",
    {
      type: "button",
      class: "btn btn-primary dispute-open",
      "aria-haspopup": "dialog",
      onclick: () =>
        openDisputeSheet({
          subject_type: "review",
          subject_id: r.review_id,
          title: t("sheet_review", { month: monthName(r.period, "nom", lang()) }),
          reasonMin: r.reason_min,
          // Спор принят сервером — экран заново: вместо кнопки «Вы оспорили оценку …».
          onDone: rerender,
        }),
    },
    v.label,
  );
  return btn;
}

export function renderReview(vm: ReviewVM, r: TgReview): HTMLElement {
  return h(
    "main",
    { class: "screen review" },
    h("h1", { class: "title review-title" }, vm.title),
    ...vm.groups.map(groupBlock),
    vm.changes.length ? changesBlock(vm.changes) : null,
    vm.resolved ? resolvedBlock(vm.resolved) : null,
    disputeBlock(vm.dispute, r),
  );
}
