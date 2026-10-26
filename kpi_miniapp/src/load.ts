// Загрузка экрана: свежий ответ, последний сохранённый при сбое сети, отказ.
// Без DOM: модуль импортирует `bun test`, общие клиент и кэш берутся лениво.
import type { ApiResult, FailStatus } from "./api";
import { appApi } from "./api";
import type { createCache } from "./cache";
import { appCache } from "./cache";

export type Loaded<T> =
  | { kind: "fresh"; data: T }
  | { kind: "stale"; data: T; at: number }
  | { kind: "fail"; status: FailStatus }
  | { kind: "http"; code: number; error: string | null };

// Через столько миллисекунд без ответа под скелетоном появляется «Связь плохая, ещё пробуем» (урок F1).
const SLOW_MS = 8000;

/**
 * Ответ API и сохранённая копия → что показать. Сохранённое подставляется
 * только при сбое сети: на expired, not_bound и прочих отказах старые данные
 * показывать нельзя. Сохраняет свежий ответ вызывающий.
 */
export function resolveLoad<T>(r: ApiResult<T>, cached: { data: T; at: number } | null): Loaded<T> {
  switch (r.kind) {
    case "ok":
      return { kind: "fresh", data: r.data };
    case "fail":
      if (r.status === "offline" && cached) return { kind: "stale", data: cached.data, at: cached.at };
      return { kind: "fail", status: r.status };
    case "http":
      // Тело ответа экрану не нужно: код и error его классифицируют.
      return { kind: "http", code: r.code, error: r.error };
  }
}

export interface LoadDeps<T> {
  get(path: string): Promise<ApiResult<T>>;
  cache: ReturnType<typeof createCache>;
  now(): number;
  slowMs?: number;
}

/** loadScreen с явными зависимостями — для тестов. */
export async function loadVia<T>(d: LoadDeps<T>, path: string, onSlow: () => void): Promise<Loaded<T>> {
  const timer = setTimeout(onSlow, d.slowMs ?? SLOW_MS);
  try {
    const r = await d.get(path);
    // Повторный вход посреди работы получил 403: привязку сняли или человека
    // уволили, пока приложение открыто. Его экраны с телефона стираются (решение 12).
    if (r.kind === "fail" && (r.status === "not_bound" || r.status === "inactive")) {
      d.cache.clear();
      return { kind: "fail", status: r.status };
    }
    const out = resolveLoad(r, r.kind === "fail" ? d.cache.load<T>(path) : null);
    if (out.kind === "fresh") d.cache.save(path, out.data, d.now());
    return out;
  } finally {
    clearTimeout(timer);
  }
}

/** Данные экрана по пути API; onSlow — если ответа нет 8 с. */
export function loadScreen<T>(path: string, onSlow: () => void): Promise<Loaded<T>> {
  return loadVia<T>({ get: (p) => appApi().get<T>(p), cache: appCache(), now: () => Date.now() }, path, onSlow);
}
