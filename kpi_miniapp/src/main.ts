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
// navigate, back, rerender и useLang отсюда не экспортируются: экраны берут их из ./nav,
// куда main.ts отдаёт их через provideNav. Импорт входа из экрана в `vite dev`
// выполнял main.ts дважды (подробно — в nav.ts). Экраны импортируют только ./nav.
import type { TgHistory, TgHome, TgLang, TgReview, TgRole, TgViolations } from "@backend/modules/kpi/tg-app/types";
import type { FailStatus } from "./api";
import { appApi } from "./api";
import { appCache } from "./cache";
import { devRequested } from "./dev/flag";
import { DICT, lang, monthName, setLang, t } from "./i18n";
import type { Loaded } from "./load";
import { loadScreen } from "./load";
import { provideNav } from "./nav";
import { closePhoto, revokeAll } from "./photo";
import type { Route } from "./route";
import { hashOf, parseHash } from "./route";
import { renderHistory } from "./screens/history";
import { renderHome } from "./screens/home";
import { renderReview } from "./screens/review";
import { renderViolations } from "./screens/violations";
import { closeDisputeSheet } from "./sheet";
import { applyTheme, sdkState, webApp } from "./telegram";
import { capFirst } from "./util";
import { h, mount, setBack, showSlow, showingSkeleton, skeleton, slowHint, staleBanner, statusScreen } from "./ui";
import { historyView } from "./view/history";
import { homeView } from "./view/home";
import { reviewView } from "./view/review";
import { violationsView } from "./view/violations";

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
  // Заголовок экрана над «Запись не найдена» (404): человек видит, какой месяц не нашёлся.
  title?: string;
}

function screenOf(r: Route): Screen {
  switch (r.name) {
    case "home":
      // Вид строится от lang(), а не от d.lang: копия из кэша после смены языка (PUT /lang
      // прошёл, а перезагрузка упала без сети) рисуется уже на новом языке.
      return { path: "/home", kind: "home", render: (d) => renderHome(homeView(d as TgHome, lang(), Date.now()), d as TgHome) };
    case "review":
      // Как у главного: вид от lang(), а не от языка в ответе.
      return {
        path: `/review?period=${r.period}`,
        kind: "list",
        render: (d) => renderReview(reviewView(d as TgReview, lang()), d as TgReview),
        title: capFirst(monthName(r.period, "nom", lang())),
      };
    case "violations":
      return {
        path: `/violations?period=${r.period}`,
        kind: "list",
        render: (d) => renderViolations(violationsView(d as TgViolations, lang()), d as TgViolations),
        title: t("viol_title", { month: monthName(r.period, "nom", lang()) }),
      };
    case "history":
      return { path: "/history", kind: "list", render: (d) => renderHistory(historyView(d as TgHistory, lang())), title: t("link_history") };
  }
}

// ---------- язык и роли ----------

/** Язык интерфейса: словарь и lang у <html>. Экраны зовут его через ./nav (переключатель RU/UZ). */
function useLang(l: TgLang): void {
  setLang(l);
  document.documentElement.setAttribute("lang", l);
}

// Свежий главный экран приносит язык и роли (после смены языка — уже новый); при
// старте без сети их больше взять негде, кроме сохранённой копии.
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
function navigate(r: Route): void {
  const to = guard(r);
  if (same(to, top().route)) return;
  top().y = window.pageYOffset;
  stack.push({ route: to, y: 0 });
  // hashchange от этой записи увидит вершину стека и ничего не сделает.
  if (location.hash !== hashOf(to)) location.hash = hashOf(to);
  show(false);
}

/** Назад по стеку; с главного — остаться на главном. */
function back(): void {
  if (stack.length > 1) stack.pop();
  history.replaceState(null, "", hashOf(top().route));
  show(false);
}

/** Текущий экран заново, без скелетона: старые данные видны, пока идёт запрос. */
function rerender(): void {
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
  // Шторка спора живёт вне #app: уход с экрана и перерисовка закрывают её вместе с MainButton
  // и её «назад» — до того, как роутер поставит свой.
  closeDisputeSheet();
  // Просмотр фото тоже ставит свой «назад»: закрыть его до роутера. Уход с экрана освобождает
  // blob-URL фото (решение 13); перерисовка того же экрана их оставляет — превью не мигают.
  closePhoto();
  if (!keep) revokeAll();
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
  // Перерисовка без скелетона (keep) оставляет старый экран видимым, пока идёт запрос: на нём
  // можно успеть открыть шторку спора или фото. Новый экран их закрывает — иначе шторка от
  // старых данных («Оспорить» уже сменилась строкой) отправила бы второй спор и получила 409.
  closeDisputeSheet();
  closePhoto();
  // Вместо экрана — отказ, «не найдено» или главный: фото прежнего экрана больше не нужны.
  if (res.kind !== "fresh" && res.kind !== "stale") revokeAll();
  if (res.kind === "fresh" || res.kind === "stale") {
    // Только свежий ответ: старая копия вернула бы язык, который человек только что
    // сменил (PUT /lang прошёл, а перезагрузка главного упала без сети).
    if (res.kind === "fresh" && entry.route.name === "home") adoptHome(res.data as TgHome);
    const view = sc.render(res.data);
    if (res.kind === "stale") view.insertBefore(staleBanner(res.at, rerender), view.firstChild);
    mount(view);
    window.scrollTo(0, entry.y);
    return;
  }
  if (res.kind === "http") {
    // Роль сотрудника сняли, пока приложение открыто (решение 18 посреди работы): вместо
    // «Повторить», который снова получит 403, — главный экран; он же поправит роли.
    if (res.error === "not_employee") {
      goHome();
      return;
    }
    // Черновик, чужое и несуществующее неотличимы (план 6): «Запись не найдена», а назад
    // ведёт BackButton — стек здесь всегда глубже главного.
    if (res.code === 404) {
      mount(notFound(sc));
      return;
    }
    mount(statusScreen("unknown", () => show(false)));
    return;
  }
  refuse(res.status);
}

function notFound(sc: Screen): HTMLElement {
  return h(
    "main",
    { class: "screen" },
    sc.title ? h("h1", { class: "title" }, sc.title) : null,
    h("p", { class: "card notfound", role: "status" }, t("err_not_found")),
  );
}

/** Стек — только главный, хеш «#/»; свежий главный экран принесёт роли заново. */
function goHome(): void {
  stack = [{ route: HOME, y: 0 }];
  history.replaceState(null, "", hashOf(HOME));
  show(false);
}

/** Отказ посреди работы. Без сети и при сбое — «Повторить» и «назад»; остальное не восстановить. */
function refuse(s: FailStatus): void {
  // Шторка могла открыться, пока шла перерисовка: её «назад» не должен пережить отказ.
  closeDisputeSheet();
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
    // Сети нет, но главный экран уже открывали: показываем его с пометкой времени. Кэш —
    // под последним запомненным who (входа не было); риск переназначенной привязки описан в appCache.
    const cached = appCache().load<TgHome>("/home");
    if (cached) {
      adoptHome(cached.data);
      stack = [{ route: HOME, y: 0 }];
      // Ссылка могла вести на вложенный экран, а показан главный: хеш — вершина стека.
      history.replaceState(null, "", hashOf(HOME));
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
    // «Вне Telegram» объект SDK есть: экран отказа — в теме Telegram, а не системы (иначе под
    // светлой шапкой Telegram тёмный экран). Без SDK темы нет — остаётся системная.
    if (s === "outside") applyTheme();
    // «Не загрузился Telegram» — «Обновить»: перезагрузка заново просит SDK у telegram.org.
    // «Вне Telegram» перезагрузка не лечит, кнопки там нет.
    mount(statusScreen(s, s === "sdk_failed" ? () => location.reload() : undefined));
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

// Экраны ходят в роутер через мост ./nav — до старта, чтобы первый же экран мог им пользоваться.
provideNav({ navigate, back, rerender, useLang });

void boot();
