// Поддельный Telegram.WebApp для обычного Chrome, только в dev. main.ts подключает модуль
// через import() под __KPI_DEV__; статического импорта нет нигде, и `vite build` его выбрасывает.
//
// Параметры адреса (ссылку на персону стенда собирает scripts/dev-url.ts):
//   ?init=<initData>  — строка запуска, подписанная тестовым токеном стенда; id — из её поля user
//   ?noinit=1         — initData пуст: «открыто не из Telegram»
//   ?sdk=fail         — window.Telegram нет вовсе: «не загрузился Telegram»
//   ?theme=light|dark — colorScheme и themeParams (по умолчанию light)
//
// В Telegram «назад» и главная кнопка живут вне WebView, здесь — настоящие DOM-кнопки поверх
// страницы: шапка 48 px сверху и кнопка 56 px снизу. Распорки того же размера в потоке документа
// не дают содержимому уйти под них. Хаптика и openLink только пишут в консоль.
import type { WebApp } from "../telegram";
import { DEV_MARKER, THEMES } from "./flag";

type Fn = () => void;

const Z = "2147483000";
const FONT = "system-ui,-apple-system,'Segoe UI',Roboto,sans-serif";

const log = (s: string): void => console.info(`[dev] ${s}`);

// Обработчики зовутся по копии: обработчик вправе снять сам себя (offClick) посреди обхода.
const fire = (set: Set<Fn>): void => Array.from(set).forEach((f) => f());

function userIdOf(init: string): number | undefined {
  try {
    const raw = new URLSearchParams(init).get("user");
    const id: unknown = raw ? (JSON.parse(raw) as { id?: unknown }).id : undefined;
    return typeof id === "number" ? id : undefined;
  } catch {
    return undefined;
  }
}

function spacer(height: number): HTMLElement {
  const d = document.createElement("div");
  d.dataset.dev = "spacer";
  d.style.cssText = `height:${height}px;flex:none`;
  return d;
}

export function installFakeTelegram(search: string): void {
  document.documentElement.dataset.devTelegram = DEV_MARKER;
  const q = new URLSearchParams(search);

  if (q.get("sdk") === "fail") {
    // Как будто telegram.org не ответил. Настоящий SDK в Chrome успевает отработать раньше
    // (defer идёт до модуля), поэтому его объект убираем.
    try {
      delete window.Telegram;
    } catch {
      // Свойство могло оказаться неудаляемым — тогда хотя бы обнулить.
    }
    if (window.Telegram) window.Telegram = undefined;
    return;
  }

  const init = q.get("noinit") === "1" ? "" : (q.get("init") ?? "");
  const scheme: "light" | "dark" = q.get("theme") === "dark" ? "dark" : "light";
  const theme = THEMES[scheme];
  const color = (k: string): string => theme[k] ?? "";

  // ---- шапка и «назад» ----
  const backClicks = new Set<Fn>();
  const header = document.createElement("div");
  header.dataset.dev = "header";
  header.style.cssText =
    `position:fixed;top:0;left:0;right:0;height:48px;display:flex;align-items:center;box-sizing:border-box;` +
    `background:${color("header_bg_color")};color:${color("text_color")};border-bottom:1px solid ${color("secondary_bg_color")};` +
    `font:600 16px/1 ${FONT};z-index:${Z}`;
  const back = document.createElement("button");
  back.type = "button";
  back.dataset.dev = "back";
  back.setAttribute("aria-label", "Назад");
  back.textContent = "‹";
  back.style.cssText =
    `display:none;width:48px;height:48px;flex:none;margin:0;padding:0;border:0;background:transparent;` +
    `color:${color("link_color")};font:400 32px/1 ${FONT};cursor:pointer`;
  back.addEventListener("click", () => fire(backClicks));
  const title = document.createElement("span");
  title.textContent = "Мой KPI · dev";
  title.style.cssText = "margin-left:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
  header.append(back, title);
  let backVisible = false;
  const backButton = {
    show(): void {
      backVisible = true;
      back.style.display = "block";
    },
    hide(): void {
      backVisible = false;
      back.style.display = "none";
    },
    onClick(cb: Fn): void {
      backClicks.add(cb);
    },
    offClick(cb: Fn): void {
      backClicks.delete(cb);
    },
    get isVisible(): boolean {
      return backVisible;
    },
  };

  // ---- главная кнопка ----
  const mainClicks = new Set<Fn>();
  const main = document.createElement("button");
  main.type = "button";
  main.dataset.dev = "main";
  const mainSpacer = spacer(56);
  let text = "Продолжить";
  let visible = false;
  let active = true;
  let progress = false;
  let leaveActive = false;
  // Неактивная кнопка — настоящий disabled: клик по ней не доходит до обработчиков, как в Telegram.
  const paint = (): void => {
    main.textContent = progress ? "…" : text;
    main.disabled = !active || (progress && !leaveActive);
    main.style.opacity = main.disabled ? "0.55" : "1";
    main.style.cursor = main.disabled ? "default" : "pointer";
    main.style.display = visible ? "block" : "none";
    mainSpacer.style.display = visible ? "block" : "none";
  };
  main.style.cssText =
    `position:fixed;left:0;right:0;bottom:0;width:100%;height:56px;margin:0;padding:0 16px;border:0;border-radius:0;` +
    `background:${color("button_color")};color:${color("button_text_color")};font:600 16px/1 ${FONT};z-index:${Z}`;
  main.addEventListener("click", () => {
    if (!main.disabled) fire(mainClicks);
  });
  const mainButton = {
    setText(t: string): void {
      text = t;
      paint();
    },
    show(): void {
      visible = true;
      paint();
    },
    hide(): void {
      visible = false;
      paint();
    },
    enable(): void {
      active = true;
      paint();
    },
    disable(): void {
      active = false;
      paint();
    },
    showProgress(leave?: boolean): void {
      progress = true;
      leaveActive = leave === true;
      paint();
    },
    hideProgress(): void {
      progress = false;
      paint();
    },
    onClick(cb: Fn): void {
      mainClicks.add(cb);
    },
    offClick(cb: Fn): void {
      mainClicks.delete(cb);
    },
    get text(): string {
      return text;
    },
    get isVisible(): boolean {
      return visible;
    },
    get isActive(): boolean {
      return active;
    },
    get isProgressVisible(): boolean {
      return progress;
    },
  };
  paint();

  document.body.prepend(spacer(48));
  document.body.append(mainSpacer, header, main);

  const haptic = {
    notificationOccurred(t: "success" | "error" | "warning"): void {
      log(`haptic notification ${t}`);
    },
    impactOccurred(style: string): void {
      log(`haptic impact ${style}`);
    },
    selectionChanged(): void {
      log("haptic selection");
    },
  };

  const events = new Map<string, Set<Fn>>();
  const userId = userIdOf(init);
  const app: WebApp & { platform: string; version: string; close(): void; offEvent(e: string, cb: Fn): void } = {
    initData: init,
    initDataUnsafe: userId === undefined ? {} : { user: { id: userId } },
    colorScheme: scheme,
    themeParams: { ...theme },
    platform: "dev",
    version: "8.0",
    ready: () => log("ready"),
    expand: () => log("expand"),
    close: () => log("close"),
    openLink: (url: string) => log(`openLink ${url}`),
    // Тема в dev не меняется, поэтому themeChanged и прочие события только запоминаются.
    onEvent(e: string, cb: Fn): void {
      const set = events.get(e) ?? new Set<Fn>();
      set.add(cb);
      events.set(e, set);
    },
    offEvent(e: string, cb: Fn): void {
      events.get(e)?.delete(cb);
    },
    BackButton: backButton,
    MainButton: mainButton,
    HapticFeedback: haptic,
  };
  window.Telegram = { WebApp: app };
  log(`Telegram.WebApp: ${init ? `user ${userId ?? "?"}` : "без initData"}, тема ${scheme}`);
}
