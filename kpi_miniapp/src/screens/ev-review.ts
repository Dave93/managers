// Форма оценки сотрудника: рисует EvReviewVM (view/ev-review.ts). Черновик правки живёт в памяти по
// ключу «период:сотрудник» до успешного сохранения или отправки: возврат на экран его восстанавливает.
// Действия берут защёлку; результат разбирает evOutcome. Строки с сервера — только текстом.
import type { EvReviewForm } from "@backend/modules/kpi/tg-app/ev-types";
import { appApi } from "../api";
import { pct1 } from "../format";
import { STATUS_TEXT, lang, t } from "../i18n";
import { navigate, rerender } from "../nav";
import { hashOf, parseHash } from "../route";
import { haptic } from "../telegram";
import { latch } from "../util";
import { h } from "../ui";
import { evOutcome } from "../view/ev-errors";
import { evReviewView } from "../view/ev-review";
import { type Draft, type FormIssue, draftFromItems, previewPct, reviewIssues, toItemInputs } from "../view/ev-score";
import { fill } from "./ev-common";
import { renderItemEditors } from "./ev-items";

const drafts = new Map<string, Draft>();
const NBSP = " ";

export function renderEvReview(f: EvReviewForm, nowMs: number): HTMLElement {
  const vm = evReviewView(f, lang(), nowMs);
  const key = `${f.period}:${f.employee.id}`;
  const banner = vm.banner ? h("p", { class: `card ev-banner${vm.banner.key === "ev_form_opens" ? " ev-banner-soft" : ""}`, role: "status" }, t(vm.banner.key, vm.banner.vars)) : null;
  const cardBtn = vm.banner && vm.banner.key === "ev_readonly_scope" ? null : h("a", { class: "btn btn-quiet", href: hashOf({ name: "ev_card", employee_id: f.employee.id, period: f.period }), onclick: (e: Event) => { e.preventDefault(); navigate(parseHash(hashOf({ name: "ev_card", employee_id: f.employee.id, period: f.period }))); } }, t("ev_card_btn"));
  const head = [h("h1", { class: "title" }, vm.title), h("p", { class: "ev-info" }, vm.sub), cardBtn, banner];
  const violationBtn = vm.banner && (vm.banner.key === "ev_readonly_scope" || vm.banner.key === "ev_closed")
    ? null
    : h("a", { class: "btn btn-quiet", href: hashOf({ name: "ev_violation", employee_id: f.employee.id }), onclick: (e: Event) => { e.preventDefault(); navigate(parseHash(hashOf({ name: "ev_violation", employee_id: f.employee.id }))); } }, t("ev_btn_violation"));

  // Выходной не зависит от месяца оценки (отчётный месяц может быть закрыт, текущий открыт): прячем только без назначения.
  const dayOffBtn = vm.banner && vm.banner.key === "ev_readonly_scope"
    ? null
    : h("a", { class: "btn btn-quiet", href: hashOf({ name: "ev_dayoff", employee_id: f.employee.id }), onclick: (e: Event) => { e.preventDefault(); navigate(parseHash(hashOf({ name: "ev_dayoff", employee_id: f.employee.id }))); } }, t("ev_btn_dayoff"));

  if (vm.mode === "readonly") {
    const rows = f.items.map((i) => h("li", { class: "ev-ro" }, h("span", { class: "ev-ro-name" }, lang() === "uz" && i.title_uz ? i.title_uz : i.title_ru), h("span", { class: "ev-ro-score" }, i.score === null ? "—" : String(i.score)), i.note ? h("span", { class: "ev-ro-note" }, i.note) : null));
    return h("main", { class: "screen" }, ...head, h("ul", { class: "card ev-ro-list" }, ...rows), violationBtn, dayOffBtn);
  }

  let draft: Draft = drafts.get(key) ?? draftFromItems(f.items, true);
  let issues = new Map<string, FormIssue>();
  const busy = latch();
  const total = h("p", { class: "ev-total", "aria-live": "polite" });
  const message = h("p", { class: "ev-msg", role: "status" });
  const editors = h("div", {});
  const btnDraft = h("button", { type: "button", class: "btn btn-quiet", onclick: () => void act("draft") }, t("ev_btn_draft"));
  const btnSubmit = h("button", { type: "button", class: "btn btn-primary", disabled: !vm.submitAllowed, onclick: () => void act("submit") }, t("ev_btn_submit"));

  const paintTotal = (): void => {
    const p = previewPct(f.items, draft);
    total.textContent = p === null ? t("ev_form_total_none") : t("ev_form_total", { pct: `${pct1(p)}${NBSP}%` });
  };
  const drawEditors = (): void => {
    fill(editors, [renderItemEditors({ groups: vm.groups, items: f.items, draft, issues, disabled: false, onChange: (id, v) => { draft = { ...draft, [id]: v }; drafts.set(key, draft); paintTotal(); } })]);
  };

  async function act(kind: "draft" | "submit"): Promise<void> {
    if (!busy.take()) return;
    try {
      message.textContent = "";
      const found = reviewIssues(f.items, draft, kind, "", 0);
      issues = new Map();
      for (const i of found) if (i.item_id) issues.set(i.item_id, i);
      drawEditors();
      if (found.length) {
        haptic("error");
        const first = found[0]?.item_id;
        if (first) document.getElementById(`ev-item-${first}`)?.scrollIntoView({ block: "center" });
        return;
      }
      const items = toItemInputs(f.items, draft);
      let res = f.review && kind === "submit" ? null : await appApi().send<EvReviewForm>("PUT", "/ev/draft", { period: f.period, employee_id: f.employee.id, items });
      if (kind === "submit") {
        const rid = f.review?.id ?? (res && res.kind === "ok" ? res.data.review?.id : undefined);
        if (rid) res = await appApi().send<EvReviewForm>("POST", `/ev/reviews/${rid}/submit`, { items });
      }
      const out = evOutcome(res as NonNullable<typeof res>, lang());
      switch (out.kind) {
        case "done":
          haptic("success");
          drafts.delete(key);
          message.textContent = t(kind === "draft" ? "ev_saved" : "ev_sent");
          rerender();
          return;
        case "reload":
          message.textContent = t(out.key);
          drafts.delete(key);
          rerender();
          return;
        case "session":
          rerender();
          return;
        case "unknown":
          message.textContent = STATUS_TEXT.offline[lang()];
          return;
        case "error": {
          haptic("error");
          message.textContent = t(out.key, out.vars);
          const body = (res && res.kind === "http" ? res.body : null) as { item_id?: string } | null;
          if (body?.item_id) {
            const code = res && res.kind === "http" && res.error === "bad_score" ? "bad_score_text" : "note_required";
            issues = new Map([[body.item_id, { code, item_id: body.item_id }]]);
            drawEditors();
          }
          return;
        }
      }
    } finally {
      busy.release();
    }
  }

  paintTotal();
  drawEditors();
  return h("main", { class: "screen" }, ...head, total, editors, message, h("div", { class: "ev-actions" }, btnDraft, btnSubmit), violationBtn, dayOffBtn);
}
