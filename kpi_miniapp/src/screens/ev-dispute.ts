// Карточка спора и его разбор. Разбирает автор записи (сервер решает, can_resolve): принять — по оценке
// с новыми баллами и комментарием, по нарушению — комментарий; отклонить — комментарий. Повтор после
// «нет связи» безопасен: второй разбор получит 409 dispute_closed. Строки с сервера — только текстом.
import type { EvDisputeDetail } from "@backend/modules/kpi/tg-app/ev-types";
import { appApi } from "../api";
import { reasonCounter } from "../counter";
import { pct1 } from "../format";
import { STATUS_TEXT, lang, t } from "../i18n";
import { back, rerender } from "../nav";
import { photoThumb } from "../photo";
import { haptic } from "../telegram";
import { h } from "../ui";
import { latch } from "../util";
import { type ResolveDecision, resolveBody, resolveIssues } from "../view/ev-disputes";
import { evOutcome } from "../view/ev-errors";
import { evReviewView } from "../view/ev-review";
import { type Draft, type FormIssue, draftFromItems, evIssueText, previewPct } from "../view/ev-score";
import { monthName } from "../i18n";
import { fill } from "./ev-common";
import { renderItemEditors } from "./ev-items";

const NBSP = " ";
const drafts = new Map<string, Draft>();

export function renderEvDispute(d: EvDisputeDetail): HTMLElement {
  const x = d.dispute;
  const l = lang();
  const kind = t(x.subject_type === "review" ? "ev_dsp_review" : "ev_dsp_violation", { month: monthName(x.period, "nom", l) });
  const head = [h("h1", { class: "title" }, kind), h("p", { class: "ev-info" }, [x.employee_name, x.terminal_name].filter((p): p is string => !!p).join(" · "))];

  const about: (HTMLElement | null)[] = [];
  if (x.subject?.kind === "review" && x.subject.score_pct !== null) about.push(h("p", { class: "ev-total" }, t("ev_dsp_score_now", { pct: `${pct1(x.subject.score_pct)}${NBSP}%` })));
  if (x.subject?.kind === "violation") {
    const s = x.subject;
    about.push(h("p", { class: "ev-item-title" }, t("ev_dsp_violation_item", { title: s.item_title_ru ?? t("ev_viol_item_none") })), h("p", { class: "vio-comment" }, s.comment));
    const media = h("div", { class: "vio-media ev-previews" });
    for (const id of s.photo_ids) {
      const slot = h("span", { class: "photo photo-loading", "aria-hidden": "true" });
      media.appendChild(slot);
      void photoThumb(id, "/ev/violation-photos").then((el) => { if (slot.parentNode && document.body.contains(slot)) slot.parentNode.replaceChild(el, slot); });
    }
    if (s.photo_ids.length) about.push(media);
  }
  const reasonCard = h("section", { class: "card ev-item" }, h("h2", { class: "ev-item-title" }, t("ev_dsp_reason")), h("p", {}, x.reason), ...about);

  if (x.status !== "open" || !x.can_resolve) {
    const text = x.status === "accepted" ? t("ev_dsp_chip_accepted") : x.status === "rejected" ? t("ev_dsp_chip_rejected") : t("ev_dsp_not_mine");
    return h("main", { class: "screen" }, ...head, reasonCard,
      h("section", { class: "card ev-item" }, h("p", { class: "ev-item-title" }, x.status === "open" ? text : t("ev_dsp_resolution", { text })), x.resolution_comment ? h("p", { class: "ev-hint" }, x.resolution_comment) : null));
  }

  let decision: ResolveDecision = "rejected";
  let issues = new Map<string, FormIssue>();
  let draft: Draft = drafts.get(x.id) ?? (d.form ? draftFromItems(d.form.items, false) : {});
  let comment = "";
  const busy = latch();
  const groups = d.form ? evReviewView(d.form, l, Date.now()).groups : [];
  const total = h("p", { class: "ev-total", "aria-live": "polite" });
  const editors = h("div", {});
  const counter = h("p", { class: "ev-hint", "aria-live": "polite" });
  const message = h("p", { class: "ev-msg", role: "alert" });
  const send = h("button", { type: "button", class: "btn btn-primary", onclick: () => void submit() }) as HTMLButtonElement;
  const toggle = h("div", { class: "ev-scores", role: "group", "aria-label": t("ev_dsp_decision") });
  const btnAccept = h("button", { type: "button", class: "ev-score-btn", onclick: () => pick("accepted") }, t("ev_dsp_accept"));
  const btnReject = h("button", { type: "button", class: "ev-score-btn", onclick: () => pick("rejected") }, t("ev_dsp_reject"));
  toggle.appendChild(btnReject);
  toggle.appendChild(btnAccept);

  function paint(): void {
    btnAccept.setAttribute("aria-pressed", String(decision === "accepted"));
    btnReject.setAttribute("aria-pressed", String(decision === "rejected"));
    send.textContent = t(decision === "accepted" ? "ev_dsp_send_accept" : "ev_dsp_send_reject");
    const scores = decision === "accepted" && x.subject_type === "review" && d.form !== null;
    if (scores && d.form) {
      const p = previewPct(d.form.items, draft);
      total.textContent = p === null ? t("ev_form_total_none") : t("ev_form_total", { pct: `${pct1(p)}${NBSP}%` });
      fill(editors, [h("h2", { class: "ev-group" }, t("ev_dsp_scores")), renderItemEditors({ groups, items: d.form.items, draft, issues, disabled: false, onChange: (id, v) => { draft = { ...draft, [id]: v }; drafts.set(x.id, draft); const q = previewPct((d.form as NonNullable<typeof d.form>).items, draft); total.textContent = q === null ? t("ev_form_total_none") : t("ev_form_total", { pct: `${pct1(q)}${NBSP}%` }); } })]);
    } else {
      total.textContent = "";
      fill(editors, []);
    }
    const c = reasonCounter(comment, d.comment_min, null, l);
    counter.textContent = c.ok ? "" : c.text;
  }
  function pick(next: ResolveDecision): void { decision = next; issues = new Map(); message.textContent = ""; paint(); }

  async function submit(): Promise<void> {
    if (!busy.take()) return;
    try {
      message.textContent = "";
      const found = resolveIssues({ decision, comment, draft }, d);
      issues = new Map();
      for (const i of found) if (i.item_id) issues.set(i.item_id, i);
      paint();
      if (found.length) {
        haptic("error");
        message.textContent = found.filter((i) => !i.item_id).map((i) => evIssueText(i, d.comment_min, l)).join(". ");
        const first = found.find((i) => i.item_id)?.item_id;
        if (first) document.getElementById(`ev-item-${first}`)?.scrollIntoView({ block: "center" });
        return;
      }
      const out = evOutcome(await appApi().send("POST", `/ev/disputes/${x.id}/resolve`, resolveBody({ decision, comment, draft }, d)), l);
      switch (out.kind) {
        case "done": haptic("success"); drafts.delete(x.id); back(); return;
        case "reload": message.textContent = t(out.key); drafts.delete(x.id); rerender(); return;
        case "session": rerender(); return;
        case "unknown": message.textContent = STATUS_TEXT.offline[l]; return;
        case "error": haptic("error"); message.textContent = t(out.key, out.vars); return;
      }
    } finally {
      busy.release();
    }
  }

  const field = h("textarea", { class: "ev-field ev-note", rows: "3", "aria-label": t("ev_dsp_comment"), placeholder: t("ev_dsp_comment_ph"), oninput: (e: Event) => { comment = (e.target as HTMLTextAreaElement).value; const c = reasonCounter(comment, d.comment_min, null, l); counter.textContent = c.ok ? "" : c.text; } });
  paint();
  return h("main", { class: "screen" }, ...head, reasonCard,
    h("section", { class: "card ev-item" }, h("h2", { class: "ev-item-title" }, t("ev_dsp_decision")), toggle, total, editors, h("label", { class: "ev-note-label" }, t("ev_dsp_comment")), field, counter),
    send, message);
}
