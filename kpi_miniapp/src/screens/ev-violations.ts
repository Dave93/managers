// «Мои нарушения»: рисует evViolationsView. Строка устроена как у сотрудника (превью фото 80 px,
// на весь экран по нажатию); у своего нарушения с правом отмены — тихая «Отменить» с причиной.
// Строки с сервера (имена, пункт, комментарий) попадают в DOM только текстом через h().
import type { EvViolations } from "@backend/modules/kpi/tg-app/ev-types";
import { appApi } from "../api";
import { lang, t } from "../i18n";
import { rerender } from "../nav";
import { photoThumb } from "../photo";
import { openReasonSheet } from "../reason-sheet";
import { h, noWidow } from "../ui";
import { type EvViolationVM, evViolationsView } from "../view/ev-violations";

const CHIP: Record<EvViolationVM["status"]["tone"], string> = { active: "chip chip-ink", warn: "chip chip-warn", muted: "chip chip-muted" };

function photoSlot(id: string): HTMLElement {
  const slot = h("span", { class: "photo photo-loading", "aria-hidden": "true" });
  void photoThumb(id, "/ev/violation-photos").then((el) => {
    if (slot.parentNode && document.body.contains(slot)) slot.parentNode.replaceChild(el, slot);
  });
  return slot;
}

function row(v: EvViolationVM): HTMLElement {
  const comment = v.comment.trim();
  const media = h("div", { class: "vio-media" }, ...(v.photoIds.length ? v.photoIds.map(photoSlot) : [h("span", { class: "photo photo-none", "aria-hidden": "true" }, "—")]));
  const cancel = v.canCancel
    ? h("button", { type: "button", class: "btn btn-quiet vio-dispute", "aria-haspopup": "dialog", onclick: () => openReasonSheet({
        title: t("ev_cancel_title"), hint: t("ev_cancel_hint"), placeholder: t("ev_cancel_ph"), min: 3, submitLabel: t("ev_cancel_send"),
        send: (reason) => appApi().send("POST", `/ev/violations/${v.id}/cancel`, { reason }), onDone: rerender }) }, t("ev_viol_cancel"))
    : v.line ? h("p", { class: "vio-line" }, noWidow(v.line)) : null;
  return h("li", { class: v.status.tone === "muted" ? "vio is-cancelled" : "vio" }, media,
    h("div", { class: "vio-body" },
      h("div", { class: "card-head" }, h("h2", { class: "card-title vio-item" }, v.item), h("span", { class: CHIP[v.status.tone] }, v.status.text)),
      v.who ? h("p", { class: "vio-when" }, v.who) : null,
      h("p", { class: "vio-when" }, v.cancelReason ? noWidow(`${v.when} · ${v.cancelReason}`) : v.when),
      comment ? h("p", { class: "vio-comment" }, noWidow(comment)) : null,
      cancel));
}

export function renderEvViolations(d: EvViolations): HTMLElement {
  const vm = evViolationsView(d, lang());
  return h("main", { class: "screen violations" }, h("h1", { class: "title" }, vm.title),
    vm.empty ? h("p", { class: "card vio-empty" }, t("ev_myviol_empty")) : h("ul", { class: "card vio-list" }, ...vm.items.map(row)));
}
