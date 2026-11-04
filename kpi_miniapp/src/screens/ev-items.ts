// Редакторы пунктов карты (форма оценки и разбор спора): пять кнопок балла, «Свой балл»,
// «Нет данных»/«Принять» у автопунктов, заметка, подсказки о нарушениях. Строки с сервера — только текстом.
// Поля создаются один раз; paint() обновляет нажатия и подсказку, не теряя фокус при наборе.
import type { EvFormItem } from "@backend/modules/kpi/tg-app/ev-types";
import { lang, t } from "../i18n";
import { h } from "../ui";
import type { EvItemVM, EvReviewVM } from "../view/ev-review";
import { type Draft, type DraftItem, type FormIssue, SCORE_BUTTONS, evIssueText, pickScore, scoreTextChange, staleNoteHint } from "../view/ev-score";

export interface ItemEditorsOpts {
  groups: EvReviewVM["groups"];
  items: readonly EvFormItem[];
  draft: Draft;
  issues: Map<string, FormIssue>;
  disabled: boolean;
  onChange(itemId: string, v: DraftItem): void;
}

function itemCard(vm: EvItemVM, src: EvFormItem, o: ItemEditorsOpts): HTMLElement {
  let value: DraftItem = o.draft[vm.id] ?? { score: src.score, note: src.note ?? "" };
  const auto = src.source !== "manual";
  const apply = (next: DraftItem, fromInput = false): void => {
    value = next;
    o.onChange(vm.id, next);
    if (!fromInput) own.value = next.score === null ? "" : String(next.score);
    paint();
  };
  const btns = SCORE_BUTTONS.map((n) => h("button", { type: "button", class: "ev-score-btn", disabled: o.disabled, onclick: () => apply(pickScore(value, n)) }, String(n)));
  const own = h("input", { class: "ev-field ev-own", type: "text", inputmode: "numeric", autocomplete: "off", "aria-label": `${vm.title}: ${t("ev_score_own")}`, placeholder: t("ev_score_own"), disabled: o.disabled,
    oninput: (e: Event) => { const next = scoreTextChange(value, (e.target as HTMLInputElement).value); if (next) apply(next, true); } }) as HTMLInputElement;
  own.value = value.invalid ? (value.text ?? "") : value.score === null ? "" : String(value.score);
  const extra = auto
    ? [
        h("button", { type: "button", class: "ev-score-btn ev-score-wide", disabled: o.disabled, onclick: () => apply(pickScore(value, null)) }, t("ev_score_none")),
        src.suggestion ? h("button", { type: "button", class: "ev-score-btn ev-score-wide", disabled: o.disabled, onclick: () => apply(pickScore(value, (src.suggestion as { score: number }).score)) }, t("ev_suggest_accept")) : null,
      ]
    : [];
  const note = h("textarea", { class: "ev-field ev-note", rows: "2", "aria-label": `${vm.title}: ${t("ev_note_label")}`, placeholder: t("ev_note_ph"), disabled: o.disabled,
    oninput: (e: Event) => { value = { ...value, note: (e.target as HTMLTextAreaElement).value }; o.onChange(vm.id, value); paint(); } }) as HTMLTextAreaElement;
  note.value = value.note;
  const stale = h("p", { class: "ev-stale", role: "status" }, t("ev_note_stale"));
  const issue = o.issues.get(vm.id);

  function paint(): void {
    btns.forEach((b, i) => b.setAttribute("aria-pressed", String(!value.invalid && value.score === SCORE_BUTTONS[i])));
    stale.hidden = !staleNoteHint(src.score, value.score, src.note ?? "", value.note);
  }
  paint();

  return h(
    "section",
    { class: `card ev-item${issue ? " ev-bad" : ""}`, id: `ev-item-${vm.id}` },
    h("h3", { class: "ev-item-title" }, vm.title),
    vm.sourceLabel ? h("span", { class: "chip chip-muted" }, vm.sourceLabel) : null,
    vm.hint ? h("p", { class: "ev-hint" }, vm.hint) : null,
    vm.suggestionText ? h("p", { class: "ev-hint" }, vm.suggestionText) : null,
    h("div", { class: "ev-scores", role: "group", "aria-label": vm.title }, ...btns),
    h("div", { class: "ev-own-row" }, own, ...extra),
    h("label", { class: "ev-note-label" }, t("ev_note_label")),
    note,
    h("p", { class: "ev-hint" }, t("ev_note_hint")),
    stale,
    vm.violationLine ? h("p", { class: "ev-viol" }, vm.violationLine) : null,
    ...vm.violationComments.map((c) => h("p", { class: "ev-viol-c" }, c)),
    issue ? h("p", { class: "ev-issue", role: "alert" }, evIssueText(issue, 0, lang())) : null,
  );
}

export function renderItemEditors(o: ItemEditorsOpts): HTMLElement {
  const byId = new Map(o.items.map((i) => [i.item_id, i] as [string, EvFormItem]));
  const kids: HTMLElement[] = [];
  for (const g of o.groups) {
    kids.push(h("h2", { class: "ev-group" }, g.title));
    for (const vm of g.items) {
      const src = byId.get(vm.id);
      if (src) kids.push(itemCard(vm, src, o));
    }
  }
  return h("div", { class: "ev-items" }, ...kids);
}
