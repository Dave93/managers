// Фото нарушений (решение 13). Файл тянется fetch с токеном (у <img> заголовка не поставить)
// и показывается через blob-URL. URL живут, пока открыт экран нарушений: уход с экрана
// освобождает все (revokeAll). Ни в кэш экранов, ни в HTTP-кэш браузера фото не попадают
// (api.blob ходит с no-store), поэтому без сети на месте фото — «Фото не загрузилось».
//
// src у <img> — только blob-URL, созданный здесь; openPhoto другой не откроет.
//
// Перерисовка того же экрана (после спора, «Повторить» на пометке «нет связи») не уход:
// роутер тогда revokeAll не зовёт, и превью берут готовые URL по id без второго запроса.
import { appApi } from "./api";
import { t } from "./i18n";
import { h, setBack } from "./ui";

// Поколение экрана. revokeAll его меняет: файл, пришедший после ухода, URL уже не получит.
let gen = 0;
// URL этого поколения по id фото — общий для всех превью одного фото.
const loads = new Map<string, Promise<string | null>>();
// Созданные здесь и ещё не освобождённые URL.
const made = new Set<string>();

async function load(id: string, my: number): Promise<string | null> {
  const blob = await appApi().blob(`/violation-photos/${encodeURIComponent(id)}/file`);
  // Пока шёл запрос, экран сменили: URL никому не нужен.
  if (my !== gen) return null;
  // Только картинка: тело другого типа (страница прокси с кодом 200) в <img> не пойдёт.
  if (!blob || !/^image\//i.test(blob.type)) {
    // Сбой не запоминается: следующая перерисовка попробует снова.
    loads.delete(id);
    return null;
  }
  const url = URL.createObjectURL(blob);
  made.add(url);
  return url;
}

function urlOf(id: string): Promise<string | null> {
  let p = loads.get(id);
  if (!p) {
    p = load(id, gen);
    loads.set(id, p);
  }
  return p;
}

function failed(): HTMLElement {
  return h("span", { class: "photo photo-failed" }, t("photo_failed"));
}

/** Превью фото: кнопка с картинкой (нажатие — на весь экран) или заглушка «Фото не загрузилось». */
export async function photoThumb(id: string): Promise<HTMLElement> {
  const my = gen;
  const url = await urlOf(id);
  // URL мог освободиться, пока ждали очереди: такой в <img> не ставим.
  if (url === null || !made.has(url)) return failed();
  const img = h("img", { class: "photo-img", src: url, alt: "" });
  const btn = h(
    "button",
    { type: "button", class: "photo photo-btn", "aria-label": t("photo_open"), "aria-haspopup": "dialog", onclick: () => openPhoto(url) },
    img,
  );
  // Файл пришёл, но не читается как картинка: вместо пустой рамки — та же заглушка. Битый URL
  // не переиспользуется: он освобождается и забывается, следующая перерисовка запросит фото
  // снова. Только в своём поколении: запоздавшая ошибка с прежнего экрана карту не трогает.
  img.addEventListener("error", () => {
    if (my === gen && made.has(url)) {
      made.delete(url);
      URL.revokeObjectURL(url);
      loads.delete(id);
    }
    if (btn.parentNode) btn.parentNode.replaceChild(failed(), btn);
  });
  return btn;
}

// Закрыть открытый просмотр; null — его нет.
let closeOpen: (() => void) | null = null;

/** Просмотр на весь экран. Закрывается тапом в любом месте, «назад» Telegram и Esc. */
export function openPhoto(url: string): void {
  if (!made.has(url)) return;
  closePhoto();
  const opener = document.activeElement as HTMLElement | null;
  let prevBack: (() => void) | null = null;

  const hit = h(
    "button",
    { type: "button", class: "viewer-hit", "aria-label": t("photo_close"), onclick: () => close() },
    h("img", { class: "viewer-img", src: url, alt: "" }),
  );
  const view = h("div", { class: "viewer", role: "dialog", "aria-modal": "true", "aria-label": t("photo_open") }, hit);
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape" || e.key === "Esc") close();
  };

  function close(): void {
    if (closeOpen !== close) return;
    closeOpen = null;
    // «Назад» экрана — обратно Telegram BackButton.
    setBack(prevBack);
    document.removeEventListener("keydown", onKey);
    document.documentElement.classList.remove("viewer-open");
    if (view.parentNode) view.parentNode.removeChild(view);
    if (opener && document.body.contains(opener)) opener.focus();
  }

  document.body.appendChild(view);
  document.documentElement.classList.add("viewer-open");
  document.addEventListener("keydown", onKey);
  prevBack = setBack(close);
  closeOpen = close;
  try {
    hit.focus();
  } catch {
    // ничего
  }
}

/** Роутер уходит с экрана или перерисовывает его: открытый просмотр закрывается. */
export function closePhoto(): void {
  if (closeOpen) closeOpen();
}

/** Уход с экрана нарушений: просмотр закрыт, все URL освобождены, запоздавшие файлы URL не получат. */
export function revokeAll(): void {
  gen++;
  closePhoto();
  loads.clear();
  made.forEach((u) => URL.revokeObjectURL(u));
  made.clear();
}
