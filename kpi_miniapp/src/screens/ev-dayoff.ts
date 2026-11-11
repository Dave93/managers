// Выдача выходного: даты «с–по», причина списком, при «Другая причина» ещё и текст. Что допустимо, решает
// модель view/ev-dayoff.ts (те же проверки есть на сервере). Запись не идемпотентна на сети: если ответа нет,
// результат неизвестен, повторно сама не уходит, человек сначала смотрит «Выданные выходные».
// Строки с сервера (имя, подписи) попадают в DOM только текстом через h().
import type { DayOffReason, EvDayOffForm } from "@backend/modules/kpi/tg-app/ev-types";
import { appApi } from "../api";
import { lang, t } from "../i18n";
import { back, navigate } from "../nav";
import { hashOf, parseHash } from "../route";
import { haptic } from "../telegram";
import { h } from "../ui";
import { latch } from "../util";
import { type DayOffDraft, canRequestReplacement, dayOffBody, dayOffCount, dayOffFormView, dayOffIssues, dayOffWarnings } from "../view/ev-dayoff";
import { evOutcome } from "../view/ev-errors";
import { fill, inAppLink } from "./ev-common";

// Сегодня по Ташкенту (UTC+5).
const tashkentToday = (): string => new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);

// Сегодня, зажатое в допустимое окно: стартовое значение дат.
function startDay(min: string, max: string): string {
  const today = tashkentToday();
  return today < min ? min : today > max ? max : today;
}

export function renderEvDayOff(f: EvDayOffForm): HTMLElement {
  const l = lang();
  const vm = dayOffFormView(f, l);
  const start = startDay(vm.min, vm.max);
  const draft: DayOffDraft = { from: start, to: start, reason: null, text: "", replacement: false };
  let touched = false; // замечания показываем после первого действия, а не на пустой форме
  let sending = false;
  let blocked = false; // неизвестный исход отправки: до просмотра списка кнопка закрыта
  const busy = latch();

  const dateInput = (label: string, value: string, onInput: (v: string) => void): HTMLInputElement => {
    const el = h("input", { type: "date", class: "ev-field", "aria-label": label, min: vm.min, max: vm.max, oninput: (e: Event) => { touched = true; onInput((e.target as HTMLInputElement).value); sync(); } }) as HTMLInputElement;
    el.value = value;
    return el;
  };
  const toIn = dateInput(t("ev_dayoff_to"), draft.to, (v) => { draft.to = v; });
  const fromIn = dateInput(t("ev_dayoff_from"), draft.from, (v) => {
    draft.from = v;
    // «По» не раньше «с»: заменяем сами, чтобы человек не гонялся за двумя полями.
    if (draft.to < draft.from) { draft.to = draft.from; toIn.value = draft.to; }
  });
  const select = h("select", { class: "ev-field", "aria-label": t("ev_dayoff_reason"), onchange: (e: Event) => { touched = true; draft.reason = ((e.target as HTMLSelectElement).value || null) as DayOffReason | null; sync(); } },
    h("option", { value: "" }, t("ev_dayoff_reason")),
    ...vm.reasons.map((r) => h("option", { value: r.code }, r.label)));
  const text = h("textarea", { class: "ev-field ev-note", rows: "3", "aria-label": t("ev_dayoff_other_ph"), placeholder: t("ev_dayoff_other_ph"), oninput: (e: Event) => { touched = true; draft.text = (e.target as HTMLTextAreaElement).value; sync(); } }) as HTMLTextAreaElement;
  const box = h("input", { type: "checkbox", onchange: (e: Event) => { draft.replacement = (e.target as HTMLInputElement).checked; } }) as HTMLInputElement;
  const replacement = h("label", { class: "ev-check" }, box, h("span", {}, t("ev_dayoff_replacement")));
  const replacementHint = h("p", { class: "ev-hint" }, t("ev_dayoff_replacement_hint"));
  const count = h("p", { class: "ev-hint", "aria-live": "polite" });
  const warn = h("p", { class: "ev-hint", role: "status" });
  const issues = h("div", { class: "ev-notes", role: "status" });
  const message = h("p", { class: "ev-msg", role: "status" });
  const listLink = inAppLink(hashOf({ name: "ev_daysoff", period: null }), "ev-link", t("ev_my_daysoff"));
  listLink.hidden = true;
  listLink.addEventListener("click", () => { blocked = false; });
  const send = h("button", { type: "button", class: "btn btn-primary", onclick: () => void submit() }, t("ev_dayoff_send")) as HTMLButtonElement;

  function sync(): void {
    const n = dayOffCount(draft);
    const problems = dayOffIssues(draft, f, l);
    count.textContent = n > 0 ? t("ev_dayoff_count", { n }) : "";
    warn.textContent = dayOffWarnings(draft, f, l).join(" ");
    text.hidden = draft.reason !== "other";
    // Прошедшие дни HR не интересуют: для них галочки нет.
    replacement.hidden = replacementHint.hidden = !canRequestReplacement(draft, tashkentToday());
    fill(issues, touched ? problems.map((p) => h("p", { class: "ev-issue" }, p)) : []);
    send.disabled = problems.length > 0 || sending || blocked;
  }

  async function submit(): Promise<void> {
    if (draft.reason === null || !busy.take()) return;
    sending = true;
    message.textContent = "";
    sync();
    try {
      const res = await appApi().send("POST", "/ev/days-off", dayOffBody(f.employee.id, { ...draft, reason: draft.reason }));
      const out = evOutcome(res, l);
      if (out.kind === "done") {
        haptic("success");
        back();
        // Список открывается на месяце выданных дней: при выдаче вперёд он может быть не текущим.
        navigate(parseHash(hashOf({ name: "ev_daysoff", period: `${draft.from.slice(0, 7)}-01` })));
        return;
      }
      haptic("error");
      if (out.kind === "unknown") { blocked = true; listLink.hidden = false; message.textContent = t("ev_err_unknown_outcome"); }
      else if (out.kind === "error" || out.kind === "reload") message.textContent = t(out.key, out.kind === "error" ? out.vars : undefined);
    } finally {
      sending = false;
      busy.release();
      sync();
    }
  }

  const view = h("main", { class: "screen" },
    h("h1", { class: "title" }, vm.title),
    f.employee.terminal_name ? h("p", { class: "ev-info" }, f.employee.terminal_name) : null,
    h("section", { class: "card ev-item" },
      h("label", { class: "ev-note-label" }, t("ev_dayoff_from")), fromIn,
      h("label", { class: "ev-note-label" }, t("ev_dayoff_to")), toIn, count, warn,
      vm.existing ? h("p", { class: "ev-hint" }, vm.existing) : null,
      h("label", { class: "ev-note-label" }, t("ev_dayoff_reason")), select, text,
      replacement, replacementHint),
    issues, send, message, listLink);
  sync();
  return view;
}
