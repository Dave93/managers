import { describe, expect, it } from "bun:test";
import { IikoError, passwordHash, withIikoClient } from "./iiko-client";

type Call = { url: string; init?: RequestInit };

function fakeFetch(routes: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const f = (async (input: any, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    return routes(url, init);
  }) as unknown as typeof fetch;
  return { f, calls };
}

const BASE = "https://iiko.test/resto/api";
const opts = (f: typeof fetch) => ({ base: BASE, login: "api", password: "secret", fetch: f, retries: 1 });

describe("passwordHash", () => {
  it("sha1 от пароля; готовый sha1 не трогает", () => {
    expect(passwordHash("secret")).toBe("e5e9fa1ba31ecd1ae84f75caaa474f3a663f05f4");
    expect(passwordHash("E5E9FA1BA31ECD1AE84F75CAAA474F3A663F05F4")).toBe("e5e9fa1ba31ecd1ae84f75caaa474f3a663f05f4");
  });
});

describe("withIikoClient", () => {
  it("auth → запросы с key → logout; формат дат и тело OLAP", async () => {
    const xml = `<storeReportItemDtoes><storeReportItemDto><sum>-5</sum><date>31.08.2026</date><type>INVENTORY_CORRECTION</type><documentId>d1</documentId><documentComment>Месяц</documentComment><documentNum>2115</documentNum><primaryStore>s1</primaryStore></storeReportItemDto></storeReportItemDtoes>`;
    const { f, calls } = fakeFetch((url) => {
      if (url.includes("/auth?")) return new Response("KEY1");
      if (url.includes("/reports/storeOperations")) return new Response(xml);
      if (url.includes("/v2/reports/olap")) {
        return Response.json({ data: [{ "Account.Id": "s1", Document: "2115", "DateTime.Typed": "2026-08-31T23:59:00", "Product.Id": "p1", "Product.Name": "Вода", Amount: 9, "Sum.ResignedSum": 100 }] });
      }
      if (url.includes("/v2/reports/balance/stores")) return Response.json([{ store: "s1", product: "p1", amount: 15, sum: 300 }]);
      if (url.includes("/logout")) return new Response("");
      return new Response("nope", { status: 404 });
    });

    const res = await withIikoClient(async (c) => ({
      docs: await c.inventoryDocs("2026-08-31"),
      corr: await c.corrections("2026-08-31"),
      bal: await c.balance("s1", "2026-08-31T23:58:00"),
    }), opts(f));

    expect(res.docs).toEqual([{ id: "d1", num: "2115", comment: "Месяц", store_id: "s1", date: "2026-08-31", shortage_sum: -5, surplus_sum: 0 }]);
    expect(res.corr[0]).toEqual({ store_id: "s1", doc_num: "2115", at: "2026-08-31T23:59:00", product_id: "p1", product_name: "Вода", qty: 9, sum: 100 });
    expect(res.bal).toEqual([{ product_id: "p1", amount: 15, sum: 300 }]);

    expect(calls[0].url).toBe(`${BASE}/auth?login=api&pass=e5e9fa1ba31ecd1ae84f75caaa474f3a663f05f4`);
    const ops = calls.find((c) => c.url.includes("storeOperations"))!.url;
    expect(ops).toContain("key=KEY1");
    expect(ops).toContain("dateFrom=31.08.2026&dateTo=31.08.2026");
    expect(ops).toContain("documentTypes=INCOMING_INVENTORY");
    const olap = calls.find((c) => c.url.includes("/v2/reports/olap"))!;
    expect(olap.init?.method).toBe("POST");
    const body = JSON.parse(String(olap.init?.body));
    expect(body.filters["DateTime.DateTyped"]).toEqual({ filterType: "DateRange", periodType: "CUSTOM", from: "2026-08-31", to: "2026-09-01", includeLow: true, includeHigh: false });
    expect(body.filters.TransactionType.values).toEqual(["INVENTORY_CORRECTION"]);
    expect(calls.find((c) => c.url.includes("balance/stores"))!.url).toContain("timestamp=2026-08-31T23%3A58%3A00&store=s1");
    expect(calls.at(-1)!.url).toBe(`${BASE}/logout?key=KEY1`);
  });

  it("logout вызывается, даже если fn бросил", async () => {
    const { f, calls } = fakeFetch((url) => new Response(url.includes("/auth?") ? "K" : ""));
    await expect(withIikoClient(async () => { throw new Error("boom"); }, opts(f))).rejects.toThrow("boom");
    expect(calls.at(-1)!.url).toBe(`${BASE}/logout?key=K`);
  });

  it("5xx повторяется, 4xx — сразу IikoError", async () => {
    let n = 0;
    const { f } = fakeFetch((url) => {
      if (url.includes("/auth?")) return new Response("K");
      if (url.includes("balance")) {
        n++;
        return n === 1 ? new Response("busy", { status: 503 }) : Response.json([]);
      }
      if (url.includes("storeOperations")) return new Response("License", { status: 403 });
      return new Response("");
    });
    await withIikoClient(async (c) => {
      expect(await c.balance("s1", "2026-08-31T23:58:00")).toEqual([]);
      await expect(c.inventoryDocs("2026-08-31")).rejects.toBeInstanceOf(IikoError);
    }, opts(f));
    expect(n).toBe(2);
  });

  it("зависший logout не держит задачу — обрывается по тайм-ауту", async () => {
    const f = (async (input: any, init?: RequestInit) => {
      if (String(input).includes("/auth?")) return new Response("K");
      return new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
    }) as unknown as typeof fetch;
    const t0 = Date.now();
    expect(await withIikoClient(async () => 42, { ...opts(f), logoutTimeoutMs: 50 })).toBe(42);
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it("без логина/пароля — понятная ошибка, сеть не трогается", async () => {
    const { f, calls } = fakeFetch(() => new Response(""));
    await expect(withIikoClient(async () => 1, { base: BASE, fetch: f, login: "", password: "" })).rejects.toThrow("IIKO_LOGIN");
    expect(calls.length).toBe(0);
  });
});
