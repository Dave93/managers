// Мост от экранов к роутеру: navigate, back, rerender и useLang живут в main.ts, но экраны
// берут их отсюда. main.ts — вход приложения, и импорт его из экрана замыкает круг
// main → screens/* → main. В сборке это безопасно (один бандл), а в `vite dev` после
// правки любого файла круга экран импортирует main.ts?t=…, тогда как <script> в
// index.html грузит main.ts без метки: модуль входа выполняется дважды — два входа,
// два роутера, два обработчика hashchange. Поэтому экраны импортируют только ./nav,
// а main.ts при загрузке отдаёт сюда свои функции (provideNav).
//
// Модуль без DOM и без runtime-импортов: его можно импортировать и в тестах.
import type { TgLang } from "@backend/modules/kpi/tg-app/types";
import type { Route } from "./route";

export interface Nav {
  navigate(r: Route): void;
  back(): void;
  rerender(): void;
  useLang(l: TgLang): void;
}

let impl: Nav | null = null;

/** Вызывает main.ts при загрузке модуля, до старта. */
export function provideNav(n: Nav): void {
  impl = n;
}

function nav(): Nav {
  // Без роутера переход молча потерялся бы; громкая ошибка видна сразу.
  if (!impl) throw new Error("nav: роутер не подключён (provideNav не вызван)");
  return impl;
}

/** Вперёд: маршрут в стек и в location.hash. */
export function navigate(r: Route): void {
  nav().navigate(r);
}

/** Назад по стеку. */
export function back(): void {
  nav().back();
}

/** Текущий экран заново, без скелетона (после смены языка, спора). */
export function rerender(): void {
  nav().rerender();
}

/** Язык интерфейса: словарь и lang у <html>. */
export function useLang(l: TgLang): void {
  nav().useLang(l);
}
