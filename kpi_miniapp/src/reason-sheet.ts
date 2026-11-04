// Шторка с причиной для действий оценщика (отмена своего нарушения): поле, счётчик, кнопка в самой
// шторке. Устроена как sheet.ts (спор сотрудника), но без MainButton: sheet.ts не меняем, а отмена —
// редкое действие, обычной кнопки хватает. Защёлка на время запроса; нет связи — результат неизвестен,
// шторка остаётся с текстом. Уход с экрана закрывает шторку из роутера (closeReasonSheet).
// Строки с сервера в DOM — только текстом через h().
import type { ApiResult } from "./api";
import { reasonCounter } from "./counter";
import { STATUS_TEXT, lang, t } from "./i18n";
import { rerender } from "./nav";
import { haptic } from "./telegram";
import { h, noWidow, setBack } from "./ui";
import { latch, reasonCount } from "./util";
import { evOutcome } from "./view/ev-errors";

export interface ReasonSheetOptions {
  title: string; hint: string; placeholder: string; min: number; submitLabel: string;
  send(reason: string): Promise<ApiResult<unknown>>;
  onDone(): void;
}

let dismissOpen: (() => void) | null = null;

/** Роутер уходит с экрана или перерисовывает его: открытая шторка закрывается молча. */
export function closeReasonSheet(): void {
  if (dismissOpen) dismissOpen();
}

export function openReasonSheet(o: ReasonSheetOptions): void {
  closeReasonSheet();
  const opener = document.activeElement as HTMLElement | null;
  const busy = latch();
  let open = true;

  const field = h("textarea", { class: "sheet-field", rows: "4", placeholder: o.placeholder, "aria-label": o.title }) as HTMLTextAreaElement;
  const count = h("span", { class: "sheet-count", "aria-hidden": "true" });
  const error = h("p", { class: "sheet-error", role: "alert" });
  const send = h("button", { type: "button", class: "btn btn-primary sheet-send", disabled: true, onclick: () => void onSend() }, o.submitLabel) as HTMLButtonElement;

  const sync = (): void => {
    const c = reasonCounter(field.value, o.min, null, lang());
    count.textContent = c.text;
    count.className = c.ok ? "sheet-count is-ok" : "sheet-count";
    send.disabled = !c.ok || !open;
  };
  field.addEventListener("input", () => { error.textContent = ""; sync(); });

  async function onSend(): Promise<void> {
    if (!open || reasonCount(field.value) < o.min || !busy.take()) return;
    error.textContent = "";
    field.readOnly = true;
    send.disabled = true;
    try {
      const out = evOutcome(await o.send(field.value), lang());
      if (!open) return;
      if (out.kind === "done" || out.kind === "reload") {
        haptic("success");
        teardown();
        o.onDone();
        return;
      }
      if (out.kind === "session") {
        teardown();
        rerender();
        return;
      }
      haptic("error");
      error.textContent = noWidow(out.kind === "unknown" ? STATUS_TEXT.offline[lang()] : t(out.key, out.vars));
    } finally {
      busy.release();
      field.readOnly = false;
      sync();
    }
  }

  const sheet = h("section", { class: "sheet", role: "dialog", "aria-modal": "true", "aria-label": o.title },
    h("h2", { class: "sheet-title" }, o.title), h("p", { class: "sheet-hint" }, noWidow(o.hint)), field,
    h("div", { class: "sheet-meta" }, h("span", { class: "sheet-min" }, t("sheet_min", { min: o.min })), count), error, send);
  const veil: HTMLElement = h("div", { class: "sheet-veil", onclick: (e: Event) => { if (e.target === veil) dismiss(); } }, sheet);
  const onKey = (e: KeyboardEvent): void => { if (e.key === "Escape" || e.key === "Esc") dismiss(); };

  function teardown(): void {
    if (!open) return;
    open = false;
    if (dismissOpen === dismiss) dismissOpen = null;
    setBack(prevBack);
    document.removeEventListener("keydown", onKey);
    document.documentElement.classList.remove("sheet-open");
    if (veil.parentNode) veil.parentNode.removeChild(veil);
    if (opener && document.body.contains(opener)) opener.focus();
  }
  // Пока запрос идёт, шторка не закрывается: принятая сервером отмена иначе осталась бы без перезагрузки.
  function dismiss(): void {
    if (!open || !busy.take()) return;
    busy.release();
    teardown();
  }

  sync();
  document.body.appendChild(veil);
  document.documentElement.classList.add("sheet-open");
  document.addEventListener("keydown", onKey);
  const prevBack = setBack(dismiss);
  dismissOpen = dismiss;
  try { field.focus(); } catch { /* ничего */ }
}
