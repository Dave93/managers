// Старт и роутер мини-приложения «Мой KPI».
//
// Старт (решения 2, 3, 12): dev-флаг → SDK (нет объекта — «не загрузился Telegram»,
// пустой initData — «откройте из бота») → тема, ready(), expand() → вход. Сбой сети
// при сохранённом главном экране — он же с пометкой «нет связи»; 403 not_bound и
// inactive стирают кэш этого человека; прочее — экран отказа.
//
// Роутер (решения 4, 5, 18): стек внутри приложения, хеш — его вершина. «Назад» —
// Telegram BackButton, виден, когда стек глубже главного. Ссылка сразу на
// #/review/… кладёт главный экран под него. Без роли employee доступен только
// главный экран: остальные ответили бы 403 not_employee.
//
// navigate, back и rerender — объявления функций, не стрелки в const: экраны задач
// 5–7 импортируют их отсюда, а main.ts импортирует экраны (круговой импорт).
import type { TgHome, TgLang, TgRole } from "@backend/modules/kpi/tg-app/types";
import type { FailStatus } from "./api";
import { appApi } from "./api";
import { appCache } from "./cache";
import { devRequested } from "./dev/flag";
import { DICT, lang, monthName, setLang, t } from "./i18n";
import type { Loaded } from "./load";
import { loadScreen } from "./load";
import type { Route } from "./route";
import { hashOf, parseHash } from "./route";
import { applyTheme, sdkState, webApp } from "./telegram";
import { capFirst } from "./util";
import { chevron, h, mount, setBack, showSlow, showingSkeleton, skeleton, slowHint, staleBanner, statusScreen } from "./ui";

// Константа сборки из vite.config.ts (решение 1): true только под `vite serve`.
declare const __KPI_DEV__: boolean;

const HOME: Route = { name: "home" };

type Entry = { route: Route; y: number };
let stack: Entry[] = [{ route: HOME, y: 0 }];
let roles: TgRole[] = [];
// Номер показа: ответ, пришедший после ухода с экрана, выбрасывается.
let seq = 0;

// ---------- экраны ----------

interface Screen {
  path: string;
  kind: "home" | "list";
  render(data: unknown): HTMLElement;
}

// Заглушки до задач 5–7: заголовок маршрута, на главном — строки-ссылки.
function stub(title: string, ...rest: (Node | null)[]): HTMLElement {
  return h("main", { class: "screen" }, h("h1", { class: "title" }, title), ...rest);
}

function linkRow(text: string, end: string | null, to: Route): HTMLElement {
  return h(
    "a",
    {
      class: "row",
      href: hashOf(to),
      onclick: (e: Event) => {
        e.preventDefault();
        navigate(to);
      },
    },
    h("span", { class: "row-body" }, h("span", { class: "row-text" }, text), end === null ? null : h("span", { class: "row-end" }, end), chevron()),
  );
}

function homeStub(d: TgHome): HTMLElement {
  const e = d.employee;
  const rows = e
    ? h(
        "nav",
        { class: "card rows" },
        linkRow(t("link_viol", { month: monthName(e.violations.period, "prep", lang()) }), String(e.violations.count), {
          name: "violations",
          period: e.violations.period,
        }),
        linkRow(t("link_history"), null, { name: "history" }),
      )
    : null;
  return stub(t("app_title"), rows);
}

function screenOf(r: Route): Screen {
  switch (r.name) {
    case "home":
      return { path: "/home", kind: "home", render: (d) => homeStub(d as TgHome) };
    case "review":
      return { path: `/review?period=${r.period}`, kind: "list", render: () => stub(capFirst(monthName(r.period, "nom", lang()))) };
    case "violations":
      return {
        path: `/violations?period=${r.period}`,
        kind: "list",
        render: () => stub(t("viol_title", { month: monthName(r.period, "nom", lang()) })),
      };
    case "history":
      return { path: "/history", kind: "list", render: () => stub(t("link_history")) };
  }
}

// ---------- язык и роли ----------

function useLang(l: TgLang): void {
  setLang(l);
  document.documentElement.setAttribute("lang", l);
}

// Главный экран приносит язык и роли: после смены языка или в работе без сети
// (старт из кэша) они берутся отсюда.
function adoptHome(d: TgHome): void {
  useLang(d.lang);
  roles = d.roles;
}

// ---------- роутер ----------

function top(): Entry {
  return stack[stack.length - 1] as Entry;
}

function same(a: Route, b: Route): boolean {
  return hashOf(a) === hashOf(b);
}

/** Решение 18: без роли employee любой маршрут, кроме главного, — главный, хеш — «#/». */
function guard(r: Route): Route {
  if (r.name === "home" || roles.indexOf("employee") >= 0) return r;
  if (location.hash !== "#/") history.replaceState(null, "", "#/");
  return HOME;
}

/** Вперёд: маршрут в стек и в location.hash. */
export function navigate(r: Route): void {
  const to = guard(r);
  if (same(to, top().route)) return;
  top().y = window.pageYOffset;
  stack.push({ route: to, y: 0 });
  // hashchange от этой записи увидит вершину стека и ничего не сделает.
  if (location.hash !== hashOf(to)) location.hash = hashOf(to);
  show(false);
}

/** Назад по стеку; с главного — остаться на главном. */
export function back(): void {
  if (stack.length > 1) stack.pop();
  history.replaceState(null, "", hashOf(top().route));
  show(false);
}

/** Текущий экран заново, без скелетона: старые данные видны, пока идёт запрос. */
export function rerender(): void {
  show(true);
}

// Хеш сменился не через navigate: ссылка href="#/…", «назад» браузера в dev, ручная правка.
function onHashChange(): void {
  const r = guard(parseHash(location.hash));
  if (same(r, top().route)) return;
  const prev = stack[stack.length - 2];
  if (prev && same(r, prev.route)) stack.pop();
  else {
    top().y = window.pageYOffset;
    stack.push({ route: r, y: 0 });
  }
  show(false);
}

function startRouter(): void {
  const r = guard(parseHash(location.hash));
  // Решение 5: открытое сразу на вложенном экране кладёт главный под него.
  stack = r.name === "home" ? [{ route: HOME, y: 0 }] : [{ route: HOME, y: 0 }, { route: r, y: 0 }];
  show(false);
}

function show(keep: boolean): void {
  void showAsync(keep);
}

async function showAsync(keep: boolean): Promise<void> {
  const my = ++seq;
  const entry = top();
  const sc = screenOf(entry.route);
  setBack(stack.length > 1 ? back : null);
  // Скелетон старта уже на месте: второй не ставим, подсказка старта продолжает отсчёт.
  if (!keep && !showingSkeleton(sc.kind)) mount(skeleton(sc.kind));
  const res = await loadScreen<unknown>(sc.path, () => {
    if (my === seq) showSlow();
  });
  if (my !== seq) return;
  // Перерисовка того же экрана остаётся там, где человек читал.
  if (keep) entry.y = window.pageYOffset;
  present(res, sc, entry);
}

function present(res: Loaded<unknown>, sc: Screen, entry: Entry): void {
  if (res.kind === "fresh" || res.kind === "stale") {
    if (entry.route.name === "home") adoptHome(res.data as TgHome);
    const view = sc.render(res.data);
    if (res.kind === "stale") view.insertBefore(staleBanner(res.at, rerender), view.firstChild);
    mount(view);
    window.scrollTo(0, entry.y);
    return;
  }
  // 404 и прочие ответы с кодом разбирают экраны задач 6–7.
  if (res.kind === "http") {
    mount(statusScreen("unknown", () => show(false)));
    return;
  }
  refuse(res.status);
}

/** Отказ посреди работы. Без сети и при сбое — «Повторить» и «назад»; остальное не восстановить. */
function refuse(s: FailStatus): void {
  if (s === "offline" || s === "unknown") {
    mount(statusScreen(s, () => show(false)));
    return;
  }
  stack = [{ route: HOME, y: 0 }];
  history.replaceState(null, "", hashOf(HOME));
  setBack(null);
  mount(statusScreen(s));
}

// ---------- старт ----------

async function start(): Promise<void> {
  const a = await appApi().auth();
  if (a.kind === "ok") {
    useLang(a.body.lang);
    roles = a.body.roles;
    startRouter();
    return;
  }
  if (a.status === "offline") {
    // Сети нет, но главный экран уже открывали: показываем его с пометкой времени.
    const cached = appCache().load<TgHome>("/home");
    if (cached) {
      stack = [{ route: HOME, y: 0 }];
      setBack(null);
      present({ kind: "stale", data: cached.data, at: cached.at }, screenOf(HOME), top());
      return;
    }
  }
  // Привязку сняли или человека уволили: его экраны с этого телефона стираются (решение 12).
  if (a.status === "not_bound" || a.status === "inactive") appCache().clear();
  mount(statusScreen(a.status, a.status === "offline" || a.status === "unknown" ? retryStart : undefined));
}

function retryStart(): void {
  // Снова как при открытии: скелетон и двуязычная подсказка через 8 с, язык ещё неизвестен.
  const sk = skeleton("home");
  sk.appendChild(slowHint([["ru", DICT.ru.slow], ["uz", DICT.uz.slow]], true));
  mount(sk);
  void start();
}

async function boot(): Promise<void> {
  // Dev-режим: поддельный Telegram в обычном Chrome. В сборке ветка мёртвая, и модуль подделки
  // в бандл не попадает: он подключается только здесь и только через import().
  if (__KPI_DEV__ && devRequested(location.search)) (await import("./dev/fake-telegram")).installFakeTelegram(location.search);
  const s = sdkState();
  if (s !== "ok") {
    mount(statusScreen(s));
    return;
  }
  const w = webApp();
  applyTheme();
  w?.ready?.();
  w?.expand?.();
  w?.onEvent?.("themeChanged", applyTheme);
  // Позицию прокрутки при «назад» восстанавливает роутер.
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  window.addEventListener("hashchange", onHashChange);
  await start();
}

void boot();
