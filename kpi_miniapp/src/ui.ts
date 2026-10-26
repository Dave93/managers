// DOM-помощники, экраны отказа, скелетоны, пометка «нет связи», подсказка о плохой
// связи и Telegram BackButton.
//
// Строки с сервера попадают в DOM только текстом: h() превращает строковых детей в
// текстовые узлы, значения атрибутов ставит через setAttribute. Разметку строкой
// этот модуль не собирает вовсе, значки тоже строятся узлами.
import type { FailStatus } from "./api";
import { hhmm } from "./format";
import { DICT, STATUS_TEXT, lang, t } from "./i18n";
import { webApp } from "./telegram";
import { noWidow } from "./util";

type Attrs = Record<string, string | boolean | EventListener>;

/**
 * Элемент с атрибутами и детьми. Ключи «on…» — только функции-обработчики: строка там
 * стала бы встроенным скриптом, поэтому h() её не принимает (как и функцию под другим
 * ключом). true — пустой атрибут; false — атрибута нет.
 */
export function h(tag: string, attrs?: Attrs, ...kids: (Node | string | null)[]): HTMLElement {
  const el = document.createElement(tag);
  if (attrs) {
    for (const k of Object.keys(attrs)) {
      const v = attrs[k];
      if (v === false) continue;
      const handler = /^on/i.test(k);
      if (handler !== (typeof v === "function")) throw new TypeError(`h(${tag}): «${k}» — обработчик только функцией и только под ключом on…`);
      if (typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v === true) el.setAttribute(k, "");
      else if (typeof v === "string") el.setAttribute(k, v);
    }
  }
  for (const kid of kids) {
    if (kid === null) continue;
    el.appendChild(typeof kid === "string" ? document.createTextNode(kid) : kid);
  }
  return el;
}

// ---------- значки ----------

const SVG_NS = "http://www.w3.org/2000/svg";
type Shape = [string, Record<string, string>];
const path = (d: string): Shape => ["path", { d }];
const circle: Shape = ["circle", { cx: "12", cy: "12", r: "9.25" }];

// Контурные 24×24, обводка 1,75: так рисуют Lucide (ISC) и системные значки Android.
const ICONS: Record<FailStatus | "chevron" | "external", Shape[]> = {
  // «Обновите»: стрелки по кругу.
  sdk_failed: [path("M20 12a8 8 0 0 1-13.66 5.66L4 15.5"), path("M4 12a8 8 0 0 1 13.66-5.66L20 8.5"), path("M20 4v4.5h-4.5"), path("M4 20v-4.5h4.5")],
  // «Откройте из бота»: бумажный самолётик.
  outside: [path("M21 3 10.5 13.5"), path("M21 3l-6.5 18-4-7.5L3 9.5z")],
  // «Нужна ссылка-приглашение»: разорванное звено.
  not_bound: [path("M9 17H7a5 5 0 0 1 0-10h2"), path("M15 7h2a5 5 0 0 1 4.2 7.7"), path("M8 12h3"), path("M3 3l18 18")],
  // «Доступ закрыт»: замок.
  inactive: [["rect", { x: "4.5", y: "10.5", width: "15", height: "10.5", rx: "2" }], path("M8 10.5V7.5a4 4 0 0 1 8 0v3")],
  // «Не настроено на сервере»: гаечный ключ.
  not_configured: [path("M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.4-3.4a6 6 0 0 1-7.9 7.9l-6.4 6.4a2.1 2.1 0 0 1-3-3l6.4-6.4a6 6 0 0 1 7.9-7.9z")],
  // «Сессия устарела»: часы.
  expired: [circle, path("M12 7v5l3 2")],
  // «Нет связи»: перечёркнутый wifi.
  offline: [
    path("M12 20h.01"),
    path("M8.5 16.43a5 5 0 0 1 7 0"),
    path("M5 12.86a10 10 0 0 1 5.17-2.69"),
    path("M19 12.86a10 10 0 0 0-2.01-1.52"),
    path("M2 8.82a15 15 0 0 1 4.18-2.64"),
    path("M22 8.82a15 15 0 0 0-11.29-3.76"),
    path("M2 2l20 20"),
  ],
  // «Что-то пошло не так»: восклицание в круге.
  unknown: [circle, path("M12 7.5v5"), path("M12 16.25h.01")],
  chevron: [path("M9.5 6l6 6-6 6")],
  // Ссылка уходит из приложения (админка в браузере): стрелка из рамки.
  external: [path("M14 4h6v6"), path("M20 4l-9 9"), path("M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10")],
};

function icon(name: keyof typeof ICONS, cls: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  const base: Record<string, string> = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "1.75",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
    focusable: "false",
    class: cls,
  };
  for (const k of Object.keys(base)) svg.setAttribute(k, base[k] as string);
  for (const [tag, a] of ICONS[name]) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const k of Object.keys(a)) el.setAttribute(k, a[k] as string);
    svg.appendChild(el);
  }
  return svg;
}

/** Шеврон «›» в конце строки-ссылки. */
export function chevron(): SVGSVGElement {
  return icon("chevron", "chev");
}

/** Значок «откроется вне приложения» у ссылки в админку. */
export function externalIcon(): SVGSVGElement {
  return icon("external", "ext");
}

// ---------- монтирование ----------

/** Экран в #app. Статический скелетон старта (#boot) снимается при первом вызове. */
export function mount(view: Node): void {
  const boot = document.getElementById("boot");
  if (boot && boot.parentNode) boot.parentNode.removeChild(boot);
  const app = document.getElementById("app");
  if (!app) return;
  while (app.firstChild) app.removeChild(app.firstChild);
  app.appendChild(view);
}

/** То, что сейчас на экране: скелетон старта или содержимое #app. */
function visible(): Element | null {
  return document.getElementById("boot") ?? document.getElementById("app")?.firstElementChild ?? null;
}

/** На экране уже скелетон этого вида — второй ставить незачем (и подсказку старта не сбросить). */
export function showingSkeleton(kind: "home" | "list"): boolean {
  const v = visible();
  const sk = v && (v.hasAttribute("data-skeleton") ? v : v.querySelector("[data-skeleton]"));
  return !!sk && sk.getAttribute("data-skeleton") === kind;
}

// ---------- отказы ----------

/**
 * Строка отказа крупным кеглем: слово с дефисом («ссылку-приглашение») не рвётся на дефисе —
 * оно в span без переноса, а последнее слово не остаётся одно («…havolasini» / «soʻrang»).
 */
function statusSay(text: string): (Node | string)[] {
  return noWidow(text)
    .split(/(\S+-\S+)/)
    .filter((x) => x !== "")
    .map((x) => (/\S-\S/.test(x) ? h("span", { class: "nobr" }, x) : x));
}

function statusLine(l: "ru" | "uz", text: string): HTMLElement {
  return h(
    "span",
    { class: "status-line", lang: l },
    h("span", { class: "status-tag", "aria-hidden": "true" }, l.toUpperCase()),
    h("span", { class: "status-say" }, ...statusSay(text)),
  );
}

/**
 * Экран отказа на двух языках (язык до ответа сервера неизвестен). Кнопка — только если
 * передано действие: «Повторить / Qayta urinish» при offline и unknown, «Обновить /
 * Yangilash» при sdk_failed (перезагрузка заново просит SDK у telegram.org).
 */
export function statusScreen(s: FailStatus, retry?: () => void): HTMLElement {
  const text = STATUS_TEXT[s];
  const label = s === "sdk_failed" ? "btn_reload" : s === "offline" || s === "unknown" ? "btn_retry" : null;
  let pressed = false;
  const button =
    retry && label
      ? h(
          "button",
          {
            type: "button",
            class: "btn btn-primary status-retry",
            onclick: () => {
              // Двойное нажатие не запускает два входа.
              if (pressed) return;
              pressed = true;
              retry();
            },
          },
          h("span", { lang: "ru" }, DICT.ru[label]),
          h("span", { class: "sep", "aria-hidden": "true" }, " · "),
          h("span", { lang: "uz" }, DICT.uz[label]),
        )
      : null;
  return h(
    "main",
    { class: "status", "data-status": s },
    h(
      "div",
      { class: "status-body" },
      icon(s, "status-icon"),
      h("h1", { class: "status-msg" }, statusLine("ru", text.ru), statusLine("uz", text.uz)),
      button,
    ),
  );
}

// ---------- скелетоны ----------

const bone = (cls: string): HTMLElement => h("span", { class: `sk ${cls}` });

/**
 * Окончательная раскладка экрана с брусками вместо значений. «home» повторяет
 * статический скелетон в index.html — их держать одинаковыми.
 */
export function skeleton(kind: "home" | "list"): HTMLElement {
  const kids =
    kind === "home"
      ? [
          h("div", { class: "sk-who" }, bone("sk-avatar"), h("span", { class: "sk-who-text" }, bone("sk-name"), bone("sk-sub")), bone("sk-lang")),
          h(
            "div",
            { class: "card" },
            h("div", { class: "sk-head" }, bone("sk-label"), bone("sk-chip")),
            bone("sk-score"),
            bone("sk-line"),
            h(
              "div",
              { class: "sk-lost" },
              bone("sk-lost-title"),
              h("div", { class: "sk-lost-row" }, bone("sk-text"), bone("sk-num")),
              h("div", { class: "sk-lost-row" }, bone("sk-text sk-w2"), bone("sk-num")),
            ),
            bone("sk-btn"),
          ),
          h(
            "div",
            { class: "card" },
            h("div", { class: "sk-head" }, bone("sk-label sk-w2"), bone("sk-chip")),
            h("div", { class: "sk-scale" }, bone("sk-track"), h("div", { class: "sk-ticks" }, bone("sk-tick"), bone("sk-tick"), bone("sk-tick"))),
            h("div", { class: "sk-tiles" }, bone("sk-tile"), bone("sk-tile"), bone("sk-tile")),
            h("div", { class: "sk-hint" }, bone("sk-line"), bone("sk-line")),
          ),
          h("div", { class: "card sk-rows" }, h("div", { class: "sk-rowline" }, bone("sk-text")), h("div", { class: "sk-rowline" }, bone("sk-text sk-w3"))),
        ]
      : [
          bone("sk-title"),
          h(
            "div",
            { class: "card" },
            ...[0, 1, 2, 3].map(() => h("div", { class: "sk-item" }, h("div", { class: "sk-head" }, bone("sk-text"), bone("sk-num")), bone("sk-note"))),
          ),
        ];
  return h("div", { class: "screen", "data-skeleton": kind, "aria-hidden": "true" }, ...kids);
}

// ---------- медленная связь ----------

/**
 * Плашка «Связь плохая, ещё пробуем». later — проявиться через 8 с (CSS), иначе сразу.
 * Двуязычная до входа, на языке пользователя — после.
 */
export function slowHint(lines: ["ru" | "uz", string][], later: boolean): HTMLElement {
  return h(
    "p",
    { class: `slow ${later ? "slow-later" : "slow-now"}`, role: "status" },
    h("span", { class: "slow-dots", "aria-hidden": "true" }, h("i"), h("i"), h("i")),
    h("span", { class: "slow-text" }, ...lines.map(([l, text]) => h("span", { lang: l }, text))),
  );
}

/** Ответа нет 8 с: подсказка под текущим экраном, если её там ещё нет. */
export function showSlow(): void {
  const v = visible();
  if (!v || v.querySelector(".slow")) return;
  v.appendChild(slowHint([[lang(), t("slow")]], false));
}

// ---------- нет связи ----------

// noWidow живёт в util.ts (чистый, с тестом); экраны берут его отсюда, как прежде.
export { noWidow };

/** «Обновлено в 14:02 — нет связи» над последним сохранённым ответом. retry — кнопка «Повторить». */
export function staleBanner(at: number, retry?: () => void): HTMLElement {
  const button = retry
    ? h(
        "button",
        {
          type: "button",
          class: "stale-retry",
          onclick: (e: Event) => {
            const b = e.currentTarget as HTMLButtonElement;
            if (b.disabled) return;
            b.disabled = true;
            b.className += " is-busy";
            retry();
          },
        },
        t("btn_retry"),
      )
    : null;
  return h(
    "div",
    { class: "stale", role: "status" },
    icon("offline", "stale-icon"),
    h("span", { class: "stale-text" }, noWidow(t("offline_stamp", { time: hhmm(at) }))),
    button,
  );
}

// ---------- «назад» ----------

let backHandler: (() => void) | null = null;

/**
 * Telegram BackButton: виден с обработчиком, скрыт при null. Прежний обработчик снимается и
 * возвращается: шторка ставит свой «назад» поверх экранного и при закрытии отдаёт его обратно.
 */
export function setBack(onBack: (() => void) | null): (() => void) | null {
  const prev = backHandler;
  const bb = webApp()?.BackButton;
  if (!bb) return prev;
  try {
    if (backHandler) bb.offClick(backHandler);
    backHandler = onBack;
    if (onBack) {
      bb.onClick(onBack);
      bb.show();
    } else bb.hide();
  } catch {
    // Старый клиент без BackButton: назад ведёт системная кнопка Telegram.
  }
  return prev;
}
