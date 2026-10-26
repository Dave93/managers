// Кэш ответов по пути запроса: при сбое сети показывается последний ответ.
// Ключ содержит Telegram user id владельца, чтобы на общем телефоне один
// человек не увидел экраны другого. Память — запасной путь: без localStorage
// (приватный режим, исключение доступа) и при сбое записи (квота) кэш живёт
// до закрытия приложения.
import { tgUserId } from "./telegram";

export interface KV {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
  key(i: number): string | null;
  readonly length: number;
}

type Entry<T> = { data: T; at: number };

export function createCache(kv: KV | null, owner: number | null): {
  save<T>(path: string, data: T, at: number): void;
  load<T>(path: string): { data: T; at: number } | null;
  clear(): void;
} {
  const mem = new Map<string, Entry<unknown>>();
  // Без владельца в localStorage не пишем: ключ был бы общим для всех.
  const store = owner === null ? null : kv;
  const prefix = `kpi_app:v1:${owner}:`;

  return {
    save(path, data, at) {
      mem.set(path, { data, at });
      if (!store) return;
      try {
        store.setItem(prefix + path, JSON.stringify({ data, at }));
      } catch {
        // Квота или запрет записи — остаётся копия в памяти.
      }
    },
    load<T>(path: string) {
      if (store) {
        try {
          const raw = store.getItem(prefix + path);
          if (raw !== null) {
            const e = JSON.parse(raw) as Entry<T> | null;
            if (e && typeof e.at === "number" && "data" in e) return { data: e.data, at: e.at };
          }
        } catch {
          // Битая запись: смотрим память.
        }
      }
      const m = mem.get(path) as Entry<T> | undefined;
      return m ? { data: m.data, at: m.at } : null;
    },
    clear() {
      mem.clear();
      if (!store) return;
      try {
        // Сначала собираем ключи: removeItem сдвигает индексы.
        const own: string[] = [];
        for (let i = 0; i < store.length; i++) {
          const k = store.key(i);
          if (k !== null && k.startsWith(prefix)) own.push(k);
        }
        for (const k of own) store.removeItem(k);
      } catch {
        // Хранилище недоступно — стирать нечего.
      }
    },
  };
}

let shared: { owner: number | null; cache: ReturnType<typeof createCache> } | null = null;

/** Общий экземпляр, лениво: до запуска Telegram user id неизвестен. */
export function appCache(): ReturnType<typeof createCache> {
  const owner = tgUserId();
  if (!shared || shared.owner !== owner) {
    let kv: KV | null = null;
    try {
      kv = window.localStorage;
    } catch {
      kv = null;
    }
    shared = { owner, cache: createCache(kv, owner) };
  }
  return shared.cache;
}
