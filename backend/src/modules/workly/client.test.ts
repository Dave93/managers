import { afterEach, beforeAll, describe, expect, it } from "bun:test";
import { clientFor, setClientFactory, WorklyClient, WorklyError, type WorklyDeps } from "./client";
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

beforeAll(() => {
  process.env.PROJECT_PREFIX = "test_";
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
    const key = "test_workly_token:LES";
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
    const expiresAt = JSON.parse(r.store.get("test_workly_token:LES")!).expires_at as number;
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
    expect(JSON.parse(r.store.get("test_workly_token:LES")!).expires_at).toBe(now.getTime() + MONTH_S * 1000);
  });

  it("не обновляет ключ раньше чем за сутки до срока", async () => {
    let now = T0;
    const tok = tokenReplier();
    const { client, srv, r } = makeClient((c) => tok(c) ?? pageReply([[{ id: 1, title: "A" }]], c.query, 1), {
      now: () => now,
    });
    await client.locations();
    const expiresAt = JSON.parse(r.store.get("test_workly_token:LES")!).expires_at as number;
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
    const expiresAt = JSON.parse(r.store.get("test_workly_token:LES")!).expires_at as number;
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
    now = new Date(JSON.parse(r.store.get("test_workly_token:LES")!).expires_at + 1000);
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
    const expiresAt = JSON.parse(r.store.get("test_workly_token:LES")!).expires_at as number;
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
    now = new Date(JSON.parse(r.store.get("test_workly_token:LES")!).expires_at + 1000);
    down = true;
    await expect(client.locations()).rejects.toMatchObject({ code: "http_error" });
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
    expect(JSON.parse(r.store.get("test_workly_token:LES")!).access_token).toBe("tok-2");
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
    const expiresAt = JSON.parse(r.store.get("test_workly_token:LES")!).expires_at as number;
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
