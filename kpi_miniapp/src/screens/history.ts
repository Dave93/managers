// «История»: рисует вид view/history.ts. Макет screens.html, экран 3: заголовок, по карточке
// на квартал, новые сверху. В карточке — квартал и итог, строки месяцев и средний.
//
// Карточка квартала — страница ведомости: месяцы строками, балл справа по одному краю
// табличными цифрами, средний — итоговой строкой под чертой, как итог в ведомости.
// Оценённый месяц — ссылка на свою «Вся оценка» (шеврон); у прочих месяцев на месте шеврона
// пустое место той же ширины, чтобы все значения кончались на одной вертикали.
//
// Итог — пометка той же пары цветов, что на главном: «Утверждено +N сум» — зелёная,
// «идёт» и «Ждём решения HR» — тёплая серая, «Без прибавки» — серая.
import { t } from "../i18n";
import { navigate } from "../nav";
import { parseHash } from "../route";
import { chevron, h } from "../ui";
import type { QuarterVM, historyView } from "../view/history";

const CHIP: Record<QuarterVM["result"]["tone"], string> = {
  ok: "chip chip-ok",
  wait: "chip chip-wait",
  muted: "chip chip-muted",
};

/** Ссылка внутри приложения: href для доступности, переход — через роутер (стек «назад»). */
function inAppLink(hash: string, cls: string, ...kids: (Node | string | null)[]): HTMLElement {
  return h(
    "a",
    {
      class: cls,
      href: hash,
      onclick: (e: Event) => {
        e.preventDefault();
        navigate(parseHash(hash));
      },
    },
    ...kids,
  );
}

function monthRow(m: QuarterVM["months"][number]): HTMLElement {
  if (m.hash) {
    return inAppLink(
      m.hash,
      "row hist-row",
      h("span", { class: "row-body" }, h("span", { class: "row-text" }, m.label), h("span", { class: "row-end hist-score" }, m.value), chevron()),
    );
  }
  return h(
    "div",
    { class: "row hist-row is-static" },
    h("span", { class: "row-body" }, h("span", { class: "row-text" }, m.label), h("span", { class: "row-end" }, m.value), h("span", { class: "chev-gap" })),
  );
}

function quarterCard(q: QuarterVM): HTMLElement {
  return h(
    "section",
    { class: "card card-split quarter" },
    h("div", { class: "card-body" }, h("div", { class: "card-head" }, h("h2", { class: "card-title" }, q.title), h("span", { class: CHIP[q.result.tone] }, q.result.text))),
    ...q.months.map(monthRow),
    q.avg === null
      ? null
      : h(
          "div",
          { class: "row hist-row is-static hist-avg" },
          h("span", { class: "row-body" }, h("span", { class: "row-text" }, t("hist_avg")), h("span", { class: "row-end hist-score" }, q.avg), h("span", { class: "chev-gap" })),
        ),
  );
}

export function renderHistory(vm: ReturnType<typeof historyView>): HTMLElement {
  return h(
    "main",
    { class: "screen history" },
    h("h1", { class: "title" }, t("link_history")),
    ...(vm.empty ? [h("p", { class: "card hist-empty" }, t("hist_empty"))] : vm.quarters.map(quarterCard)),
  );
}
