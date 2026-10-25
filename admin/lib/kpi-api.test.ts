import { describe, expect, it } from "bun:test";
import { treaty } from "@elysiajs/eden";
import { createKpiApi, downloadRaisesCsv, photoUrl, postAttendanceFile, postViolation, type KpiApi } from "./kpi-api";
import { KpiApiError } from "./kpi/errors";

type Call = { method: string; path: string; body: unknown; credentials?: RequestCredentials };

function fakeFetch(status: number, payload: unknown, calls: Call[], contentType = "application/json"): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = init?.body;
    calls.push({
      method: init?.method ?? "GET",
      path: String(input).replace("http://kpi.test", ""),
      body: typeof raw === "string" ? JSON.parse(raw) : raw ?? null,
      credentials: init?.credentials,
    });
    const text = typeof payload === "string" ? payload : JSON.stringify(payload);
    return new Response(text, { status, headers: { "content-type": contentType } });
  }) as unknown as typeof fetch;
}

function setup(status = 200, payload: unknown = {}) {
  const calls: Call[] = [];
  const root: any = (treaty as any)("http://kpi.test", { fetcher: fakeFetch(status, payload, calls) }); // без дженерика: Treaty.Create<any> может упереться в глубину типов
  return { api: createKpiApi(root.api.kpi), calls };
}

const items = [{ item_id: "i1", score: 50, note: null }];
const item = { title_ru: "Тест пункт", title_uz: "Test band", source: "manual" as const, weight: 1, group_key: "base" as const };

const cases: [string, (a: KpiApi) => Promise<unknown>, string, string, unknown][] = [
  ["me", (a) => a.me(), "GET", "/api/kpi/me", null],
  ["settings.save", (a) => a.settings.save({ review_deadline_day: 6 }), "PUT", "/api/kpi/settings", { review_deadline_day: 6 }],
  ["cards.list", (a) => a.cards.list(), "GET", "/api/kpi/cards", null],
  ["cards.list с неактивными", (a) => a.cards.list(true), "GET", "/api/kpi/cards?include_inactive=1", null],
  ["cards.update", (a) => a.cards.update("c1", { active: false }), "PUT", "/api/kpi/cards/c1", { active: false }],
  ["cards.addItem", (a) => a.cards.addItem("c1", item), "POST", "/api/kpi/cards/c1/items", item],
  ["cards.updateItem", (a) => a.cards.updateItem("i1", { active: false }), "PUT", "/api/kpi/items/i1", { active: false }],
  ["evaluators.create", (a) => a.evaluators.create({ user_id: "u1", card_id: null, terminal_id: "t1" }), "POST", "/api/kpi/evaluators", { user_id: "u1", card_id: null, terminal_id: "t1" }],
  ["evaluators.remove", (a) => a.evaluators.remove("s1"), "DELETE", "/api/kpi/evaluators/s1", null],
  ["employees.list без пустых фильтров", (a) => a.employees.list({ period: "2026-10-01", terminal_id: undefined, search: "", status: "draft" }), "GET", "/api/kpi/employees?period=2026-10-01&status=draft", null],
  ["employees.list с сотрудниками без карты", (a) => a.employees.list({ period: "2026-10-01", include_uncarded: true }), "GET", "/api/kpi/employees?period=2026-10-01&include_uncarded=1", null],
  ["employees.setCard auto", (a) => a.employees.setCard("e1", "auto"), "PUT", "/api/kpi/employees/e1/card", { card_id: "auto" }],
  ["employees.setCard не оценивается", (a) => a.employees.setCard("e1", null, "уволен"), "PUT", "/api/kpi/employees/e1/card", { card_id: null, comment: "уволен" }],
  ["reviews.form", (a) => a.reviews.form("2026-10-01", "e1"), "GET", "/api/kpi/reviews/form?period=2026-10-01&employee_id=e1", null],
  ["reviews.saveDraft", (a) => a.reviews.saveDraft("2026-10-01", "e1", items), "PUT", "/api/kpi/reviews/draft", { period: "2026-10-01", employee_id: "e1", items }],
  ["reviews.submit без пунктов", (a) => a.reviews.submit("r1"), "POST", "/api/kpi/reviews/r1/submit", {}],
  ["reviews.submit с пунктами", (a) => a.reviews.submit("r1", items), "POST", "/api/kpi/reviews/r1/submit", { items }],
  ["reviews.change", (a) => a.reviews.change("r1", items, "опоздал 3 раза"), "PUT", "/api/kpi/reviews/r1", { items, comment: "опоздал 3 раза" }],
  ["reviews.events", (a) => a.reviews.events("r1"), "GET", "/api/kpi/reviews/r1/events", null],
  ["violations.list", (a) => a.violations.list({ period: "2026-10-01", status: undefined }), "GET", "/api/kpi/violations?period=2026-10-01", null],
  ["violations.cancel", (a) => a.violations.cancel("v1", "ошибка проверяющего"), "POST", "/api/kpi/violations/v1/cancel", { reason: "ошибка проверяющего" }],
  ["disputes.list", (a) => a.disputes.list({}), "GET", "/api/kpi/disputes", null],
  ["disputes.open", (a) => a.disputes.open({ subject_type: "review", subject_id: "r1", reason: "не согласен с баллом" }), "POST", "/api/kpi/disputes", { subject_type: "review", subject_id: "r1", reason: "не согласен с баллом" }],
  ["disputes.resolve", (a) => a.disputes.resolve("d1", { decision: "rejected", comment: "балл верный" }), "POST", "/api/kpi/disputes/d1/resolve", { decision: "rejected", comment: "балл верный" }],
  ["periods.get", (a) => a.periods.get("2026-10-01"), "GET", "/api/kpi/periods/2026-10-01", null],
  ["periods.close", (a) => a.periods.close("2026-10-01"), "POST", "/api/kpi/periods/2026-10-01/close", {}],
  ["periods.reopen", (a) => a.periods.reopen("2026-10-01", "ошибка в оценке"), "POST", "/api/kpi/periods/2026-10-01/reopen", { comment: "ошибка в оценке" }],
  ["raises.list", (a) => a.raises.list("2026-10-01"), "GET", "/api/kpi/raises?quarter=2026-10-01", null],
  ["raises.compute", (a) => a.raises.compute("2026-10-01"), "POST", "/api/kpi/raises/compute", { quarter: "2026-10-01" }],
  ["raises.decide", (a) => a.raises.decide("x1", { status: "approved", amount: 300000 }), "POST", "/api/kpi/raises/x1/decide", { status: "approved", amount: 300000 }],
  ["attendance.commit", (a) => a.attendance.commit({ token: "tk", sheet: "Лист1", period: "2025-09-01", header_row: 1, mapping: { external_id: 0, date: 1 } }),
    "POST", "/api/kpi/attendance/commit", { token: "tk", sheet: "Лист1", period: "2025-09-01", header_row: 1, mapping: { external_id: 0, date: 1 } }],
  ["attendance.imports", (a) => a.attendance.imports("2025-09-01"), "GET", "/api/kpi/attendance/imports?period=2025-09-01", null],
  ["employees.setExternalId", (a) => a.employees.setExternalId("e1", "T-1"), "PUT", "/api/kpi/employees/e1/external-id", { external_id: "T-1" }],
  ["employees.setExternalId пусто", (a) => a.employees.setExternalId("e1", null), "PUT", "/api/kpi/employees/e1/external-id", { external_id: null }],
  ["tiers.get", (a) => a.tiers.get(), "GET", "/api/kpi/raise-tiers", null],
  ["tiers.save", (a) => a.tiers.save([{ min_pct: 95, amount: 500000 }]), "PUT", "/api/kpi/raise-tiers", { tiers: [{ min_pct: 95, amount: 500000 }] }],
];

describe("kpiApi: метод, путь, тело", () => {
  for (const [name, run, method, path, body] of cases) {
    it(name, async () => {
      const { api, calls } = setup();
      await run(api);
      expect(calls).toHaveLength(1);
      expect(calls[0].method).toBe(method);
      expect(calls[0].path).toBe(path);
      if (body !== null) expect(calls[0].body).toEqual(body);
    });
  }
  it("users: поиск кодируется", async () => {
    const { api, calls } = setup(200, []);
    await api.users("ива нов");
    expect(new URL("http://x" + calls[0].path).searchParams.get("search")).toBe("ива нов");
  });
});

describe("kpiApi: ответы", () => {
  it("даты остаются строками", async () => {
    const { api } = setup(200, { period: "2026-10-01", closed_at: "2026-11-11T10:00:00.000Z" });
    const r = (await api.periods.get("2026-10-01")) as unknown as Record<string, unknown>;
    expect(r.period).toBe("2026-10-01");
    expect(r.closed_at).toBe("2026-11-11T10:00:00.000Z");
  });
  it("ошибка: статус и код из тела", async () => {
    const { api } = setup(409, { error: "dispute_exists" });
    const e = await api.disputes.open({ subject_type: "review", subject_id: "r1", reason: "не согласен" }).catch((x) => x);
    expect(e).toBeInstanceOf(KpiApiError);
    expect(e.status).toBe(409);
    expect(e.code).toBe("dispute_exists");
  });
  it("ошибка валидации Elysia — invalid_input", async () => {
    const { api } = setup(422, { type: "validation", on: "body", message: "Expected string" });
    const e = await api.reviews.change("r1", items, "x").catch((x) => x);
    expect(e.code).toBe("invalid_input");
  });
  it("обрыв сети в обычном вызове — network", async () => {
    const boom = (async () => { throw new TypeError("Failed to fetch"); }) as unknown as typeof fetch;
    const root: any = (treaty as any)("http://kpi.test", { fetcher: boom });
    const e = await createKpiApi(root.api.kpi).me().catch((x) => x);
    expect(e).toBeInstanceOf(KpiApiError);
    expect([e.status, e.code]).toEqual([0, "network"]);
  });
  it("photoUrl", () => expect(photoUrl("p1")).toBe("/api/kpi/violation-photos/p1/file"));
});

describe("postViolation", () => {
  it("POST multipart с куками", async () => {
    const calls: Call[] = [];
    const fd = new FormData();
    fd.append("employee_id", "e1");
    const row = await postViolation(fd, fakeFetch(200, { id: "v1" }, calls));
    expect(row.id).toBe("v1");
    expect(calls[0]).toMatchObject({ method: "POST", path: "/api/kpi/violations", credentials: "include" });
    expect(calls[0].body).toBeInstanceOf(FormData);
  });
  it("отказ сервера — код из body.error", async () => {
    const e = await postViolation(new FormData(), fakeFetch(422, { error: "bad_photo_type" }, [])).catch((x) => x);
    expect([e.status, e.code]).toEqual([422, "bad_photo_type"]);
  });
  it("обрыв сети — network, 502 от прокси — server_error", async () => {
    const boom = (async () => { throw new TypeError("Failed to fetch"); }) as unknown as typeof fetch;
    const e1 = await postViolation(new FormData(), boom).catch((x) => x);
    expect([e1.status, e1.code]).toEqual([0, "network"]);
    const e2 = await postViolation(new FormData(), fakeFetch(502, "<html>Bad Gateway</html>", [], "text/html")).catch((x) => x);
    expect([e2.status, e2.code]).toEqual([502, "server_error"]);
  });
});

describe("postAttendanceFile", () => {
  it("POST multipart с полем file и куками", async () => {
    const calls: Call[] = [];
    const r = await postAttendanceFile(new File(["a;b"], "w.csv"),
      fakeFetch(200, { token: "tk", file_name: "w.csv", expires_at: "2025-09-01T10:30:00.000Z", sheets: [] }, calls));
    expect(r.token).toBe("tk");
    expect(calls[0]).toMatchObject({ method: "POST", path: "/api/kpi/attendance/parse", credentials: "include" });
    expect((calls[0].body as FormData).get("file")).toBeInstanceOf(File);
  });
  it("отказ — код из body.error", async () => {
    const e = await postAttendanceFile(new File(["x"], "w.csv"), fakeFetch(422, { error: "file_too_large" }, [])).catch((x) => x);
    expect([e.status, e.code]).toEqual([422, "file_too_large"]);
  });
  it("обрыв сети — network, 2xx без JSON — server_error", async () => {
    const boom = (async () => { throw new TypeError("Failed to fetch"); }) as unknown as typeof fetch;
    const e1 = await postAttendanceFile(new File(["x"], "w.csv"), boom).catch((x) => x);
    expect([e1.status, e1.code]).toEqual([0, "network"]);
    const e2 = await postAttendanceFile(new File(["x"], "w.csv"), fakeFetch(200, "<html>", [], "text/html")).catch((x) => x);
    expect([e2.status, e2.code]).toEqual([200, "server_error"]);
  });
});

describe("postViolation: нечитаемый ответ", () => {
  it("2xx без JSON — server_error, не http_200", async () => {
    const e = await postViolation(new FormData(), fakeFetch(200, "<html>", [], "text/html")).catch((x) => x);
    expect([e.status, e.code]).toEqual([200, "server_error"]);
  });
});

describe("downloadRaisesCsv", () => {
  it("обрыв сети и сбой чтения тела — network", async () => {
    const boom = (async () => { throw new TypeError("Failed to fetch"); }) as unknown as typeof fetch;
    const e1 = await downloadRaisesCsv("2026-10-01", boom).catch((x) => x);
    expect(e1.code).toBe("network");
    const badBody = (async () => ({ ok: true, status: 200, blob: async () => { throw new TypeError("terminated"); } })) as unknown as typeof fetch;
    const e2 = await downloadRaisesCsv("2026-10-01", badBody).catch((x) => x);
    expect([e2.status, e2.code]).toEqual([0, "network"]);
  });
  it("скачивает файл квартала", async () => {
    const calls: Call[] = [];
    const blob = await downloadRaisesCsv("2026-10-01", fakeFetch(200, "\ufeffФИО;Филиал", calls, "text/csv; charset=utf-8"));
    expect(await blob.text()).toContain("ФИО;Филиал");
    expect(calls[0]).toMatchObject({ method: "GET", path: "/api/kpi/raises/export?quarter=2026-10-01", credentials: "include" });
  });
  it("403 — forbidden", async () => {
    const e = await downloadRaisesCsv("2026-10-01", fakeFetch(403, { error: "forbidden" }, [])).catch((x) => x);
    expect(e.code).toBe("forbidden");
  });
});
