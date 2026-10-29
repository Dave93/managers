// Та часть Telegram WebApp SDK, которой касается приложение, типизирована
// вручную. SDK подключён тегом <script> в index.html (не npm-зависимость):
// Telegram отдаёт меняющийся файл по одному адресу. Всё обращение к window —
// только внутри функций, чтобы модуль импортировался в `bun test` без DOM.
export type WebApp = {
  initData?: string;
  initDataUnsafe?: { user?: { id?: number } };
  colorScheme?: "light" | "dark";
  themeParams?: Record<string, string>;
  ready?(): void;
  expand?(): void;
  openLink?(url: string): void;
  onEvent?(e: string, cb: () => void): void;
  BackButton?: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
  MainButton?: {
    setText(t: string): void;
    show(): void;
    hide(): void;
    enable(): void;
    disable(): void;
    showProgress(leaveActive?: boolean): void;
    hideProgress(): void;
    onClick(cb: () => void): void;
    offClick(cb: () => void): void;
  };
  HapticFeedback?: { notificationOccurred(t: "success" | "error" | "warning"): void };
};

declare global {
  interface Window {
    Telegram?: { WebApp?: WebApp };
  }
}

export function webApp(): WebApp | null {
  if (typeof window === "undefined") return null;
  return window.Telegram?.WebApp ?? null;
}

/**
 * «sdk_failed» — скрипт telegram.org не загрузился (нет window.Telegram);
 * «outside» — объект есть, но initData пуст (открыто не из Telegram).
 */
export function sdkState(): "ok" | "sdk_failed" | "outside" {
  const w = webApp();
  if (!w) return "sdk_failed";
  return w.initData ? "ok" : "outside";
}

/** Подписанная строка запуска — как есть: подпись проверяет сервер. */
export function initData(): string {
  return webApp()?.initData ?? "";
}

export function tgUserId(): number | null {
  const id = webApp()?.initDataUnsafe?.user?.id;
  return typeof id === "number" ? id : null;
}

/** themeParams → --tg-theme-*; data-scheme="light|dark" на <html>. */
export function applyTheme(): void {
  const w = webApp();
  const root = document.documentElement;
  const params = w?.themeParams ?? {};
  for (const k of Object.keys(params)) {
    const v = params[k];
    if (v) root.style.setProperty(`--tg-theme-${k.replace(/_/g, "-")}`, v);
  }
  const scheme = w?.colorScheme ?? (window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  root.dataset.scheme = scheme;
}

export function haptic(kind: "success" | "error"): void {
  try {
    webApp()?.HapticFeedback?.notificationOccurred(kind);
  } catch {
    // Старые клиенты без вибро.
  }
}
