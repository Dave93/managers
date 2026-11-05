import { afterAll, afterEach, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { createHash } from "node:crypto";
import { inspect } from "node:util";
import { assertCompany, clientFor, setClientFactory, WorklyClient, WorklyError, type WorklyDeps } from "./client";
import { setExpectedCompanyResolver } from "./config";
import type { WorklyCreds } from "./types";

// Все запросы идут в поддельный fetch, Redis подменён Map-обёрткой: сеть и настоящие ключи не нужны.
const PASSWORD = "pw-s3cret-Zx9";
const SECRET = "cs-s3cret-Qw7";
const CREDS: WorklyCreds = {
  key: "LES",
  baseUrl: "https://api.example.test",
  clientId: "client-id-1",
  clientSecret: SECRET,
  username: "bot@example.test",
  password: PASSWORD,
};
const T0 = new Date("2026-10-01T10:00:00Z");
const MONTH_S = 2592000; // 30 суток: срок ключа Workly
const DAY_MS = 86_400_000;

// Ключ кэша токена в Redis: подключение и первые 12 символов sha256 от адреса, client_id и логина
// (через перевод строки). Секретов в хэше нет; другая учётка — другой ключ кэша.
const tokenKeyOf = (c: WorklyCreds) =>
  `test_workly_token:${c.key}:${createHash("sha256").update(`${c.baseUrl}\n${c.clientId}\n${c.username}`).digest("hex").slice(0, 12)}`;
const TOKEN_KEY = tokenKeyOf(CREDS);

// Префикс ключей Redis для этого файла; прежнее значение возвращается после него, чтобы
// не задеть другие тестовые файлы того же процесса.
const savedPrefix = process.env.PROJECT_PREFIX;
beforeAll(() => {
  process.env.PROJECT_PREFIX = "test_";
});
afterAll(() => {
  // undefined в process.env записался бы строкой "undefined": такую переменную удаляем.
  if (savedPrefix === undefined) delete process.env.PROJECT_PREFIX;
  else process.env.PROJECT_PREFIX = savedPrefix;
});

afterEach(() => setClientFactory(null));

interface Call {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: Headers;
  form: URLSearchParams | null;
}
interface Reply {
  status?: number;
  body: unknown;
}

function fakeRedis() {
  const store = new Map<string, string>();
  const ttls = new Map<string, number>();
  const redis = {
    get: async (k: string) => store.get(k) ?? null,
    set: async (k: string, v: string, mode?: string, ttl?: number) => {
      store.set(k, v);
      if (mode === "EX" && ttl !== undefined) ttls.set(k, ttl);
      return "OK";
    },
    del: async (...keys: string[]) => {
      let n = 0;
      for (const k of keys) if (store.delete(k)) n++;
      return n;
    },
  } as unknown as WorklyDeps["redis"];
  return { store, ttls, redis };
}

// Redis, у которого одна из команд падает ошибкой в стиле ioredis: err.command.args несёт аргументы команды.
const LEAK = "LEAK-MARKER-4711";
function brokenRedis(op: "get" | "set" | "del") {
  const base = fakeRedis();
  const fail = (name: string) => async (...args: unknown[]) => {
    throw Object.assign(new Error(`MISCONF ${LEAK}`), { command: { name, args: [...args, LEAK] } });
  };
  (base.redis as unknown as Record<string, unknown>)[op] = fail(op);
  return base;
}

// Ошибка должна быть чистой WorklyError: без command, без cause и без следов исходной ошибки Redis.
function expectCleanRedisError(err: unknown, tokens: string[] = []) {
  expect(err).toBeInstanceOf(WorklyError);
  const e = err as WorklyError;
  expect(e.code).toBe("http_error");
  expect(e.message).toContain("Redis");
  expect("command" in e).toBe(false);
  expect(e.cause).toBeUndefined();
  for (const secret of [LEAK, "MISCONF", ...tokens]) {
    expect(e.message).not.toContain(secret);
    expect(JSON.stringify(e)).not.toContain(secret);
    expect(inspect(e)).not.toContain(secret);
  }
}

// Поддельный сервер: handler получает разобранный запрос и отдаёт status + body.
function fakeServer(handler: (c: Call, calls: Call[]) => Reply) {
  const calls: Call[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    const isForm = (headers.get("content-type") ?? "").includes("application/x-www-form-urlencoded");
    const call: Call = {
      method: init?.method ?? "GET",
      path: url.pathname,
      query: url.searchParams,
      headers,
      form: isForm ? new URLSearchParams(String(init?.body)) : null,
    };
    calls.push(call);
    const r = handler(call, calls);
    return new Response(JSON.stringify(r.body), {
      status: r.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  const tokenCalls = () => calls.filter((c) => c.path === "/v1/oauth/token");
  const apiCalls = (path: string) => calls.filter((c) => c.path === path);
  return { calls, fetch: fetchFn, tokenCalls, apiCalls };
}

// Выдача ключей: tok-1, tok-2... и ref-1, ref-2...
function tokenReplier() {
  let n = 0;
  return (c: Call): Reply | null => {
    if (c.path !== "/v1/oauth/token") return null;
    n++;
    return {
      body: {
        access_token: `tok-${n}`,
        expires_in: MONTH_S,
        token_type: "Bearer",
        scope: "",
        refresh_token: `ref-${n}`,
      },
    };
  };
}

// Страницы по таблице «страница → записи»; запрос за пределом возвращает последнюю страницу повторно.
// pageCount в _meta завышен (как у настоящего Workly, где totalCount раздут JOIN-ом по должностям).
function pageReply(pages: unknown[][], q: URLSearchParams, pageCount = pages.length + 2): Reply {
  const requested = Number(q.get("page") ?? "1");
  const real = Math.min(requested, pages.length);
  return {
    body: {
      items: pages[real - 1],
      _meta: { totalCount: 9999, pageCount, currentPage: real, perPage: 50 },
    },
  };
}

const emp = (id: number) => ({ id, first_name: `N${id}`, last_name: "L", patronymic: "", tab_number: String(id) });
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

function makeClient(
  handler: (c: Call, calls: Call[]) => Reply,
  opts: { now?: () => Date; redis?: ReturnType<typeof fakeRedis> } = {},
) {
  const srv = fakeServer(handler);
  const r = opts.redis ?? fakeRedis();
  const client = new WorklyClient(CREDS, { redis: r.redis, fetch: srv.fetch, now: opts.now ?? (() => T0) });
  return { client, srv, r };
}

describe("workly/client: обход страниц", () => {
  it("дедуплицирует и останавливается, когда currentPage не равен запрошенной", async () => {
    const pages = [range(1, 44).map(emp), range(45, 94).map(emp), range(95, 144).map(emp)];
    const tok = tokenReplier();
    const { client, srv } = makeClient((c) => tok(c) ?? pageReply(pages, c.query));
    const list = await client.employees();
    expect(new Set(list.map((e) => e.id)).size).toBe(144);
    expect(list.length).toBe(144);
    // страницы 1-3 с данными и страница 4, вернувшая третью повторно
    expect(srv.apiCalls("/v1/employees").length).toBe(4);
    expect(srv.apiCalls("/v1/employees").map((c) => c.query.get("page"))).toEqual(["1", "2", "3", "4"]);
  });

  it("убирает повторы внутри страницы и между страницами (JOIN по должностям)", async () => {
    const pages = [[emp(1), emp(2), emp(2)], [emp(2), emp(3)]];
    const tok = tokenReplier();
    const { client } = makeClient((c) => tok(c) ?? pageReply(pages, c.query));
    expect((await client.employees()).map((e) => e.id)).toEqual([1, 2, 3]);
  });

  it("останавливается после страницы, равной pageCount, без лишнего запроса", async () => {
    const pages = [range(1, 5).map(emp), range(6, 8).map(emp)];
    const tok = tokenReplier();
    const { client, srv } = makeClient((c) => tok(c) ?? pageReply(pages, c.query, 2));
    expect((await client.employees()).length).toBe(8);
    expect(srv.apiCalls("/v1/employees").length).toBe(2);
  });

  it("пустая страница завершает обход", async () => {
    const tok = tokenReplier();
    const { client, srv } = makeClient(
      (c) => tok(c) ?? { body: { items: [], _meta: { totalCount: 0, pageCount: 1, currentPage: 1, perPage: 50 } } },
    );
    expect(await client.employees()).toEqual([]);
    expect(srv.apiCalls("/v1/employees").length).toBe(1);
  });

  it("ходит с заголовком limit: 50 и Bearer", async () => {
    const tok = tokenReplier();
    const { client, srv } = makeClient((c) => tok(c) ?? pageReply([[emp(1)]], c.query, 1));
    await client.employees();
    const first = srv.apiCalls("/v1/employees")[0]!;
    expect(first.method).toBe("GET");
    expect(first.headers.get("limit")).toBe("50");
    expect(first.headers.get("authorization")).toBe("Bearer tok-1");
    expect(first.query.get("page")).toBe("1");
  });

  it("dismissed и locations ходят на свои пути и дедуплицируют по id", async () => {
    const tok = tokenReplier();
    const { client, srv } = makeClient(
      (c) =>
        tok(c) ??
        pageReply(
          c.path === "/v1/locations" ? [[{ id: 7, title: "A" }, { id: 7, title: "A" }, { id: 8, title: "B" }]] : [[emp(1), emp(1)]],
          c.query,
          1,
        ),
    );
    expect((await client.locations()).map((l) => l.id)).toEqual([7, 8]);
    expect((await client.dismissed()).map((d) => d.id)).toEqual([1]);
    expect(srv.apiCalls("/v1/locations").length).toBe(1);
    expect(srv.apiCalls("/v1/employees/dismissed").length).toBe(1);
  });

  it("companyId читает company_id из /v1/accounts", async () => {
    const tok = tokenReplier();
    const { client, srv } = makeClient((c) => tok(c) ?? { body: { id: 5, company_id: 4242 } });
    expect(await client.companyId()).toBe(4242);
    expect(srv.apiCalls("/v1/accounts").length).toBe(1);
  });

  it("companyId без числа в ответе даёт http_error", async () => {
    const tok = tokenReplier();
    const { client } = makeClient((c) => tok(c) ?? { body: { id: 5 } });
    await expect(client.companyId()).rejects.toMatchObject({ name: "WorklyError", code: "http_error" });
  });
});

describe("workly/client: отчёты", () => {
  it("t12 шлёт start_date/end_date и дедуплицирует по employee_id", async () => {
    const items = [
      { employee_id: 1, report: { days: [] } },
      { employee_id: 2, report: null },
      { employee_id: 1, report: { days: [] } },
    ];
    const tok = tokenReplier();
    const { client, srv } = makeClient((c) => tok(c) ?? pageReply([items], c.query, 1));
    const res = await client.t12("2026-09-01", "2026-09-30");
    expect(res.map((r) => r.employee_id)).toEqual([1, 2]);
    const q = srv.apiCalls("/v1/reports/t12")[0]!.query;
    expect(q.get("start_date")).toBe("2026-09-01");
    expect(q.get("end_date")).toBe("2026-09-30");
  });

  it("lateIn и absence различают дни одного сотрудника и убирают повтор по employee.id|report_date", async () => {
    const mk = (id: number, day: string) => ({
      employee: { id },
      scheduled: { report_date: day, timeoff_id: null },
      actual: { first_in: null, last_out: null, late_in: null },
    });
    const items = [mk(1, "2026-09-01"), mk(1, "2026-09-02"), mk(1, "2026-09-01"), mk(2, "2026-09-01")];
    const tok = tokenReplier();
    const { client, srv } = makeClient((c) => tok(c) ?? pageReply([items], c.query, 1));
    const late = await client.lateIn("2026-09-01", "2026-09-30");
    expect(late.map((i) => `${i.employee.id}|${i.scheduled.report_date}`)).toEqual([
      "1|2026-09-01",
      "1|2026-09-02",
      "2|2026-09-01",
    ]);
    const abs = await client.absence("2026-09-01", "2026-09-30");
    expect(abs.length).toBe(3);
    expect(srv.apiCalls("/v1/reports/late-in")[0]!.query.get("start_date")).toBe("2026-09-01");
    expect(srv.apiCalls("/v1/reports/absence")[0]!.query.get("end_date")).toBe("2026-09-30");
  });
});

describe("workly/client: действия пользователей", () => {
  const act = (id: number | string, action_name: string) => ({
    id,
    action_name,
    user: { id: 139, full_name: "Имя Фамилия" },
    object_id: "452374",
    person_id: 452374,
    message: "Имя Фамилия изменил(а) профиль сотрудника Тест Тестов",
    created_at: "2026-11-05 11:53:48",
  });

  it("userActivities шлёт start_date/end_date, убирает повторы по id и отдаёт только id и action_name", async () => {
    const pages = [[act(30, "addEmployee"), act(29, "clockInManual")], [act(29, "clockInManual"), act("28", "dismissEmployee")]];
    const tok = tokenReplier();
    const { client, srv } = makeClient((c) => tok(c) ?? pageReply(pages, c.query, 2));
    const res = await client.userActivities("2026-11-04", "2026-11-06");
    expect(res).toEqual([
      { id: 30, action_name: "addEmployee" },
      { id: 29, action_name: "clockInManual" },
      { id: 28, action_name: "dismissEmployee" },
    ]);
    // Ни имён, ни текста сообщений в результате нет.
    expect(JSON.stringify(res)).not.toContain("Фамилия");
    const q = srv.apiCalls("/v1/user-activities")[0]!.query;
    expect(q.get("start_date")).toBe("2026-11-04");
    expect(q.get("end_date")).toBe("2026-11-06");
    expect(q.get("page")).toBe("1");
  });

  it("пустой список — пустой результат", async () => {
    const tok = tokenReplier();
    const { client } = makeClient(
      (c) => tok(c) ?? { body: { items: [], _meta: { totalCount: 0, pageCount: 0, currentPage: 1, perPage: 50 } } },
    );
    expect(await client.userActivities("2026-11-04", "2026-11-06")).toEqual([]);
  });

  it("испорченная запись (id не целое, нет action_name) пропускается, остальные читаются: одно событие не глушит опрос", async () => {
    const bads = [
      { ...act(1, "addEmployee"), id: "abc" },
      { ...act(2, "addEmployee"), id: 1.5 },
      { ...act(3, "addEmployee"), id: null },
      { ...act(4, "x"), action_name: 5 },
      null,
    ];
    const tok = tokenReplier();
    const { client } = makeClient((c) => tok(c) ?? pageReply([[act(30, "addEmployee"), ...bads, act("28", "dismissEmployee")]], c.query, 1));
    expect(await client.userActivities("2026-11-04", "2026-11-06")).toEqual([
      { id: 30, action_name: "addEmployee" },
      { id: 28, action_name: "dismissEmployee" },
    ]);
  });

  it("список непустой, но ни одной годной записи — http_error без текста записи (формат ответа изменился)", async () => {
    const tok = tokenReplier();
    const { client } = makeClient(
      (c) => tok(c) ?? pageReply([[{ ...act(1, "addEmployee"), id: "abc" }, { ...act(2, "x"), action_name: 5 }]], c.query, 1),
    );
    const err = await client.userActivities("2026-11-04", "2026-11-06").then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(WorklyError);
    expect((err as WorklyError).code).toBe("http_error");
    expect(String((err as WorklyError).message)).not.toContain("Фамилия");
  });
});

describe("workly/client: ключ доступа", () => {
  it("входит по паролю формой x-www-form-urlencoded и кладёт ключ в Redis с TTL expires_in", async () => {
    const tok = tokenReplier();
    const { client, srv, r } = makeClient((c) => tok(c) ?? pageReply([[{ id: 1, title: "A" }]], c.query, 1));
    await client.locations();
    const login = srv.tokenCalls()[0]!;
    expect(login.method).toBe("POST");
    expect(login.headers.get("content-type")).toContain("application/x-www-form-urlencoded");
    expect(Object.fromEntries(login.form!)).toEqual({
      grant_type: "password",
      client_id: CREDS.clientId,
      client_secret: SECRET,
      username: CREDS.username,
      password: PASSWORD,
    });
    const key = TOKEN_KEY;
    expect(JSON.parse(r.store.get(key)!)).toEqual({
      access_token: "tok-1",
      refresh_token: "ref-1",
      expires_at: T0.getTime() + MONTH_S * 1000,
    });
    expect(r.ttls.get(key)).toBe(MONTH_S);
  });

  it("берёт ключ из Redis и не логинится повторно", async () => {
    const tok = tokenReplier();
    const { client, srv } = makeClient((c) => tok(c) ?? pageReply([[{ id: 1, title: "A" }]], c.query, 1));
    await client.locations();
    await client.locations();
    expect(srv.tokenCalls().length).toBe(1);
    expect(srv.apiCalls("/v1/locations").length).toBe(2);
  });

  it("другой экземпляр клиента подхватывает ключ из общего Redis", async () => {
    const tok = tokenReplier();
    const redis = fakeRedis();
    const handler = (c: Call) => tok(c) ?? pageReply([[{ id: 1, title: "A" }]], c.query, 1);
    const a = makeClient(handler, { redis });
    const b = makeClient(handler, { redis });
    await a.client.locations();
    await b.client.locations();
    expect(a.srv.tokenCalls().length).toBe(1);
    expect(b.srv.tokenCalls().length).toBe(0);
    expect(b.srv.apiCalls("/v1/locations")[0]!.headers.get("authorization")).toBe("Bearer tok-1");
  });

  // Ключ кэша зависит от учётки: после исправления ключей в .env прежний токен (например,
  // учётки чужой компании) не подхватывается, и новый вход идёт сразу.
  function sharedRedisClients() {
    const tok = tokenReplier();
    const r = fakeRedis();
    const srv = fakeServer((c) => tok(c) ?? pageReply([[{ id: 1, title: "A" }]], c.query, 1));
    const mk = (creds: WorklyCreds) => new WorklyClient(creds, { redis: r.redis, fetch: srv.fetch, now: () => T0 });
    const authOf = (n: number) => srv.apiCalls("/v1/locations")[n]!.headers.get("authorization");
    return { r, srv, mk, authOf };
  }

  it("другой client_id или логин того же подключения — свой ключ кэша и свой вход, чужой токен не берётся", async () => {
    const s = sharedRedisClients();
    const otherClient = { ...CREDS, clientId: "client-id-2" };
    const otherUser = { ...CREDS, username: "bot2@example.test" };
    const otherBase = { ...CREDS, baseUrl: "https://api2.example.test" };
    await s.mk(CREDS).locations();
    await s.mk(otherClient).locations();
    await s.mk(otherUser).locations();
    await s.mk(otherBase).locations();
    expect(s.srv.tokenCalls().length).toBe(4);
    expect([0, 1, 2, 3].map(s.authOf)).toEqual(["Bearer tok-1", "Bearer tok-2", "Bearer tok-3", "Bearer tok-4"]);
    const expected = [CREDS, otherClient, otherUser, otherBase].map(tokenKeyOf);
    expect(new Set(expected).size).toBe(4);
    expect([...s.r.store.keys()].sort()).toEqual([...expected].sort());
  });

  it("тот же адрес, client_id и логин — тот же ключ кэша: токен переиспользуется, пароль и секрет в ключ не входят", async () => {
    const s = sharedRedisClients();
    await s.mk(CREDS).locations();
    await s.mk({ ...CREDS }).locations();
    await s.mk({ ...CREDS, password: "pw-другой", clientSecret: "cs-другой" }).locations();
    expect(s.srv.tokenCalls().length).toBe(1);
    expect([0, 1, 2].map(s.authOf)).toEqual(["Bearer tok-1", "Bearer tok-1", "Bearer tok-1"]);
    expect([...s.r.store.keys()]).toEqual([TOKEN_KEY]);
  });

  it("в имени ключа кэша нет client_id, логина, адреса и секретов в открытом виде", async () => {
    const s = sharedRedisClients();
    await s.mk(CREDS).locations();
    const keys = [...s.r.store.keys()];
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^test_workly_token:LES:[0-9a-f]{12}$/);
    for (const v of [CREDS.clientId, CREDS.username, "example.test", SECRET, PASSWORD]) expect(keys[0]).not.toContain(v);
  });

  it("параллельные вызовы входят один раз", async () => {
    const tok = tokenReplier();
    const { client, srv } = makeClient((c) => tok(c) ?? pageReply([[{ id: 1, title: "A" }]], c.query, 1));
    await Promise.all([client.locations(), client.locations(), client.employees()]);
    expect(srv.tokenCalls().length).toBe(1);
  });

  it("обновляет ключ через refresh_token за сутки до срока", async () => {
    let now = T0;
    const tok = tokenReplier();
    const { client, srv, r } = makeClient((c) => tok(c) ?? pageReply([[{ id: 1, title: "A" }]], c.query, 1), {
      now: () => now,
    });
    await client.locations();
    const expiresAt = JSON.parse(r.store.get(TOKEN_KEY)!).expires_at as number;
    now = new Date(expiresAt - 3600_000);
    await client.locations();
    const calls = srv.tokenCalls();
    expect(calls.length).toBe(2);
    expect(Object.fromEntries(calls[1]!.form!)).toEqual({
      grant_type: "refresh_token",
      client_id: CREDS.clientId,
      client_secret: SECRET,
      refresh_token: "ref-1",
    });
    // после обновления запросы идут с новым ключом, срок считается от текущего времени
    expect(srv.apiCalls("/v1/locations")[1]!.headers.get("authorization")).toBe("Bearer tok-2");
    expect(JSON.parse(r.store.get(TOKEN_KEY)!).expires_at).toBe(now.getTime() + MONTH_S * 1000);
  });

  it("не обновляет ключ раньше чем за сутки до срока", async () => {
    let now = T0;
    const tok = tokenReplier();
    const { client, srv, r } = makeClient((c) => tok(c) ?? pageReply([[{ id: 1, title: "A" }]], c.query, 1), {
      now: () => now,
    });
    await client.locations();
    const expiresAt = JSON.parse(r.store.get(TOKEN_KEY)!).expires_at as number;
    now = new Date(expiresAt - DAY_MS - 60_000);
    await client.locations();
    expect(srv.tokenCalls().length).toBe(1);
  });

  it("если refresh_token отвергнут, входит по паролю и дальше работает с новым ключом", async () => {
    let now = T0;
    const tok = tokenReplier();
    const { client, srv, r } = makeClient(
      (c) => {
        if (c.form?.get("grant_type") === "refresh_token") return { status: 400, body: { message: "bad refresh", code: 7007 } };
        return tok(c) ?? pageReply([[{ id: 1, title: "A" }]], c.query, 1);
      },
      { now: () => now },
    );
    await client.locations();
    const expiresAt = JSON.parse(r.store.get(TOKEN_KEY)!).expires_at as number;
    now = new Date(expiresAt - 3600_000);
    expect((await client.locations()).length).toBe(1);
    expect(srv.tokenCalls().map((c) => c.form!.get("grant_type"))).toEqual(["password", "refresh_token", "password"]);
    expect(srv.apiCalls("/v1/locations")[1]!.headers.get("authorization")).toBe("Bearer tok-2");
  });

  it("истёкший ключ обновляется через refresh_token", async () => {
    let now = T0;
    const tok = tokenReplier();
    const { client, srv, r } = makeClient((c) => tok(c) ?? pageReply([[{ id: 1, title: "A" }]], c.query, 1), {
      now: () => now,
    });
    await client.locations();
    now = new Date(JSON.parse(r.store.get(TOKEN_KEY)!).expires_at + 1000);
    await client.locations();
    expect(srv.tokenCalls().map((c) => c.form!.get("grant_type"))).toEqual(["password", "refresh_token"]);
  });

  it("если Workly недоступен для входа, а старый ключ ещё действует, использует его", async () => {
    let now = T0;
    let down = false;
    const tok = tokenReplier();
    const { client, srv, r } = makeClient(
      (c) => (down && c.path === "/v1/oauth/token" ? { status: 503, body: {} } : (tok(c) ?? pageReply([[{ id: 1, title: "A" }]], c.query, 1))),
      { now: () => now },
    );
    await client.locations();
    const expiresAt = JSON.parse(r.store.get(TOKEN_KEY)!).expires_at as number;
    now = new Date(expiresAt - 3600_000);
    down = true;
    expect((await client.locations()).length).toBe(1);
    expect(srv.tokenCalls().map((c) => c.form!.get("grant_type"))).toEqual(["password", "refresh_token", "password"]);
    expect(srv.apiCalls("/v1/locations")[1]!.headers.get("authorization")).toBe("Bearer tok-1");
  });

  it("если Workly недоступен для входа, а ключ уже истёк, даёт http_error", async () => {
    let now = T0;
    let down = false;
    const tok = tokenReplier();
    const { client, r } = makeClient(
      (c) => (down && c.path === "/v1/oauth/token" ? { status: 503, body: {} } : (tok(c) ?? pageReply([[{ id: 1, title: "A" }]], c.query, 1))),
      { now: () => now },
    );
    await client.locations();
    now = new Date(JSON.parse(r.store.get(TOKEN_KEY)!).expires_at + 1000);
    down = true;
    await expect(client.locations()).rejects.toMatchObject({ code: "http_error" });
  });

  it("7005 при refresh не блокирует: входит по паролю и работает с новым ключом", async () => {
    let now = T0;
    const tok = tokenReplier();
    const { client, srv, r } = makeClient(
      (c) => {
        if (c.form?.get("grant_type") === "refresh_token") return { status: 400, body: { message: "grant", code: 7005 } };
        return tok(c) ?? pageReply([[{ id: 1, title: "A" }]], c.query, 1);
      },
      { now: () => now },
    );
    await client.locations();
    const expiresAt = JSON.parse(r.store.get(TOKEN_KEY)!).expires_at as number;
    now = new Date(expiresAt - 3600_000);
    expect((await client.locations()).length).toBe(1);
    expect(srv.tokenCalls().map((c) => c.form!.get("grant_type"))).toEqual(["password", "refresh_token", "password"]);
    expect(srv.apiCalls("/v1/locations")[1]!.headers.get("authorization")).toBe("Bearer tok-2");
  });

  // Обход в 5 страниц при недоступном входе: прежний ключ ещё действует, обновление не удалось.
  function downDuringCrawl() {
    let now = T0;
    let down = false;
    const tok = tokenReplier();
    const pages = [1, 2, 3, 4, 5].map((p) => range(p * 10, p * 10 + 2).map(emp));
    let on7008: ((c: Call) => Reply | null) | null = null;
    const r = fakeRedis();
    const { client, srv } = makeClient(
      (c) => {
        if (down && c.path === "/v1/oauth/token") return { status: 503, body: {} };
        const t = tok(c);
        if (t) return t;
        const special = on7008?.(c);
        if (special) return special;
        return c.path === "/v1/employees" ? pageReply(pages, c.query, 5) : pageReply([[{ id: 1, title: "A" }]], c.query, 1);
      },
      { now: () => now, redis: r },
    );
    const grants = () => srv.tokenCalls().map((c) => c.form!.get("grant_type"));
    const auth = (page: string) =>
      srv
        .apiCalls("/v1/employees")
        .filter((c) => c.query.get("page") === page)
        .map((c) => c.headers.get("authorization"));
    return {
      client,
      srv,
      r,
      grants,
      auth,
      async loginThenNearExpiry() {
        await client.locations();
        now = new Date(JSON.parse(r.store.get(TOKEN_KEY)!).expires_at - 3600_000);
        down = true;
      },
      set7008(f: (c: Call) => Reply | null) {
        on7008 = f;
      },
      up() {
        down = false;
      },
      now: () => now,
    };
  }

  it("неудачное обновление ключа не повторяется на каждой странице того же обхода: одна попытка, дальше прежний ключ", async () => {
    const s = downDuringCrawl();
    await s.loginThenNearExpiry();
    const list = await s.client.employees();
    expect(list.length).toBe(15);
    // Вход при первом вызове, затем одна неудачная пара «обновление + вход» на весь обход из 5 страниц.
    expect(s.grants()).toEqual(["password", "refresh_token", "password"]);
    for (const page of ["1", "2", "3", "4", "5"]) expect(s.auth(page)).toEqual(["Bearer tok-1"]);
    // Второй обход тем же экземпляром тоже не стучится во вход: экземпляр помнит неудачу.
    await s.client.locations();
    expect(s.grants()).toEqual(["password", "refresh_token", "password"]);
  });

  it("после неудачного обновления 7008 всё равно даёт один повторный вход, обход продолжается с новым ключом", async () => {
    const s = downDuringCrawl();
    await s.loginThenNearExpiry();
    let fired = false;
    s.set7008((c) => {
      if (c.path !== "/v1/employees" || c.query.get("page") !== "3" || fired) return null;
      fired = true;
      s.up();
      return { status: 400, body: { message: "Invalid access token", code: 7008 } };
    });
    expect((await s.client.employees()).length).toBe(15);
    expect(s.grants()).toEqual(["password", "refresh_token", "password", "password"]);
    expect(s.auth("2")).toEqual(["Bearer tok-1"]);
    expect(s.auth("3")).toEqual(["Bearer tok-1", "Bearer tok-2"]);
    expect(s.auth("5")).toEqual(["Bearer tok-2"]);
  });

  it("новый экземпляр клиента после чужой неудачи пробует обновить ключ снова", async () => {
    const s = downDuringCrawl();
    await s.loginThenNearExpiry();
    await s.client.employees();
    expect(s.grants()).toHaveLength(3);
    const fresh = new WorklyClient(CREDS, { redis: s.r.redis, fetch: s.srv.fetch, now: s.now });
    expect((await fresh.locations()).length).toBe(1);
    expect(s.grants()).toEqual(["password", "refresh_token", "password", "refresh_token", "password"]);
  });

  it("7005 при refresh и недоступный вход: используется ещё действующий ключ, а не client_invalid", async () => {
    let now = T0;
    let down = false;
    const tok = tokenReplier();
    const { client, srv, r } = makeClient(
      (c) => {
        if (down && c.form?.get("grant_type") === "refresh_token") return { status: 400, body: { code: 7005 } };
        if (down && c.path === "/v1/oauth/token") return { status: 503, body: {} };
        return tok(c) ?? pageReply([[{ id: 1, title: "A" }]], c.query, 1);
      },
      { now: () => now },
    );
    await client.locations();
    now = new Date(JSON.parse(r.store.get(TOKEN_KEY)!).expires_at - 3600_000);
    down = true;
    expect((await client.locations()).length).toBe(1);
    expect(srv.apiCalls("/v1/locations")[1]!.headers.get("authorization")).toBe("Bearer tok-1");
  });

  it("сбой записи ключа в Redis не ломает вызов, ключ остаётся в памяти и ничего не логируется", async () => {
    const spies = (["error", "warn", "log"] as const).map((m) => spyOn(console, m).mockImplementation(() => {}));
    try {
      const tok = tokenReplier();
      const { client, srv } = makeClient((c) => tok(c) ?? pageReply([[{ id: 1, title: "A" }]], c.query, 1), {
        redis: brokenRedis("set"),
      });
      expect((await client.locations()).length).toBe(1);
      expect((await client.locations()).length).toBe(1);
      // второй вызов берёт ключ из памяти, а не входит заново
      expect(srv.tokenCalls().length).toBe(1);
      expect(srv.apiCalls("/v1/locations")[1]!.headers.get("authorization")).toBe("Bearer tok-1");
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  it("при сбое записи в Redis ошибка Workly не несёт command с ключами", async () => {
    const tok = tokenReplier();
    const { client } = makeClient((c) => tok(c) ?? { status: 500, body: { code: 9 } }, { redis: brokenRedis("set") });
    const err = await client.employees().catch((e) => e);
    expect(err).toBeInstanceOf(WorklyError);
    expect(err.code).toBe("http_error");
    expect("command" in err).toBe(false);
    expect(err.cause).toBeUndefined();
    for (const secret of [LEAK, "tok-1", "ref-1"]) {
      expect(JSON.stringify(err)).not.toContain(secret);
      expect(inspect(err)).not.toContain(secret);
    }
  });

  it("сбой чтения ключа из Redis даёт чистую WorklyError http_error", async () => {
    const tok = tokenReplier();
    const { client, srv } = makeClient((c) => tok(c) ?? pageReply([[{ id: 1, title: "A" }]], c.query, 1), {
      redis: brokenRedis("get"),
    });
    expectCleanRedisError(await client.locations().catch((e) => e));
    expect(srv.calls.length).toBe(0);
  });

  it("сбой сброса ключа в Redis при 7008 даёт чистую WorklyError http_error", async () => {
    const tok = tokenReplier();
    const { client } = makeClient((c) => tok(c) ?? { status: 400, body: { message: "Invalid access token", code: 7008 } }, {
      redis: brokenRedis("del"),
    });
    expectCleanRedisError(await client.employees().catch((e) => e), ["tok-1", "ref-1"]);
  });

  it("при 7008 на странице 5 берёт новый ключ один раз и продолжает без дублей", async () => {
    const pages = [range(1, 50), range(51, 100), range(101, 150), range(151, 200), range(201, 250), range(251, 270)].map(
      (p) => p.map(emp),
    );
    let failed = false;
    const tok = tokenReplier();
    const { client, srv, r } = makeClient((c) => {
      const t = tok(c);
      if (t) return t;
      if (c.query.get("page") === "5" && !failed) {
        failed = true;
        return { status: 400, body: { message: "Invalid access token", code: 7008 } };
      }
      return pageReply(pages, c.query, 6);
    });
    const list = await client.employees();
    expect(list.length).toBe(270);
    expect(new Set(list.map((e) => e.id)).size).toBe(270);
    expect(srv.tokenCalls().map((c) => c.form!.get("grant_type"))).toEqual(["password", "password"]);
    const page5 = srv.apiCalls("/v1/employees").filter((c) => c.query.get("page") === "5");
    expect(page5.map((c) => c.headers.get("authorization"))).toEqual(["Bearer tok-1", "Bearer tok-2"]);
    expect(JSON.parse(r.store.get(TOKEN_KEY)!).access_token).toBe("tok-2");
  });

  it("7008 дважды подряд превращается в auth_failed", async () => {
    const tok = tokenReplier();
    const { client, srv } = makeClient((c) => tok(c) ?? { status: 400, body: { message: "Invalid access token", code: 7008 } });
    const err = await client.employees().catch((e) => e);
    expect(err).toBeInstanceOf(WorklyError);
    expect(err.code).toBe("auth_failed");
    expect(srv.tokenCalls().length).toBe(2);
    expect(srv.apiCalls("/v1/employees").length).toBe(2);
  });
});

describe("workly/client: ошибки", () => {
  it("7003 при входе даёт WorklyError client_invalid и не повторяется", async () => {
    const { client, srv } = makeClient(() => ({ status: 400, body: { message: "Invalid client", code: 7003 } }));
    const err = await client.locations().catch((e) => e);
    expect(err).toBeInstanceOf(WorklyError);
    expect(err.code).toBe("client_invalid");
    expect(srv.tokenCalls().length).toBe(1);
    expect(srv.apiCalls("/v1/locations").length).toBe(0);
  });

  it("7005 при входе тоже client_invalid", async () => {
    const { client } = makeClient(() => ({ status: 400, body: { message: "grant", code: 7005 } }));
    await expect(client.locations()).rejects.toMatchObject({ code: "client_invalid" });
  });

  it("7002 при входе даёт auth_failed", async () => {
    const { client, srv } = makeClient(() => ({ status: 400, body: { message: "wrong password", code: 7002 } }));
    await expect(client.locations()).rejects.toMatchObject({ code: "auth_failed" });
    expect(srv.tokenCalls().length).toBe(1);
  });

  it("426 даёт force_update", async () => {
    const tok = tokenReplier();
    const { client } = makeClient((c) => tok(c) ?? { status: 426, body: { message: "Upgrade required" } });
    const err = await client.employees().catch((e) => e);
    expect(err).toBeInstanceOf(WorklyError);
    expect(err.code).toBe("force_update");
  });

  it("426 при входе тоже force_update", async () => {
    const { client } = makeClient(() => ({ status: 426, body: {} }));
    await expect(client.locations()).rejects.toMatchObject({ code: "force_update" });
  });

  it("refresh с 7003 даёт client_invalid без входа по паролю", async () => {
    let now = T0;
    const tok = tokenReplier();
    const { client, srv, r } = makeClient(
      (c) => {
        if (c.form?.get("grant_type") === "refresh_token") return { status: 400, body: { code: 7003 } };
        return tok(c) ?? pageReply([[{ id: 1, title: "A" }]], c.query, 1);
      },
      { now: () => now },
    );
    await client.locations();
    const expiresAt = JSON.parse(r.store.get(TOKEN_KEY)!).expires_at as number;
    now = new Date(expiresAt - 3600_000);
    await expect(client.locations()).rejects.toMatchObject({ code: "client_invalid" });
    expect(srv.tokenCalls().length).toBe(2);
  });

  it("другие статусы и сбой сети дают http_error", async () => {
    const tok = tokenReplier();
    const a = makeClient((c) => tok(c) ?? { status: 500, body: { message: "boom", code: 1 } });
    const errA = await a.client.employees().catch((e) => e);
    expect(errA).toBeInstanceOf(WorklyError);
    expect(errA.code).toBe("http_error");
    expect(errA.message).toContain("500");

    const r = fakeRedis();
    const net = new WorklyClient(CREDS, {
      redis: r.redis,
      fetch: (async () => {
        throw new Error("socket hang up");
      }) as unknown as typeof fetch,
    });
    await expect(net.employees()).rejects.toMatchObject({ code: "http_error" });
  });

  it("ответ не JSON даёт http_error", async () => {
    const fetchFn = (async () => new Response("<html>bad gateway</html>", { status: 502 })) as unknown as typeof fetch;
    const c = new WorklyClient(CREDS, { redis: fakeRedis().redis, fetch: fetchFn });
    await expect(c.locations()).rejects.toMatchObject({ code: "http_error" });
  });

  it("сообщение ошибки не содержит пароль и client_secret", async () => {
    // сервер подло возвращает в message всё, что получил: в ошибку это попасть не должно
    const echo = (c: Call) => `echo ${c.form?.toString() ?? ""} ${c.headers.get("authorization") ?? ""} ${PASSWORD} ${SECRET} tok-1 ref-1`;
    const scenarios: { name: string; run: () => Promise<unknown> }[] = [
      {
        name: "7002",
        run: () => makeClient((c) => ({ status: 400, body: { message: echo(c), code: 7002 } })).client.locations(),
      },
      {
        name: "7003",
        run: () => makeClient((c) => ({ status: 400, body: { message: echo(c), code: 7003 } })).client.locations(),
      },
      {
        name: "426",
        run: () => makeClient((c) => ({ status: 426, body: { message: echo(c) } })).client.locations(),
      },
      {
        name: "500 на входе",
        run: () => makeClient((c) => ({ status: 500, body: { message: echo(c), code: 9 } })).client.locations(),
      },
      {
        name: "500 на странице",
        run: () => {
          const tok = tokenReplier();
          return makeClient((c) => tok(c) ?? { status: 500, body: { message: echo(c), code: 9 } }).client.employees();
        },
      },
      {
        name: "7008 дважды",
        run: () => {
          const tok = tokenReplier();
          return makeClient((c) => tok(c) ?? { status: 400, body: { message: echo(c), code: 7008 } }).client.employees();
        },
      },
      {
        name: "сбой сети с секретом в тексте",
        run: () =>
          new WorklyClient(CREDS, {
            redis: fakeRedis().redis,
            fetch: (async () => {
              throw new Error(`connect failed ${PASSWORD} ${SECRET}`);
            }) as unknown as typeof fetch,
          }).locations(),
      },
    ];
    for (const s of scenarios) {
      const err = (await s.run().catch((e) => e)) as WorklyError;
      expect(err, s.name).toBeInstanceOf(WorklyError);
      for (const secret of [PASSWORD, SECRET, "tok-1", "ref-1", "Bearer"]) {
        expect(String(err.message), s.name).not.toContain(secret);
        expect(String(err), s.name).not.toContain(secret);
      }
    }
  });
});

describe("workly/client: clientFor", () => {
  const ENV_KEYS = [
    "WORKLY_BASE_URL",
    "WORKLY_LES_CLIENT_ID",
    "WORKLY_LES_CLIENT_SECRET",
    "WORKLY_LES_USERNAME",
    "WORKLY_LES_PASSWORD",
  ];

  function withEnv(values: Record<string, string | undefined>, fn: () => void) {
    const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    try {
      for (const k of ENV_KEYS) {
        if (values[k] === undefined) delete process.env[k];
        else process.env[k] = values[k];
      }
      fn();
    } finally {
      for (const k of ENV_KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
  }

  it("кидает not_configured без переменных окружения", () => {
    withEnv({}, () => {
      let err: unknown;
      try {
        clientFor("LES", fakeRedis().redis as never);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(WorklyError);
      expect((err as WorklyError).code).toBe("not_configured");
    });
  });

  it("собирает клиент из переменных окружения", () => {
    withEnv(
      {
        WORKLY_BASE_URL: "https://api.example.test",
        WORKLY_LES_CLIENT_ID: "a",
        WORKLY_LES_CLIENT_SECRET: "b",
        WORKLY_LES_USERNAME: "c",
        WORKLY_LES_PASSWORD: "d",
      },
      () => {
        expect(clientFor("LES", fakeRedis().redis as never)).toBeInstanceOf(WorklyClient);
      },
    );
  });

  it("setClientFactory подменяет clientFor, null возвращает настоящий", () => {
    const fake = { fake: true } as unknown as WorklyClient;
    setClientFactory((key) => {
      expect(key).toBe("CHOPAR");
      return fake;
    });
    expect(clientFor("CHOPAR", fakeRedis().redis as never)).toBe(fake);
    setClientFactory(null);
    withEnv({}, () => {
      expect(() => clientFor("CHOPAR", fakeRedis().redis as never)).toThrow(WorklyError);
    });
  });
});

describe("workly/client: assertCompany", () => {
  afterEach(() => setExpectedCompanyResolver(null));

  it("своя компания проходит; чужая — WorklyError company_mismatch без номеров компаний в тексте", () => {
    expect(() => assertCompany("LES", 1237)).not.toThrow();
    expect(() => assertCompany("CHOPAR", 1238)).not.toThrow();
    let err: unknown;
    try {
      assertCompany("CHOPAR", 1237);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(WorklyError);
    expect((err as WorklyError).code).toBe("company_mismatch");
    for (const id of ["1237", "1238"]) expect(String(err)).not.toContain(id);
  });

  it("подмена, вернувшая null, пропускает проверку", () => {
    setExpectedCompanyResolver(() => null);
    expect(() => assertCompany("LES", 999_999)).not.toThrow();
  });
});
