// «Нарушения»: рисует вид view/violations.ts. Порядок — макет screens.html, экран 2:
// заголовок «Нарушения · месяц», одна карточка со строками нарушений, под ней пояснение.
//
// Строка нарушения: слева колонка превью фиксированной ширины (текст всех строк начинается
// с одного края), справа пункт и статус, дата, комментарий записавшего, внизу «Оспорить»
// или строка, почему нельзя. Фото — улика рядом с ответом, поэтому превью крупное (80 px)
// и открывается на весь экран. Нарушений с несколькими фото (до трёх) — превью столбиком.
//
// Статусы: «действует» — нейтральная пометка чернилами, «спор открыт» — янтарная, как
// «Спор на рассмотрении» на главном, «отменено» — серая, и вся строка отменённого серым
// цветом текста (не прозрачностью: так текст держит контраст AA).
//
// «Оспорить» — тихая кнопка в строке: строк с ней бывает несколько, и ряд чёрных главных
// кнопок стал бы громче самих нарушений.
//
// Строки с сервера (пункт, комментарий, причина отмены) попадают в DOM только текстом через h().
import type { TgViolations } from "@backend/modules/kpi/tg-app/types";
import { t } from "../i18n";
import { rerender } from "../nav";
import { photoThumb } from "../photo";
import { openDisputeSheet } from "../sheet";
import { h, noWidow } from "../ui";
import type { ViolationVM, violationsView } from "../view/violations";

/** Число не отрывается от следующего слова («14 октября»), последнее слово — от предыдущего. */
const tie = (s: string): string => noWidow(s.replace(/(\d) (?=\S)/g, "$1\u00a0"));

const CHIP: Record<ViolationVM["status"]["tone"], string> = {
  active: "chip chip-ink",
  warn: "chip chip-warn",
  muted: "chip chip-muted",
};

/** Слот превью: пока файл грузится — брусок; потом фото или «Фото не загрузилось». */
function photoSlot(id: string): HTMLElement {
  const slot = h("span", { class: "photo photo-loading", "aria-hidden": "true" });
  void photoThumb(id).then((el) => {
    // Экран успели сменить — подменять нечего.
    if (slot.parentNode && document.body.contains(slot)) slot.parentNode.replaceChild(el, slot);
  });
  return slot;
}

/** Колонка превью. Фото нет — серый прочерк в рамке: так в приложении выглядит любое пустое значение. */
function media(v: ViolationVM): HTMLElement {
  const kids = v.photoIds.length ? v.photoIds.map(photoSlot) : [h("span", { class: "photo photo-none", "aria-hidden": "true" }, "—")];
  return h("div", { class: "vio-media" }, ...kids);
}

function action(v: ViolationVM, d: TgViolations): HTMLElement | null {
  if (!v.canDispute) return v.line ? h("p", { class: "vio-line" }, tie(v.line)) : null;
  return h(
    "button",
    {
      type: "button",
      class: "btn btn-quiet vio-dispute",
      "aria-haspopup": "dialog",
      onclick: () =>
        openDisputeSheet({
          subject_type: "violation",
          subject_id: v.id,
          title: t("sheet_violation"),
          reasonMin: d.reason_min,
          // Спор принят сервером — экран заново: вместо кнопки «Вы оспорили нарушение …».
          onDone: rerender,
        }),
    },
    t("btn_dispute"),
  );
}

function row(v: ViolationVM, d: TgViolations): HTMLElement {
  const comment = v.comment.trim();
  return h(
    "li",
    { class: v.status.tone === "muted" ? "vio is-cancelled" : "vio" },
    media(v),
    h(
      "div",
      { class: "vio-body" },
      // Заголовок и пометка — как у карточек: не помещаются в строку — пометка уходит вниз.
      h("div", { class: "card-head" }, h("h2", { class: "card-title vio-item" }, v.item), h("span", { class: CHIP[v.status.tone] }, v.status.text)),
      // У отменённого причина — в той же строке, что дата (макет: «9 октября · записано по ошибке»).
      h("p", { class: "vio-when" }, v.cancelReason ? noWidow(`${v.when} · ${v.cancelReason}`) : v.when),
      comment ? h("p", { class: "vio-comment" }, tie(comment)) : null,
      action(v, d),
    ),
  );
}

export function renderViolations(vm: ReturnType<typeof violationsView>, d: TgViolations): HTMLElement {
  return h(
    "main",
    { class: "screen violations" },
    h("h1", { class: "title" }, vm.title),
    vm.empty ? h("p", { class: "card vio-empty" }, t("viol_empty")) : h("ul", { class: "card vio-list" }, ...vm.items.map((v) => row(v, d))),
    h("p", { class: "vio-note" }, tie(vm.note)),
  );
}
