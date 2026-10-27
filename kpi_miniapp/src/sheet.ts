// Шторка спора снизу: заголовок, подсказка, поле причины со счётчиком, ошибка под полем.
// Отправляет Telegram MainButton (решение 15): активна, только когда в причине не меньше
// reason_min букв или цифр (reasonCount, как считает сервер). На время запроса — защёлка и
// showProgress: второе нажатие не отправит второй спор и не покажет «Спор уже открыт» после
// успеха (Review Focus 5). Успех — вибро успеха, шторка закрывается, экран перезагружается
// (onDone). Ошибка — вибро ошибки и текст под полем (disputeErrorText из view/review.ts).
//
// «Назад» Telegram при открытой шторке закрывает её (решение 5): шторка ставит свой
// обработчик поверх экранного и при закрытии возвращает прежний. При закрытии снимаются
// обработчик MainButton, прогресс и сама кнопка.
//
// Шторка висит на <body>, вне #app: перерисовка экрана её не трогает. Уход с экрана
// закрывает её из роутера (closeDisputeSheet), иначе осталась бы MainButton без экрана.
import type { TgDisputeCreated } from "@backend/modules/kpi/tg-app/types";
import { appApi } from "./api";
import { STATUS_TEXT, lang, t } from "./i18n";
import { rerender } from "./nav";
import { haptic, webApp } from "./telegram";
import { h, noWidow, setBack } from "./ui";
import { latch, reasonCount } from "./util";
import { disputeErrorText } from "./view/review";

export interface DisputeSheetOptions {
  subject_type: "review" | "violation";
  subject_id: string;
  title: string;
  reasonMin: number;
  onDone(): void;
}

// После этих ответов спорить дальше нечего: кнопка гаснет, а закрытие шторки перезагружает
// экран, чтобы «Оспорить» сменилась строкой о споре или сроке.
const FINAL = ["dispute_exists", "dispute_rejected", "dispute_window_closed", "period_closed", "already_cancelled", "not_found"];

// Черновик причины живёт до успешной отправки: случайно закрытая шторка возвращает текст.
const drafts = new Map<string, string>();

// Закрыть открытую шторку без перезагрузки (уход с экрана); null — шторки нет.
let dismissOpen: (() => void) | null = null;

/** Роутер уходит с экрана или перерисовывает его: открытая шторка закрывается молча. */
export function closeDisputeSheet(): void {
  if (dismissOpen) dismissOpen();
}

/** Кнопка отправки: MainButton Telegram, а в клиенте без неё — обычная кнопка в шторке. */
interface SendControl {
  active(on: boolean): void;
  progress(on: boolean): void;
  dispose(): void;
  node: HTMLElement | null;
}

function viaMainButton(onSend: () => void): SendControl | null {
  const mb = webApp()?.MainButton;
  if (!mb) return null;
  // Старые клиенты бросают на незнакомых вызовах: кнопка тогда просто не меняется.
  const safe = (f: () => void): void => {
    try {
      f();
    } catch {
      // ничего
    }
  };
  try {
    mb.setText(t("sheet_send"));
    mb.disable();
    mb.onClick(onSend);
    mb.show();
  } catch {
    // Кнопка в шторке заменит MainButton: обработчик, если успел встать, снимаем, а то нажатие
    // MainButton отправило бы спор мимо кнопки шторки. offClick и hide на таком клиенте тоже
    // могут бросить — поэтому через safe.
    safe(() => mb.offClick(onSend));
    safe(() => mb.hide());
    return null;
  }
  return {
    active: (on) => safe(() => (on ? mb.enable() : mb.disable())),
    progress: (on) => safe(() => (on ? mb.showProgress() : mb.hideProgress())),
    dispose: () =>
      safe(() => {
        mb.offClick(onSend);
        mb.hideProgress();
        mb.hide();
      }),
    node: null,
  };
}

function viaButton(onSend: () => void): SendControl {
  const b = h("button", { type: "button", class: "btn btn-primary sheet-send", disabled: true, onclick: onSend }, t("sheet_send")) as HTMLButtonElement;
  return {
    active: (on) => {
      b.disabled = !on;
    },
    progress: (on) => {
      b.disabled = on;
      b.setAttribute("aria-busy", on ? "true" : "false");
    },
    dispose: () => undefined,
    node: b,
  };
}

let seq = 0;

export function openDisputeSheet(o: DisputeSheetOptions): void {
  closeDisputeSheet();
  const id = `sheet-${++seq}`;
  const draftKey = `${o.subject_type}:${o.subject_id}`;
  const opener = document.activeElement as HTMLElement | null;
  // Экран, на котором открыта шторка: принятый спор перезагружает только его (см. ответ ниже).
  const openedOn = location.hash;
  const busy = latch();
  let open = true;
  // Ответ сделал спор невозможным (уже открыт, срок прошёл…): закрытие перезагрузит экран.
  let settled = false;

  const field = h("textarea", {
    id: `${id}-reason`,
    class: "sheet-field",
    rows: "4",
    placeholder: t("sheet_placeholder"),
    "aria-labelledby": `${id}-title`,
    "aria-describedby": `${id}-hint ${id}-min ${id}-error`,
  }) as HTMLTextAreaElement;
  field.value = drafts.get(draftKey) ?? "";
  const count = h("span", { class: "sheet-count", "aria-hidden": "true" });
  const error = h("p", { id: `${id}-error`, class: "sheet-error", role: "alert" });

  const onSend = (): void => {
    if (!open || settled) return;
    const reason = field.value;
    // Клиент, пропустивший нажатие неактивной кнопки, сюда не дойдёт с короткой причиной.
    if (reasonCount(reason) < o.reasonMin) {
      haptic("error");
      error.textContent = noWidow(disputeErrorText("comment_required", o.reasonMin));
      return;
    }
    if (!busy.take()) return;
    error.textContent = "";
    field.readOnly = true;
    ctl.progress(true);
    void appApi()
      .send<TgDisputeCreated>("POST", "/disputes", { subject_type: o.subject_type, subject_id: o.subject_id, reason })
      .then((res) => {
        // Шторку уже закрыл роутер, пока шёл запрос: ушли с экрана или экран перерисовался
        // (перерисовка без скелетона, начатая до отправки, вернулась раньше ответа). Ответ в
        // шторке показывать некому — без вибро и текста. Но принятый спор нужно довести: черновик
        // больше не нужен, а тот же экран перезагрузить, иначе на нём осталась бы «Оспорить» со
        // старыми данными и повторная отправка получила бы 409. Чужой экран не трогаем: onDone —
        // перерисовка текущего экрана, а другой экран и так загрузил свежие данные.
        if (!open) {
          if (res.kind === "ok") {
            drafts.delete(draftKey);
            if (location.hash === openedOn) o.onDone();
          }
          return;
        }
        if (res.kind === "ok") {
          haptic("success");
          drafts.delete(draftKey);
          teardown();
          o.onDone();
          return;
        }
        // Сессия, привязка, роль сотрудника: такое разбирает роутер — экран заново покажет отказ
        // или отправит на главный (403 not_employee). Без сети шторка остаётся с текстом.
        if ((res.kind === "fail" && res.status !== "offline") || (res.kind === "http" && res.error === "not_employee")) {
          drafts.set(draftKey, field.value);
          teardown();
          rerender();
          return;
        }
        haptic("error");
        if (res.kind === "fail") error.textContent = noWidow(STATUS_TEXT.offline[lang()]);
        else {
          const m = (res.body as { min?: unknown } | null)?.min;
          error.textContent = noWidow(disputeErrorText(res.error, typeof m === "number" ? m : o.reasonMin));
          if (res.error !== null && FINAL.indexOf(res.error) >= 0) settled = true;
        }
        unlock();
      })
      .catch(() => {
        // Отказ send (он сам не отклоняется, но мало ли) или исключение в обработке ответа:
        // шторка не должна остаться с защёлкой и крутящейся кнопкой. Шторку уже закрыли —
        // показывать некому.
        if (!open) return;
        haptic("error");
        error.textContent = noWidow(disputeErrorText(null, o.reasonMin));
        unlock();
      });
  };

  // После ответа без успеха: прогресс снят, поле снова правится, защёлка отпущена.
  function unlock(): void {
    ctl.progress(false);
    // hideProgress Telegram снова делает кнопку активной: состояние ставим сами.
    ctl.active(!settled && reasonCount(field.value) >= o.reasonMin);
    field.readOnly = false;
    busy.release();
  }

  const ctl = viaMainButton(onSend) ?? viaButton(onSend);

  const sync = (): void => {
    const n = reasonCount(field.value);
    count.textContent = `${Math.min(n, o.reasonMin)} / ${o.reasonMin}`;
    count.className = n >= o.reasonMin ? "sheet-count is-ok" : "sheet-count";
    ctl.active(!settled && n >= o.reasonMin);
  };
  field.addEventListener("input", () => {
    // Правка причины снимает прошлую ошибку, кроме окончательной.
    if (!settled) error.textContent = "";
    sync();
  });

  const sheet = h(
    "section",
    { class: "sheet", role: "dialog", "aria-modal": "true", "aria-labelledby": `${id}-title` },
    h("h2", { id: `${id}-title`, class: "sheet-title" }, o.title),
    h("p", { id: `${id}-hint`, class: "sheet-hint" }, noWidow(t("sheet_hint"))),
    field,
    h("div", { class: "sheet-meta" }, h("span", { id: `${id}-min`, class: "sheet-min" }, t("sheet_min", { min: o.reasonMin })), count),
    error,
    ctl.node,
  );
  const veil = h(
    "div",
    {
      class: "sheet-veil",
      // Тап по затемнению — как «назад»; по самой шторке — нет.
      onclick: (e: Event) => {
        if (e.target === veil) dismiss();
      },
    },
    sheet,
  );

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape" || e.key === "Esc") dismiss();
  };

  // Закрыть всё, что шторка поставила: MainButton, «назад», слушатели, сам узел.
  function teardown(): void {
    if (!open) return;
    open = false;
    if (dismissOpen === silent) dismissOpen = null;
    ctl.dispose();
    setBack(prevBack);
    document.removeEventListener("keydown", onKey);
    document.documentElement.classList.remove("sheet-open");
    if (veil.parentNode) veil.parentNode.removeChild(veil);
    if (opener && document.body.contains(opener)) opener.focus();
  }

  // «Назад», тап по затемнению, Esc. Пока спор отправляется, шторка не закрывается: иначе
  // принятый сервером спор остался бы без перезагрузки экрана.
  function dismiss(): void {
    if (!open || !busy.take()) return;
    busy.release();
    if (field.value.trim() !== "") drafts.set(draftKey, field.value);
    else drafts.delete(draftKey);
    teardown();
    if (settled) o.onDone();
  }

  // Уход с экрана или его перерисовка (роутер): черновик сохраняем, экран не перезагружаем — его
  // и так сменят. Спор, уже ушедший на сервер, доводит ответ запроса (ветка !open выше).
  function silent(): void {
    if (!open) return;
    if (field.value.trim() !== "") drafts.set(draftKey, field.value);
    teardown();
  }

  sync();
  document.body.appendChild(veil);
  document.documentElement.classList.add("sheet-open");
  document.addEventListener("keydown", onKey);
  const prevBack = setBack(dismiss);
  dismissOpen = silent;
  // Фокус в поле в том же нажатии «Оспорить»: клавиатура поднимается сразу (iOS иначе не даст).
  try {
    field.focus();
  } catch {
    // ничего
  }
}
