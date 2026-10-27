import { expect, it } from "bun:test";
import { classifyAuthFailure, createApi } from "../src/api";

const ok = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s });

it("без SDK и вне Telegram — отказ без запроса", async () => {
  const calls: string[] = [];
  const f = (async (u: string) => { calls.push(u); return ok({}); }) as any;
  expect(await createApi({ fetch: f, sdk: () => "sdk_failed", initData: () => "" }).auth()).toEqual({ kind: "fail", status: "sdk_failed" });
  expect(await createApi({ fetch: f, sdk: () => "outside", initData: () => "" }).get("/home")).toEqual({ kind: "fail", status: "outside" });
  expect(calls).toEqual([]);
});
it("401 на запросе: один повторный вход и повтор; второй 401 — expired", async () => {
  const calls: { url: string; auth: string | null }[] = [];
  const replies = [ok({ token: "t1", roles: ["employee"], lang: "ru" }), ok({ error: "unauthorized" }, 401),
    ok({ token: "t2", roles: ["employee"], lang: "ru" }), ok({ x: 1 })];
  const f = (async (url: string, init: RequestInit = {}) => { calls.push({ url, auth: new Headers(init.headers).get("Authorization") }); return replies.shift()!; }) as any;
  const a = createApi({ fetch: f, sdk: () => "ok", initData: () => "q=1" });
  expect(await a.get("/home")).toEqual({ kind: "ok", data: { x: 1 } });
  expect(calls.map((c) => [c.url, c.auth])).toEqual([["/api/kpi/tg/auth", null], ["/api/kpi/tg/home", "Bearer t1"], ["/api/kpi/tg/auth", null], ["/api/kpi/tg/home", "Bearer t2"]]);
  replies.push(ok({ error: "unauthorized" }, 401), ok({ token: "t3", roles: [], lang: "ru" }), ok({ error: "unauthorized" }, 401));
  expect(await a.get("/home")).toEqual({ kind: "fail", status: "expired" });
});
it("повторный вход после 401 получил 403 — fail с его статусом, запрос не повторяется", async () => {
  for (const code of ["inactive", "not_bound"] as const) {
    const calls: string[] = [];
    const r = [ok({ token: "t1", roles: ["employee"], lang: "ru" }), ok({ error: "unauthorized" }, 401), ok({ error: code }, 403)];
    const f = (async (url: string) => { calls.push(url); return r.shift()!; }) as any;
    expect(await createApi({ fetch: f, sdk: () => "ok", initData: () => "q" }).get("/home")).toEqual({ kind: "fail", status: code });
    expect(calls).toEqual(["/api/kpi/tg/auth", "/api/kpi/tg/home", "/api/kpi/tg/auth"]);
  }
});
it("коды входа и сеть", () => {
  expect([classifyAuthFailure(503, { error: "not_configured" }), classifyAuthFailure(401, { error: "bad_init_data" }),
    classifyAuthFailure(403, { error: "not_bound" }), classifyAuthFailure(403, { error: "inactive" }), classifyAuthFailure(502, null), classifyAuthFailure(418, null)])
    .toEqual(["not_configured", "expired", "not_bound", "inactive", "offline", "unknown"]);
});
it("сеть упала и таймаут — offline; 404 с телом — http", async () => {
  const down = (async () => { throw new TypeError("Failed to fetch"); }) as any;
  expect(await createApi({ fetch: down, sdk: () => "ok", initData: () => "q" }).auth()).toEqual({ kind: "fail", status: "offline" });
  const hang = ((_u: string, i: RequestInit) => new Promise((_, rej) => i.signal?.addEventListener("abort", () => rej(new Error("abort"))))) as any;
  expect(await createApi({ fetch: hang, sdk: () => "ok", initData: () => "q", timeoutMs: 20 }).auth()).toEqual({ kind: "fail", status: "offline" });
  const r = [ok({ token: "t", roles: ["employee"], lang: "ru" }), ok({ error: "not_found" }, 404)];
  const f = (async () => r.shift()!) as any;
  expect(await createApi({ fetch: f, sdk: () => "ok", initData: () => "q" }).get("/review?period=2026-10-01"))
    .toEqual({ kind: "http", code: 404, error: "not_found", body: { error: "not_found" } });
});

// Мои дополнения к тестам брифа: send, blob, 5xx, не-JSON, параллельный вход.
it("send: JSON-тело и Bearer; 5xx — offline; 2xx без JSON — unknown", async () => {
  const seen: { url: string; method?: string; ct: string | null; auth: string | null; body?: unknown }[] = [];
  const r = [ok({ token: "t", roles: ["employee"], lang: "ru" }), ok({ lang: "uz" }), new Response("<html>", { status: 502 }), new Response("ok", { status: 200 })];
  const f = (async (url: string, init: RequestInit = {}) => {
    const h = new Headers(init.headers);
    seen.push({ url, method: init.method, ct: h.get("Content-Type"), auth: h.get("Authorization"), body: init.body });
    return r.shift()!;
  }) as any;
  const a = createApi({ fetch: f, sdk: () => "ok", initData: () => "q" });
  expect(await a.send("PUT", "/lang", { lang: "uz" })).toEqual({ kind: "ok", data: { lang: "uz" } });
  expect(seen[1]).toEqual({ url: "/api/kpi/tg/lang", method: "PUT", ct: "application/json", auth: "Bearer t", body: '{"lang":"uz"}' });
  expect(await a.get("/home")).toEqual({ kind: "fail", status: "offline" });
  expect(await a.get("/home")).toEqual({ kind: "fail", status: "unknown" });
});
it("blob: байты при 200, null при ошибке и сети; мимо HTTP-кэша", async () => {
  const r: Array<Response | "throw"> = [ok({ token: "t", roles: [], lang: "ru" }), new Response("img", { status: 200 }), new Response("", { status: 404 }), "throw"];
  const modes: (RequestCache | undefined)[] = [];
  const f = (async (_url: string, init: RequestInit = {}) => { modes.push(init.cache); const x = r.shift()!; if (x === "throw") throw new TypeError("net"); return x; }) as any;
  const a = createApi({ fetch: f, sdk: () => "ok", initData: () => "q" });
  const b = await a.blob("/photo/1");
  expect(b && (await b.text())).toBe("img");
  // Решение 13: фото не попадают ни в наш кэш, ни в HTTP-кэш браузера.
  expect(modes[1]).toBe("no-store");
  expect(await a.blob("/photo/2")).toBeNull();
  expect(await a.blob("/photo/3")).toBeNull();
});
// Заголовки пришли, а тело зависло (филиальный wifi): срок действует до конца чтения тела.
const stalled = () => new Response(new ReadableStream({ start() {} }), { status: 200, headers: { "content-type": "application/json" } });

it("тело зависло после заголовков: blob — null, данные — offline, вход — offline; в срок", async () => {
  const f = (async (url: string) => (url.endsWith("/auth") ? ok({ token: "t", roles: [], lang: "ru" }) : stalled())) as any;
  const a = createApi({ fetch: f, sdk: () => "ok", initData: () => "q", timeoutMs: 100, blobTimeoutMs: 100 });
  const t0 = Date.now();
  expect(await a.blob("/violation-photos/1/file")).toBeNull();
  expect(await a.get("/home")).toEqual({ kind: "fail", status: "offline" });
  expect(await a.send("POST", "/disputes", { x: 1 })).toEqual({ kind: "fail", status: "offline" });
  expect(Date.now() - t0).toBeLessThan(1500);

  const stuckAuth = (async () => stalled()) as any;
  expect(await createApi({ fetch: stuckAuth, sdk: () => "ok", initData: () => "q", timeoutMs: 100 }).auth()).toEqual({ kind: "fail", status: "offline" });
});
it("тело пришло до срока — срок не мешает и не срабатывает позже", async () => {
  const f = (async (url: string) => (url.endsWith("/auth") ? ok({ token: "t", roles: [], lang: "ru" }) : ok({ x: 1 }))) as any;
  const a = createApi({ fetch: f, sdk: () => "ok", initData: () => "q", timeoutMs: 50 });
  expect(await a.get("/home")).toEqual({ kind: "ok", data: { x: 1 } });
  const b = await a.blob("/violation-photos/1/file");
  expect(b && (await b.text())).toBe('{"x":1}');
  // Таймер снят: после срока ничего не падает и ответы те же.
  await new Promise((r) => setTimeout(r, 80));
  expect(await a.get("/home")).toEqual({ kind: "ok", data: { x: 1 } });
});
// Фото идёт медленно, но идёт (большой снимок по филиальному wifi): у файла свой срок, длиннее
// срока данных; вход, и повторный внутри blob, — в обычный срок.
const slowBody = (ms: number, type: string) =>
  new Response(
    new ReadableStream({
      start(c) {
        setTimeout(() => {
          c.enqueue(new TextEncoder().encode("img"));
          c.close();
        }, ms);
      },
    }),
    { status: 200, headers: { "content-type": type } },
  );

it("фото: свой срок файла (blobTimeoutMs), данные и вход — в обычный", async () => {
  const f = (async (url: string) => (url.endsWith("/auth") ? ok({ token: "t", roles: [], lang: "ru" }) : slowBody(150, "image/png"))) as any;
  const a = createApi({ fetch: f, sdk: () => "ok", initData: () => "q", timeoutMs: 50, blobTimeoutMs: 1000 });
  const b = await a.blob("/violation-photos/1/file");
  expect(b && (await b.text())).toBe("img");
  // Те же 150 мс для JSON экрана — за сроком данных.
  expect(await a.get("/home")).toEqual({ kind: "fail", status: "offline" });

  // Без blobTimeoutMs срок файла — свой (60 с), а не срок данных.
  const d = createApi({ fetch: f, sdk: () => "ok", initData: () => "q", timeoutMs: 50 });
  const b2 = await d.blob("/violation-photos/1/file");
  expect(b2 && (await b2.text())).toBe("img");

  // Вход внутри blob завис — срок входа, а не файла.
  const stuckAuth = (async (url: string) => (url.endsWith("/auth") ? stalled() : slowBody(0, "image/png"))) as any;
  const t0 = Date.now();
  expect(await createApi({ fetch: stuckAuth, sdk: () => "ok", initData: () => "q", timeoutMs: 50, blobTimeoutMs: 5000 }).blob("/violation-photos/1/file")).toBeNull();
  expect(Date.now() - t0).toBeLessThan(1000);
});
it("параллельные запросы без токена делают один вход", async () => {
  let auths = 0;
  const f = (async (url: string) => { if (url.endsWith("/auth")) { auths++; return ok({ token: "t", roles: [], lang: "ru" }); } return ok({ ok: 1 }); }) as any;
  const a = createApi({ fetch: f, sdk: () => "ok", initData: () => "q" });
  await Promise.all([a.get("/home"), a.get("/history")]);
  expect(auths).toBe(1);
});
it("onAuth: тело каждого удачного входа (и повторного после 401), но не отказа", async () => {
  const seen: unknown[] = [];
  const r = [ok({ token: "t1", roles: ["employee"], lang: "ru", who: "aaaa" }), ok({ error: "unauthorized" }, 401),
    ok({ token: "t2", roles: ["employee"], lang: "uz", who: "bbbb" }), ok({ x: 1 })];
  const f = (async () => r.shift()!) as any;
  const a = createApi({ fetch: f, sdk: () => "ok", initData: () => "q", onAuth: (b) => seen.push(b) });
  expect(await a.get("/home")).toEqual({ kind: "ok", data: { x: 1 } });
  expect(seen).toEqual([{ token: "t1", roles: ["employee"], lang: "ru", who: "aaaa" }, { token: "t2", roles: ["employee"], lang: "uz", who: "bbbb" }]);
  const denied = createApi({ fetch: (async () => ok({ error: "inactive" }, 403)) as any, sdk: () => "ok", initData: () => "q", onAuth: (b) => seen.push(b) });
  expect(await denied.auth()).toEqual({ kind: "fail", status: "inactive" });
  expect(seen).toHaveLength(2);
});
// Нижняя граница WebView — Chrome 64, а AbortController в нём появился только в 66. Без него
// запрос всё равно уходит, а срок держит гонка с отказом по сроку: висящий fetch просто не обрывается.
it("без AbortController (Chrome 64–65): ответ приходит, зависший запрос — offline в срок", async () => {
  const g = globalThis as { AbortController?: unknown };
  const saved = g.AbortController;
  g.AbortController = undefined;
  try {
    const signals: unknown[] = [];
    const r = [ok({ token: "t", roles: ["employee"], lang: "ru" }), ok({ x: 1 })];
    const f = (async (_u: string, i: RequestInit = {}) => { signals.push(i.signal); return r.shift()!; }) as any;
    expect(await createApi({ fetch: f, sdk: () => "ok", initData: () => "q" }).get("/home")).toEqual({ kind: "ok", data: { x: 1 } });
    expect(signals).toEqual([undefined, undefined]);
    // fetch без signal не оборвать: он висит вечно, ответ даёт только срок.
    const hang = (() => new Promise(() => undefined)) as any;
    const t0 = Date.now();
    expect(await createApi({ fetch: hang, sdk: () => "ok", initData: () => "q", timeoutMs: 30 }).get("/home")).toEqual({ kind: "fail", status: "offline" });
    expect(Date.now() - t0).toBeLessThan(1000);
    // Таймер срока срабатывает и без контроллера: обрыв пропускается, а не роняет обработчик.
    await new Promise((res) => setTimeout(res, 50));
  } finally {
    g.AbortController = saved;
  }
});
