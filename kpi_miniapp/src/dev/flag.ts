// Dev-режим (решение 1): единственное, что main.ts и тесты берут из dev/ статически.
// Без DOM и без обращений к window на верхнем уровне: модуль импортирует `bun test`.
// Поддельный Telegram лежит рядом (fake-telegram.ts) и подключается только через import()
// под константой сборки __KPI_DEV__, поэтому в `vite build` не попадает.

// Поддельный Telegram пишет его в DOM первым делом. Строка в dist значит, что подделка
// уехала в сборку. devRequested на неё не ссылается: main.ts тянет devRequested статически,
// и ссылка унесла бы маркер в бандл.
export const DEV_MARKER = "__KPI_DEV_FAKE_TELEGRAM__";

// themeParams как у Telegram Desktop: светлая и тёмная тема, одинаковые 13 ключей.
export const THEMES: Record<"light" | "dark", Record<string, string>> = {
  light: {
    bg_color: "#ffffff",
    secondary_bg_color: "#f0f0f0",
    text_color: "#000000",
    hint_color: "#999999",
    link_color: "#2481cc",
    button_color: "#2481cc",
    button_text_color: "#ffffff",
    header_bg_color: "#ffffff",
    accent_text_color: "#2481cc",
    section_bg_color: "#ffffff",
    section_header_text_color: "#6d6d71",
    subtitle_text_color: "#999999",
    destructive_text_color: "#e53935",
  },
  dark: {
    bg_color: "#212121",
    secondary_bg_color: "#0f0f0f",
    text_color: "#ffffff",
    hint_color: "#aaaaaa",
    link_color: "#8774e1",
    button_color: "#8774e1",
    button_text_color: "#ffffff",
    header_bg_color: "#212121",
    accent_text_color: "#8774e1",
    section_bg_color: "#212121",
    section_header_text_color: "#8774e1",
    subtitle_text_color: "#aaaaaa",
    destructive_text_color: "#ee686f",
  },
};

/** В адресе есть init=, sdk=fail или noinit=1 — подставить поддельный Telegram. Одна ?theme= — нет. */
export function devRequested(search: string): boolean {
  const q = new URLSearchParams(search);
  return q.has("init") || q.get("sdk") === "fail" || q.get("noinit") === "1";
}
