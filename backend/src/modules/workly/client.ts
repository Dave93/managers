// Клиент Workly API: вход и обновление ключа (ключ общий для процессов и лежит в Redis), обход страниц списков и отчётов.
// В сообщениях ошибок только фиксированный русский текст и числовой код Workly: тела ответов и данные запросов
// (пароль, client_secret, ключи доступа) в ошибки и логи не попадают.
import type Redis from "ioredis";
import { companyMatches, credsFromEnv, expectedCompanyOf } from "./config";
import type {
  AbsenceItem,
  ConnKey,
  LateInItem,
  T12Item,
  WorklyCreds,
  WorklyDismissed,
  WorklyEmployee,
  WorklyLocation,
} from "./types";

export type WorklyErrorCode =
  | "not_configured"
  | "client_invalid"
  | "force_update"
  | "auth_failed"
  | "http_error"
  | "company_mismatch";

export class WorklyError extends Error {
  constructor(
    public code: WorklyErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "WorklyError";
  }
}

export interface WorklyDeps {
  redis: Pick<Redis, "get" | "set" | "del">;
  fetch?: typeof fetch;
  now?: () => Date;
}

// Коды ошибок Workly в теле ответа.
const CODE_WRONG_LOGIN = 7002; // неверный логин или пароль
const CODE_BAD_CLIENT = 7003; // неверные client_id/client_secret
const CODE_BAD_GRANT = 7005; // тип авторизации не поддерживается клиентом
const CODE_BAD_TOKEN = 7008; // ключ доступа недействителен
const HTTP_FORCE_UPDATE = 426;

const PAGE_LIMIT = "50";
const REFRESH_BEFORE_MS = 24 * 60 * 60 * 1000; // обновляем ключ за сутки до конца срока
const DEFAULT_EXPIRES_IN_S = 30 * 24 * 60 * 60; // срок ключа Workly, если в ответе его нет
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_PAGES = 1000; // предохранитель от бесконечного обхода

interface StoredToken {
  access_token: string;
  refresh_token: string;
  expires_at: number; // мс от эпохи
}

interface Reply {
  status: number;
  ok: boolean;
  body: Record<string, unknown> | null;
}

function codeOf(body: Reply["body"]): number | null {
  const c = body?.code;
  return typeof c === "number" && Number.isInteger(c) ? c : null;
}

// Ошибки, после которых повтор другим способом входа бесполезен.
const FATAL: ReadonlySet<WorklyErrorCode> = new Set(["client_invalid", "force_update", "company_mismatch"]);
const isFatal = (e: unknown) => e instanceof WorklyError && FATAL.has(e.code);

/**
 * Учётка подключения принадлежит своей компании Workly (спека 5.1). Вызывается сразу после
 * companyId(), до любого чтения и записи данных: ключи одной компании в переменных другой
 * иначе записали бы чужие локации и предложили бы деактивации по чужим уволенным.
 * Текст ошибки фиксированный, номеров компаний в нём нет.
 */
export function assertCompany(key: ConnKey, companyId: number): void {
  if (!companyMatches(expectedCompanyOf(key), companyId)) {
    throw new WorklyError("company_mismatch", "Учётная запись Workly принадлежит другой компании, чем у подключения");
  }
}

const forceUpdate = () => new WorklyError("force_update", "Workly требует обновить приложение (HTTP 426)");

function httpError(status: number, code: number | null): WorklyError {
  return new WorklyError("http_error", `Workly вернул HTTP ${status}${code !== null ? `, код ${code}` : ""}`);
}

export class WorklyClient {
  private readonly fetchFn: typeof fetch;
  private readonly now: () => Date;
  // Параллельные вызовы одного клиента ждут один и тот же вход.
  private inflight: Promise<string> | null = null;
  // Ключ, который не удалось записать в Redis: работаем с ним в памяти, чтобы не входить заново на каждой странице.
  private unsaved: StoredToken | null = null;

  constructor(
    private readonly creds: WorklyCreds,
    private readonly deps: WorklyDeps,
  ) {
    this.fetchFn = deps.fetch ?? fetch;
    this.now = deps.now ?? (() => new Date());
  }

  async companyId(): Promise<number> {
    const body = await this.getJson("/v1/accounts", {});
    if (typeof body.company_id !== "number" || !Number.isInteger(body.company_id)) {
      throw new WorklyError("http_error", "Workly вернул учётную запись без company_id");
    }
    return body.company_id;
  }

  employees(): Promise<WorklyEmployee[]> {
    return this.crawl<WorklyEmployee>("/v1/employees", {}, (e) => String(e.id));
  }

  dismissed(): Promise<WorklyDismissed[]> {
    return this.crawl<WorklyDismissed>("/v1/employees/dismissed", {}, (e) => String(e.id));
  }

  locations(): Promise<WorklyLocation[]> {
    return this.crawl<WorklyLocation>("/v1/locations", {}, (l) => String(l.id));
  }

  t12(from: string, to: string): Promise<T12Item[]> {
    return this.crawl<T12Item>("/v1/reports/t12", { start_date: from, end_date: to }, (i) => String(i.employee_id));
  }

  // В отчётах об опозданиях и прогулах табельного номера нет, только employee.id; запись — сотрудник + день.
  lateIn(from: string, to: string): Promise<LateInItem[]> {
    return this.crawl<LateInItem>("/v1/reports/late-in", { start_date: from, end_date: to }, dayKey);
  }

  absence(from: string, to: string): Promise<AbsenceItem[]> {
    return this.crawl<AbsenceItem>("/v1/reports/absence", { start_date: from, end_date: to }, dayKey);
  }

  // Обход страниц. totalCount у Workly раздут JOIN-ом по должностям, а запрос за последней страницей
  // возвращает её же повторно с её собственным currentPage, поэтому останавливаемся по несовпадению
  // currentPage, а повторы убираем по ключу.
  private async crawl<T>(path: string, params: Record<string, string>, keyOf: (item: T) => string): Promise<T[]> {
    const out = new Map<string, T>();
    for (let page = 1; ; page++) {
      if (page > MAX_PAGES) throw new WorklyError("http_error", "Workly: слишком много страниц в списке");
      const body = await this.getJson(path, { ...params, page: String(page) });
      const items = body.items;
      const meta = body._meta as { currentPage?: unknown; pageCount?: unknown } | null | undefined;
      if (!Array.isArray(items) || typeof meta?.currentPage !== "number" || typeof meta.pageCount !== "number") {
        throw new WorklyError("http_error", "Workly вернул список в неожиданном формате");
      }
      if (meta.currentPage !== page) break; // страница за последней: это повтор уже учтённой
      for (const item of items as T[]) {
        const key = keyOf(item);
        if (!out.has(key)) out.set(key, item);
      }
      if (items.length === 0 || page >= meta.pageCount) break;
    }
    return [...out.values()];
  }

  // GET с ключом доступа. При 7008 один раз сбрасываем ключ, входим заново и повторяем тот же запрос.
  private async getJson(path: string, query: Record<string, string>): Promise<Record<string, unknown>> {
    const qs = new URLSearchParams(query).toString();
    const url = `${this.creds.baseUrl}${path}${qs ? `?${qs}` : ""}`;
    let retried = false;
    for (;;) {
      const token = await this.token();
      const res = await this.send(url, {
        method: "GET",
        headers: { accept: "application/json", authorization: `Bearer ${token}`, limit: PAGE_LIMIT },
      });
      if (res.status === HTTP_FORCE_UPDATE) throw forceUpdate();
      if (res.ok) {
        if (!res.body) throw new WorklyError("http_error", "Workly вернул ответ не в формате JSON");
        return res.body;
      }
      const code = codeOf(res.body);
      if (code === CODE_BAD_TOKEN) {
        if (retried) throw new WorklyError("auth_failed", "Workly не принял новый ключ доступа (код 7008)");
        retried = true;
        this.unsaved = null;
        try {
          await this.deps.redis.del(this.cacheKey());
        } catch {
          // Ошибку Redis не пробрасываем: в её полях (command) может оказаться содержимое запроса.
          throw new WorklyError("http_error", "Redis недоступен: не удалось сбросить ключ доступа Workly");
        }
        continue;
      }
      throw httpError(res.status, code);
    }
  }

  private async send(url: string, init: RequestInit): Promise<Reply> {
    let res: Response;
    try {
      res = await this.fetchFn(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch {
      // Текст исходной ошибки не берём: в нём может оказаться адрес или данные запроса.
      throw new WorklyError("http_error", "Workly недоступен: сбой сети или превышено время ожидания");
    }
    let body: Reply["body"] = null;
    try {
      const parsed = await res.json();
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
    } catch {
      // тело не JSON: body остаётся null
    }
    return { status: res.status, ok: res.ok, body };
  }

  // ---- ключ доступа ----

  private cacheKey(): string {
    return `${process.env.PROJECT_PREFIX}workly_token:${this.creds.key}`;
  }

  private token(): Promise<string> {
    this.inflight ??= this.resolveToken().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async resolveToken(): Promise<string> {
    const cached = await this.readCache();
    const nowMs = this.now().getTime();
    if (cached && cached.expires_at - nowMs > REFRESH_BEFORE_MS) return cached.access_token;
    try {
      if (cached?.refresh_token) {
        try {
          return (await this.requestToken({ grant_type: "refresh_token", refresh_token: cached.refresh_token }, cached.refresh_token))
            .access_token;
        } catch (e) {
          // Отказ в обновлении лечится входом по паролю; неверный клиент и принудительное обновление приложения не лечатся.
          if (isFatal(e)) throw e;
        }
      }
      const login = { grant_type: "password", username: this.creds.username, password: this.creds.password };
      return (await this.requestToken(login, "")).access_token;
    } catch (e) {
      // Workly временно недоступен, а прежний ключ ещё действует: работаем с ним.
      if (cached && cached.expires_at > nowMs && !isFatal(e)) return cached.access_token;
      throw e;
    }
  }

  private async readCache(): Promise<StoredToken | null> {
    let raw: string | null;
    try {
      raw = await this.deps.redis.get(this.cacheKey());
    } catch {
      // Ошибку Redis не пробрасываем: в её полях (command) может оказаться содержимое запроса.
      throw new WorklyError("http_error", "Redis недоступен: не удалось прочитать ключ доступа Workly");
    }
    if (!raw) return this.unsaved;
    try {
      const p = JSON.parse(raw);
      if (typeof p?.access_token === "string" && p.access_token && typeof p.expires_at === "number") {
        return {
          access_token: p.access_token,
          refresh_token: typeof p.refresh_token === "string" ? p.refresh_token : "",
          expires_at: p.expires_at,
        };
      }
    } catch {
      // повреждённое значение считаем отсутствием ключа
    }
    return null;
  }

  // Запрос к /v1/oauth/token; тело запроса не логируется. fallbackRefresh — прежний refresh_token,
  // если в ответе на обновление нового нет.
  private async requestToken(grant: Record<string, string>, fallbackRefresh: string): Promise<StoredToken> {
    const form = new URLSearchParams({
      ...grant,
      client_id: this.creds.clientId,
      client_secret: this.creds.clientSecret,
    });
    const res = await this.send(`${this.creds.baseUrl}/v1/oauth/token`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    if (res.status === HTTP_FORCE_UPDATE) throw forceUpdate();
    if (!res.ok) {
      const code = codeOf(res.body);
      // 7005 при входе по паролю значит, что клиенту запрещён этот тип авторизации. При обновлении это не приговор:
      // пробуем вход по паролю, поэтому там 7005 остаётся обычным отказом (http_error).
      if (code === CODE_BAD_CLIENT || (code === CODE_BAD_GRANT && grant.grant_type === "password")) {
        throw new WorklyError("client_invalid", `Workly отклонил client_id/client_secret (код ${code})`);
      }
      if (code === CODE_WRONG_LOGIN) throw new WorklyError("auth_failed", "Workly: неверный логин или пароль (код 7002)");
      throw httpError(res.status, code);
    }
    const access = res.body?.access_token;
    if (typeof access !== "string" || !access) {
      throw new WorklyError("http_error", "Workly вернул вход без ключа доступа");
    }
    const rawExpires = res.body?.expires_in;
    const expiresIn = typeof rawExpires === "number" && rawExpires > 0 ? rawExpires : DEFAULT_EXPIRES_IN_S;
    const refresh = res.body?.refresh_token;
    const stored: StoredToken = {
      access_token: access,
      refresh_token: typeof refresh === "string" && refresh ? refresh : fallbackRefresh,
      expires_at: this.now().getTime() + expiresIn * 1000,
    };
    // Ключ живёт в Redis ровно до конца срока. Сбой записи не мешает работе: ключ остаётся в памяти клиента.
    // Саму ошибку не сохраняем и не логируем: ioredis кладёт в err.command аргументы SET, а в них оба ключа.
    try {
      await this.deps.redis.set(this.cacheKey(), JSON.stringify(stored), "EX", Math.ceil(expiresIn));
      this.unsaved = null;
    } catch {
      this.unsaved = stored;
    }
    return stored;
  }
}

function dayKey(i: LateInItem | AbsenceItem): string {
  return `${i.employee.id}|${i.scheduled.report_date}`;
}

// Подмена фабрики в тестах других модулей.
let factory: typeof clientFor | null = null;

export function setClientFactory(f: typeof clientFor | null): void {
  factory = f;
}

// Клиент подключения по переменным окружения; без них — WorklyError("not_configured").
export function clientFor(key: ConnKey, redis: Redis): WorklyClient {
  if (factory) return factory(key, redis);
  const creds = credsFromEnv(key, process.env);
  if (!creds) throw new WorklyError("not_configured", `Подключение Workly ${key} не настроено: нет переменных WORKLY_*`);
  return new WorklyClient(creds, { redis });
}
