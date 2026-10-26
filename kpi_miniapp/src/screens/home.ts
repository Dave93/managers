// Главный экран: рисует HomeVM (view/home.ts). Порядок блоков — макет
// home-layout-v3.html: шапка с RU/UZ, карточка оценщика, неоценённый месяц, оценённый
// месяц, прибавка, строки-ссылки.
//
// Оттенок Telegram (button_color) — только на главном элементе данных: заливка шкалы до
// среднего, точка среднего и рамка отчётного месяца в строке квартала. Текст поверх
// него не ставится: #2481cc на белом — 4,3:1, ниже AA для мелкого текста.
//
// Строки с сервера (имя, должность, филиал, названия пунктов) попадают в DOM только
// текстом через h().
import type { TgHome, TgLang, TgLangResponse } from "@backend/modules/kpi/tg-app/types";
import { appApi } from "../api";
import { DICT, lang, t } from "../i18n";
import { navigate, rerender, useLang } from "../nav";
import { parseHash } from "../route";
import { haptic, webApp } from "../telegram";
import { latch } from "../util";
import type { HomeVM } from "../view/home";
import { chevron, externalIcon, h, noWidow } from "../ui";

// ---------- общие куски ----------

/** Число не отрывается от следующего слова («7 ноября», «4 сотрудников»), последнее слово — от предыдущего. */
const tie = (s: string): string => noWidow(s.replace(/(\d) (?=\S)/g, "$1\u00a0"));

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

function linkRow(text: string, end: string | null, hash: string): HTMLElement {
  return inAppLink(
    hash,
    "row",
    h("span", { class: "row-body" }, h("span", { class: "row-text" }, text), end === null ? null : h("span", { class: "row-end" }, end), chevron()),
  );
}

// ---------- язык ----------

const LANGS: { code: TgLang; label: string; name: string }[] = [
  { code: "ru", label: "RU", name: "Русский" },
  { code: "uz", label: "UZ", name: "Oʻzbekcha" },
];

/**
 * Переключатель RU/UZ (решение 16): PUT /lang, язык из ответа, перерисовка текущего
 * экрана. Без сети — вибро ошибки и всё как было; прочий отказ разбирает перерисовка
 * (повторный вход покажет «сессия устарела» или «доступ закрыт»).
 */
function langSwitch(): HTMLElement {
  const busy = latch();
  const current = lang();
  const group = h("div", { class: "lang", role: "group", "aria-label": `${DICT.ru.lang_label} · ${DICT.uz.lang_label}` });
  for (const o of LANGS) {
    const on = o.code === current;
    const btn = h(
      "button",
      {
        type: "button",
        class: on ? "lang-opt is-on" : "lang-opt",
        lang: o.code,
        "aria-pressed": on ? "true" : "false",
        // Имя для чтения с экрана начинается с видимой надписи (WCAG 2.5.3): «RU — Русский».
        "aria-label": `${o.label} — ${o.name}`,
        onclick: () => {
          if (on || !busy.take()) return;
          btn.className += " is-busy";
          group.setAttribute("aria-busy", "true");
          void appApi()
            .send<TgLangResponse>("PUT", "/lang", { lang: o.code })
            .then((res) => {
              if (res.kind === "ok") {
                useLang(res.data.lang);
                rerender();
                return;
              }
              if (res.kind === "fail" && res.status !== "offline") {
                rerender();
                return;
              }
              haptic("error");
              btn.className = btn.className.replace(" is-busy", "");
              group.removeAttribute("aria-busy");
              busy.release();
            });
        },
      },
      h("span", { class: "lang-pill" }, o.label),
    );
    group.appendChild(btn);
  }
  return group;
}

// ---------- блоки ----------

function whoBlock(v: NonNullable<HomeVM["header"]>): HTMLElement {
  return h(
    "header",
    { class: "who" },
    h("span", { class: "who-avatar", "aria-hidden": "true" }, v.initials),
    h("div", { class: "who-text" }, h("h1", { class: "who-name" }, v.name), v.sub ? h("p", { class: "who-sub" }, v.sub) : null),
    langSwitch(),
  );
}

/** Только http(s): адрес приходит с сервера, javascript: в href не попадёт. */
const safeUrl = (u: string | null): string | null => (u && /^https?:\/\//i.test(u) ? u : null);

function evaluatorBlock(v: NonNullable<HomeVM["evaluator"]>, alone: boolean): HTMLElement {
  const url = safeUrl(v.link);
  // Для одного оценщика ссылка в админку — главное действие экрана; рядом с карточками
  // сотрудника главное — «Вся оценка», и ссылка тише.
  const link = url
    ? h(
        "a",
        {
          class: `btn ${alone ? "btn-primary" : "btn-quiet"} eval-link`,
          href: url,
          target: "_blank",
          rel: "noopener noreferrer",
          onclick: (e: Event) => {
            // Решение 14: внешняя ссылка — через Telegram, чтобы открылся браузер, а не WebView.
            const open = webApp()?.openLink;
            if (!open) return;
            e.preventDefault();
            open(url);
          },
        },
        h("span", { class: "eval-link-text" }, t("eval_link")),
        externalIcon(),
      )
    : null;
  const text = h(alone ? "h1" : "h2", { class: "eval-text" }, tie(v.text));
  return h(
    "section",
    { class: "card eval" },
    // Без шапки сотрудника переключатель языка живёт здесь.
    alone ? h("div", { class: "eval-top" }, text, langSwitch()) : text,
    link,
  );
}

function pendingBlock(v: NonNullable<HomeVM["pending"]>): HTMLElement {
  return h(
    "section",
    { class: "card card-split pending" },
    h("div", { class: "card-body" }, h("h2", { class: "card-title" }, v.title), h("p", { class: "card-line" }, tie(v.when))),
    linkRow(v.violations, null, v.hash),
  );
}

function monthBlock(v: NonNullable<HomeVM["month"]>): HTMLElement {
  const dash = v.score === "—";
  // Без балла нет ни потерь, ни «все на максимуме» (lostNone тогда false): блока нет.
  const lost = v.lostNone
    ? h("p", { class: "lost-none" }, t("lost_none"))
    : v.lost.length
      ? h(
          "div",
          { class: "lost" },
          h("h3", { class: "lost-title" }, t("lost_title")),
          h("ul", { class: "lost-list" }, ...v.lost.map((x) => h("li", { class: "lost-item" }, h("span", { class: "lost-name" }, x.title), h("span", { class: "lost-score" }, x.score)))),
        )
      : null;
  return h(
    "section",
    { class: "card month" },
    h("div", { class: "card-head" }, h("h2", { class: "card-title" }, v.title), h("span", { class: `chip chip-${v.chip.tone}` }, v.chip.text)),
    h("p", { class: dash ? "figure month-score is-empty" : "figure month-score" }, v.score, dash ? null : h("small", undefined, "\u00a0%")),
    v.disputeLine ? h("p", { class: "card-line month-dispute" }, tie(v.disputeLine)) : null,
    lost,
    inAppLink(v.hash, "btn btn-primary month-open", t("btn_full")),
  );
}

const BADGE_CHIP = { prelim: "chip-wait", ok: "chip-ok", muted: "chip-muted" } as const;

/** Подпись маркера не вылезает за карточку: у краёв шкалы она прижата к краю, а не по центру. */
const anchor = (at: number): string => (at < 0.12 ? "at-start" : at > 0.88 ? "at-end" : "at-mid");
const pc = (at: number): string => `${(at * 100).toFixed(2)}%`;
/**
 * Позиция точки среднего и её подписи: у краёв точка (18 px) остаётся в пределах дорожки,
 * как бегунок, а не вылезает на 9 px за край колонки (100 % — край точки на краю дорожки, вровень
 * с плитками месяцев). clamp() старый WebView не знает: тогда остаётся первое объявление.
 */
const dotLeft = (at: number): string => `left:${pc(at)};left:clamp(9px,${pc(at)},calc(100% - 9px))`;

function trackBlock(v: NonNullable<HomeVM["raise"]>): HTMLElement {
  const m = v.marker;
  // Для чтения с экрана — одной фразой: «Средний 91,4 %; 85 % — 150 тыс; …». Ни среднего, ни
  // ступеней — сказать нечего: пустая полоса скрыта от чтения, а не картинка без имени.
  const said = [m ? `${t("hist_avg")} ${m.label}` : null, ...v.ticks.map((x) => `${x.pct} — ${x.amount}`)].filter((x): x is string => x !== null).join("; ");
  const a11y: Record<string, string> = said ? { role: "img", "aria-label": said } : { "aria-hidden": "true" };
  return h(
    "div",
    { class: m ? "scale" : "scale is-empty", ...a11y },
    m ? h("span", { class: `scale-me ${anchor(m.at)}`, style: dotLeft(m.at) }, m.label) : null,
    h(
      "div",
      { class: "scale-track" },
      m ? h("span", { class: "scale-fill", style: `width:${pc(m.at)}` }) : null,
      ...v.ticks.map((x) => h("span", { class: "scale-tick", style: `left:${pc(x.at)}` })),
      m ? h("span", { class: "scale-dot", style: dotLeft(m.at) }) : null,
    ),
    h(
      "div",
      { class: "scale-labels", "aria-hidden": "true" },
      ...v.ticks.map((x) => h("span", { class: "scale-label", style: `left:${pc(x.at)}` }, h("b", undefined, x.pct), h("span", undefined, x.amount))),
    ),
  );
}

function raiseBlock(v: NonNullable<HomeVM["raise"]>): HTMLElement {
  return h(
    "section",
    { class: "card raise" },
    h("div", { class: "card-head" }, h("h2", { class: "card-title" }, v.title), h("span", { class: `chip ${BADGE_CHIP[v.badge.tone]}` }, v.badge.text)),
    trackBlock(v),
    h(
      "ol",
      { class: "months" },
      ...v.months.map((x) => {
        // Балл — ровно вид pct1 («91,4», «100,0»); «20.12 dan» и «не оценён» — пометки состояния.
        const score = /^\d{1,3},\d$/.test(x.value);
        return h(
          "li",
          { class: x.current ? "mtile is-current" : "mtile", "aria-current": x.current ? "date" : false },
          h("span", { class: "mtile-label" }, x.label),
          h("span", { class: score ? "mtile-value" : "mtile-value is-state" }, x.value),
        );
      }),
    ),
    v.lines.length ? h("div", { class: "hint" }, ...v.lines.map((x) => h("p", { class: "hint-line" }, tie(x)))) : null,
  );
}

// ---------- экран ----------

export function renderHome(vm: HomeVM, d: TgHome): HTMLElement {
  // Только оценщик: шапки сотрудника нет, язык переключается в его карточке.
  const evaluatorOnly = d.employee === null;
  return h(
    "main",
    { class: "screen home" },
    vm.header ? whoBlock(vm.header) : null,
    vm.evaluator ? evaluatorBlock(vm.evaluator, evaluatorOnly) : null,
    vm.pending ? pendingBlock(vm.pending) : null,
    vm.month ? monthBlock(vm.month) : null,
    vm.raise ? raiseBlock(vm.raise) : null,
    vm.noCard ? h("p", { class: "card nocard" }, tie(t("no_card"))) : null,
    vm.links.length ? h("nav", { class: "card rows" }, ...vm.links.map((x) => linkRow(x.text, x.count, x.hash))) : null,
  );
}
