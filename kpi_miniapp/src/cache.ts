// Кэш ответов по пути запроса: при сбое сети показывается последний ответ.
//
// Ключ — kpi_app:v1:<Telegram user id>:<who>:<путь>. Telegram id — чтобы на общем
// телефоне один человек не увидел экраны другого. who (ответ входа) — потому что HR
// может переназначить ту же привязку Telegram на другого сотрудника: тогда сменится
// who, и экраны прежнего с телефона стираются (switchWho). Последний who лежит в
// kpi_app:v1:<id>:who — по нему ищется кэш при старте без сети.
//
// Память — запасной путь: без localStorage (приватный режим, исключение доступа) и
// при сбое записи (квота) кэш живёт до закрытия приложения.
import { tgUserId } from "./telegram";

export interface KV {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
  key(i: number): string | null;
  readonly length: number;
}

type Entry<T> = { data: T; at: number };

const ns = (owner: number): string => `kpi_app:v1:${owner}:`;
const whoKey = (owner: number): string => `${ns(owner)}who`;

/** Стереть всё под этим Telegram: экраны всех who и пометку who. */
function wipe(kv: KV, owner: number): void {
  try {
    // Сначала собираем ключи: removeItem сдвигает индексы.
    const own: string[] = [];
    for (let i = 0; i < kv.length; i++) {
      const k = kv.key(i);
      if (k !== null && k.startsWith(ns(owner))) own.push(k);
    }
    for (const k of own) kv.removeItem(k);
  } catch {
    // Хранилище недоступно — стирать нечего.
  }
}

/** Последний вошедший под этим Telegram (для старта без сети); null — не знаем. */
export function lastWho(kv: KV | null, owner: number | null): string | null {
  if (!kv || owner === null) return null;
  try {
    return kv.getItem(whoKey(owner));
  } catch {
    return null;
  }
}

/**
 * Вход прошёл с этим who. Если запомнен другой (привязку переназначили) или никакой
 * (первый вход, ключи старого вида), всё прежнее под этим Telegram стирается.
 * true — стёрли.
 */
export function switchWho(kv: KV | null, owner: number | null, who: string): boolean {
  if (!kv || owner === null) return false;
  try {
    if (kv.getItem(whoKey(owner)) === who) return false;
    wipe(kv, owner);
    kv.setItem(whoKey(owner), who);
    return true;
  } catch {
    return false;
  }
}

export function createCache(kv: KV | null, owner: number | null, who: string | null): {
  save<T>(path: string, data: T, at: number): void;
  load<T>(path: string): { data: T; at: number } | null;
  clear(): void;
} {
  const mem = new Map<string, Entry<unknown>>();
  // Без владельца или без who в localStorage не пишем: ключ был бы общим для разных людей.
  const store = owner === null || who === null ? null : kv;
  const prefix = `${ns(owner ?? 0)}${who}:`;

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
    // 403 not_bound/inactive: стираются экраны всех людей под этим Telegram и пометка who.
    clear() {
      mem.clear();
      if (kv && owner !== null) wipe(kv, owner);
    },
  };
}

function storage(): KV | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

// who последнего удачного входа; undefined — входа в этом запуске ещё не было.
let sessionWho: string | null | undefined;
let shared: { owner: number | null; who: string | null; cache: ReturnType<typeof createCache> } | null = null;

/**
 * Удачный вход (api.ts зовёт после каждого, и после тихого повторного тоже): другой
 * человек за этим Telegram — экраны прежнего стираются. null — сервер who не прислал
 * (старый backend): тогда кэш живёт только в памяти.
 */
export function adoptWho(who: string | null): void {
  if (who !== null) switchWho(storage(), tgUserId(), who);
  sessionWho = who;
}

/** Общий экземпляр, лениво: до запуска Telegram user id неизвестен, до входа — who. */
export function appCache(): ReturnType<typeof createCache> {
  const owner = tgUserId();
  const kv = storage();
  // До входа (старт без сети) who — последний запомненный. Остаточный риск принят: если
  // привязку переназначили, а первое открытие после этого прошло без сети, новый человек
  // увидит сохранённые экраны прежнего — до первого удачного входа, который сменит who и
  // сотрёт их.
  const who = sessionWho !== undefined ? sessionWho : lastWho(kv, owner);
  if (!shared || shared.owner !== owner || shared.who !== who) shared = { owner, who, cache: createCache(kv, owner, who) };
  return shared.cache;
}
