// Весь разговор с backend: вход по initData, Bearer, один тихий повторный вход
// на 401, таймаут. Контракт — backend/src/modules/kpi/tg-app/ (план 6):
//
//   POST /api/kpi/tg/auth {init_data}
//     200 {token, roles, lang}
//     401 {error:"unauthorized"|"bad_init_data"}   подпись или auth_date старше 24 ч
//     403 {error:"not_bound"|"inactive"}
//     503 {error:"not_configured"}
//   остальные /api/kpi/tg/*: Authorization: Bearer <token>; 401, когда сессия
//   в Redis истекла (12 ч).
import type { TgAuthResponse } from "@backend/modules/kpi/tg-app/types";
import { adoptWho } from "./cache";
import { initData, sdkState } from "./telegram";

export type FailStatus = "sdk_failed" | "outside" | "not_bound" | "inactive" | "not_configured" | "expired" | "offline" | "unknown";
export type ApiResult<T> =
  | { kind: "ok"; data: T }
  | { kind: "fail"; status: FailStatus }
  | { kind: "http"; code: number; error: string | null; body: unknown };

export interface ApiDeps {
  fetch: typeof fetch;
  sdk: () => "ok" | "sdk_failed" | "outside";
  initData: () => string;
  timeoutMs?: number; // по умолчанию 15000
  // Тело каждого удачного входа, и тихого повторного тоже: по who кэш узнаёт, что за
  // этим Telegram теперь другой человек (привязку переназначили посреди работы).
  onAuth?: (body: TgAuthResponse) => void;
}

// Ведущий слэш обязателен: base у vite "/kpi-app/", относительный путь ушёл бы
// на /kpi-app/api/... и дал 404.
const BASE = "/api/kpi/tg";

type AuthOut = { kind: "ok"; body: TgAuthResponse } | { kind: "fail"; status: FailStatus };

function errorOf(body: unknown): string | null {
  const e = (body as { error?: unknown } | null)?.error;
  return typeof e === "string" ? e : null;
}

/** Код и тело неуспешного входа → статус экрана отказа. */
export function classifyAuthFailure(status: number, body: unknown): FailStatus {
  if (status === 503) return "not_configured";
  if (status === 401) return "expired";
  if (status === 403) {
    const e = errorOf(body);
    if (e === "not_bound") return "not_bound";
    if (e === "inactive") return "inactive";
    return "unknown";
  }
  if (status >= 500) return "offline";
  return "unknown";
}

export function createApi(d: ApiDeps) {
  const timeoutMs = d.timeoutMs ?? 15_000;
  // Токен только в памяти: он и есть сессия.
  let token: string | null = null;
  let pending: Promise<AuthOut> | null = null;

  // Филиальный wifi не отказывает, а зависает: без таймаута приложение
  // осталось бы на скелетоне навсегда. null — сеть или таймаут.
  async function raw(path: string, init: RequestInit): Promise<Response | null> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      return await d.fetch(BASE + path, { ...init, signal: ctrl.signal });
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async function json(res: Response): Promise<unknown> {
    try {
      return await res.json();
    } catch {
      // 502 от nginx — HTML; статус всё равно классифицирует отказ.
      return null;
    }
  }

  async function doAuth(): Promise<AuthOut> {
    const s = d.sdk();
    if (s !== "ok") return { kind: "fail", status: s };
    const res = await raw("/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ init_data: d.initData() }),
    });
    if (!res) return { kind: "fail", status: "offline" };
    const body = await json(res);
    if (!res.ok) return { kind: "fail", status: classifyAuthFailure(res.status, body) };
    const b = body as Partial<TgAuthResponse> | null;
    if (!b || typeof b.token !== "string") return { kind: "fail", status: "unknown" };
    token = b.token;
    d.onAuth?.(b as TgAuthResponse);
    return { kind: "ok", body: b as TgAuthResponse };
  }

  // Параллельные запросы без токена делают один вход, а не по одному на каждый.
  function auth(): Promise<AuthOut> {
    if (!pending) pending = doAuth().finally(() => { pending = null; });
    return pending;
  }

  /**
   * Запрос с токеном и ОДНИМ повторным входом на 401. Сессия живёт 12 ч,
   * initData — 24 ч, поэтому открытое через границу приложение тихо
   * восстанавливается. Второй 401 — expired (цикла нет). Повторный вход,
   * получивший 403/503/сеть, возвращает свой статус и запрос не повторяет.
   */
  async function authed(path: string, init: RequestInit): Promise<{ res: Response } | { status: FailStatus }> {
    if (!token) {
      const a = await auth();
      if (a.kind === "fail") return { status: a.status };
    }
    for (let attempt = 0; ; attempt++) {
      const used = token;
      // Заголовки через конструктор Headers, не spread: spread не-объекта
      // молча потерял бы Authorization.
      const headers = new Headers(init.headers);
      headers.set("Authorization", `Bearer ${used}`);
      const res = await raw(path, { ...init, headers });
      if (!res) return { status: "offline" };
      if (res.status !== 401) return { res };
      // Сбрасываем токен, только если его не успел обновить параллельный запрос.
      if (token === used) token = null;
      if (attempt === 1) return { status: "expired" };
      if (!token) {
        const a = await auth();
        if (a.kind === "fail") return { status: a.status };
      }
    }
  }

  async function call<T>(path: string, init: RequestInit): Promise<ApiResult<T>> {
    const out = await authed(path, init);
    if ("status" in out) return { kind: "fail", status: out.status };
    const { res } = out;
    if (res.status >= 500) return { kind: "fail", status: "offline" };
    const body = await json(res);
    if (res.ok) {
      // 2xx без JSON: не выдаём null за T.
      if (body === null) return { kind: "fail", status: "unknown" };
      return { kind: "ok", data: body as T };
    }
    return { kind: "http", code: res.status, error: errorOf(body), body };
  }

  return {
    auth,
    get<T>(path: string): Promise<ApiResult<T>> {
      return call<T>(path, { method: "GET" });
    },
    send<T>(method: "POST" | "PUT", path: string, body: unknown): Promise<ApiResult<T>> {
      return call<T>(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    },
    /** Файл с токеном (для <img> заголовок не поставить). Любой сбой — null. */
    async blob(path: string): Promise<Blob | null> {
      const out = await authed(path, { method: "GET" });
      if ("status" in out || !out.res.ok) return null;
      try {
        return await out.res.blob();
      } catch {
        return null;
      }
    },
  };
}

let shared: ReturnType<typeof createApi> | null = null;

/** Общий клиент, лениво: window и SDK читаются при первом вызове. */
export function appApi(): ReturnType<typeof createApi> {
  if (!shared)
    shared = createApi({
      fetch: window.fetch.bind(window),
      sdk: sdkState,
      initData,
      // Старый backend who не присылает: тогда кэш только в памяти, а не под чужим ключом.
      onAuth: (b) => adoptWho(typeof b.who === "string" ? b.who : null),
    });
  return shared;
}
