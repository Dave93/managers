import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import fs from "node:fs";
import { randomUUID } from "node:crypto";

// Тот же guard, что в me.test.ts: голый `bun test` пропускает файл.
const dbLooksLikeTest = process.env.DATABASE_URL?.endsWith("/managers_tickets_test") ?? false;
const prefixLooksLikeTest = process.env.PROJECT_PREFIX === "managers_test_";

if (!dbLooksLikeTest && !prefixLooksLikeTest) {
  describe.skip("kpi/violations (пропущено: запускайте через bun run test:http:kpi)", () => {
    it("пропущено — нет тестового окружения", () => {});
  });
} else {
  const { callApi, sweepTestRoles, withSession } = await import("../../../../tests/helpers/http");
  const { api, cleanupKpi, makeEmployee, makeScope, setNow, setup } = await import("./fixtures");
  const { kpi_disputes, kpi_notifications, kpi_periods, kpi_violations } = await import(
    "backend/drizzle/schema"
  );
  const { eq } = await import("drizzle-orm");
  const { uploadsBase } = await import("../storage");
  type Card = import("../types").Card;
  type ReviewForm = import("../types").ReviewForm;
  type ViolationRow = import("../types").ViolationRow;
  type Session = Awaited<ReturnType<typeof withSession>>;

  const P5 = "2025-05-01";
  const NOW = "2025-05-15T12:00:00+05:00";
  const PNG = () => new File([Uint8Array.from([0x89, 0x50, 0x4e, 0x47])], "a.png", { type: "image/png" });

  describe("kpi: журнал нарушений", () => {
    let db: Awaited<ReturnType<typeof setup>>["db"];
    let cookItems: string[];
    let cashierItem: string;

    const evaluator = async (terminal_id: string, perms = ["kpi.evaluate"]) => {
      const s = await withSession({ permissions: perms });
      await makeScope(db, s.userId, { terminal_id });
      return s;
    };
    const cook = () => makeEmployee(db, { role_code: "cook" });
    const postForm = async (s: Session, fields: Record<string, string>, files: File[] = []) => {
      const fd = new FormData();
      for (const [k, v] of Object.entries(fields)) fd.append(k, v);
      for (const f of files) fd.append("photos", f);
      const res = await callApi("/api/kpi/violations", { method: "POST", headers: { ...s.headers }, body: fd });
      const text = await res.text();
      let body: any = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = text;
      }
      return { status: res.status, body };
    };
    const fileOf = (s: Session, photoId: string) =>
      callApi(`/api/kpi/violation-photos/${photoId}/file`, { headers: { ...s.headers } });
    const form = (s: Session, employeeId: string) =>
      api(s, "GET", `/api/kpi/reviews/form?period=${P5}&employee_id=${employeeId}`);
    const uploadDirs = () => (fs.existsSync(uploadsBase()) ? fs.readdirSync(uploadsBase()).length : 0);

    beforeAll(async () => {
      ({ db } = await setup());
      await cleanupKpi(db);
      const hr = await withSession({ permissions: ["kpi.manage"] });
      const cards = (await api(hr, "GET", "/api/kpi/cards")).body as Card[];
      cookItems = cards.find((c) => c.code === "cook")!.items.map((i) => i.id);
      cashierItem = cards.find((c) => c.code === "cashier")!.items[0].id;
    }, 180000);

    afterAll(async () => {
      setNow(null);
      await cleanupKpi(db);
      await sweepTestRoles();
      // closeTestRedis не зовём: соединение общее для всех файлов прогона.
    });

    it("запись с двумя PNG: фото отдаётся оценщику и kpi.view своего филиала, чужому филиалу — 404", async () => {
      setNow(NOW);
      const e = await cook();
      const ev = await evaluator(e.terminal_id);
      const r = await postForm(ev, { employee_id: e.id, card_item_id: cookItems[1], comment: "Грязный фартук" }, [PNG(), PNG()]);
      expect(r.status).toBe(200);
      const v = r.body as ViolationRow;
      expect(v.photos).toHaveLength(2);
      expect(v.period).toBe(P5);
      expect(v.status).toBe("active");
      expect(v.recorded_by).toBe(ev.userId);
      expect(v.card_item_id).toBe(cookItems[1]);
      expect(v.item_title_ru).toBeTruthy();
      expect(v.employee_name).toContain("Тест Повар");
      expect(v.open_dispute).toBe(false);
      expect(new Date(v.occurred_at).toISOString()).toBe(new Date(NOW).toISOString());
      expect(fs.readdirSync(`${uploadsBase()}/${v.id}`)).toHaveLength(2);

      const own = await fileOf(ev, v.photos[0].id);
      expect(own.status).toBe(200);
      expect(own.headers.get("content-type")).toBe("image/png");
      expect(Array.from(new Uint8Array(await own.arrayBuffer()))).toEqual([0x89, 0x50, 0x4e, 0x47]);

      const viewer = await withSession({ permissions: ["kpi.view"], terminals: [e.terminal_id] });
      expect((await fileOf(viewer, v.photos[1].id)).status).toBe(200);
      const stranger = await withSession({ permissions: ["kpi.view"], terminals: [randomUUID()] });
      const denied = await fileOf(stranger, v.photos[0].id);
      expect(denied.status).toBe(404);
      expect(await denied.json()).toEqual({ error: "not_found" });

      const notes = await db.select().from(kpi_notifications).where(eq(kpi_notifications.dedupe_key, `violation_recorded:${v.id}`));
      expect(notes).toHaveLength(1);
      expect(notes[0].employee_id).toBe(e.id);
      expect(notes[0].payload).toEqual({
        violation_id: v.id,
        period: P5,
        item_title_ru: v.item_title_ru,
        comment: "Грязный фартук",
      });
    });

    it("GIF — bad_photo_type, 4 фото — too_many_photos, 11 МБ — photo_too_large; на диск ничего не пишется", async () => {
      setNow(NOW);
      const e = await cook();
      const ev = await evaluator(e.terminal_id);
      const before = uploadDirs();
      const fields = { employee_id: e.id, comment: "Опоздание" };
      const gif = new File([Uint8Array.from([0x47, 0x49, 0x46])], "a.gif", { type: "image/gif" });
      const r1 = await postForm(ev, fields, [PNG(), gif]);
      expect(r1.status).toBe(422);
      expect(r1.body.error).toBe("bad_photo_type");
      const r2 = await postForm(ev, fields, [PNG(), PNG(), PNG(), PNG()]);
      expect(r2.status).toBe(422);
      expect(r2.body.error).toBe("too_many_photos");
      const big = new File([new Uint8Array(11 * 1024 * 1024)], "big.png", { type: "image/png" });
      const r3 = await postForm(ev, fields, [big]);
      expect(r3.status).toBe(422);
      expect(r3.body.error).toBe("photo_too_large");
      expect(uploadDirs()).toBe(before);
      expect(await db.select().from(kpi_violations).where(eq(kpi_violations.employee_id, e.id))).toHaveLength(0);
    });

    it("один файл (не массив) принимается; кривой и чужой id фото — 404", async () => {
      setNow(NOW);
      const e = await cook();
      const ev = await evaluator(e.terminal_id);
      const r = await postForm(ev, { employee_id: e.id, comment: "Без перчаток" }, [PNG()]);
      expect(r.status).toBe(200);
      expect(r.body.photos).toHaveLength(1);
      expect((await fileOf(ev, "not-a-uuid")).status).toBe(404);
      expect((await fileOf(ev, randomUUID())).status).toBe(404);
    });

    it("пункт не из карты сотрудника — 422 unknown_item; комментарий из пробелов — comment_required", async () => {
      setNow(NOW);
      const e = await cook();
      const ev = await evaluator(e.terminal_id);
      const other = await postForm(ev, { employee_id: e.id, card_item_id: cashierItem, comment: "Нарушение" });
      expect(other.status).toBe(422);
      expect(other.body.error).toBe("unknown_item");
      const random = await postForm(ev, { employee_id: e.id, card_item_id: randomUUID(), comment: "Нарушение" });
      expect(random.body.error).toBe("unknown_item");
      const junk = await postForm(ev, { employee_id: e.id, card_item_id: "x", comment: "Нарушение" });
      expect(junk.body.error).toBe("unknown_item");
      const blank = await postForm(ev, { employee_id: e.id, comment: "  а  " });
      expect(blank.status).toBe(422);
      expect(blank.body.error).toBe("comment_required");
    });

    it("без назначения на филиал сотрудника — 403 out_of_scope; без kpi.evaluate — 403", async () => {
      setNow(NOW);
      const e = await cook();
      const foreign = await evaluator(randomUUID());
      const r = await postForm(foreign, { employee_id: e.id, comment: "Нарушение" });
      expect(r.status).toBe(403);
      expect(r.body.error).toBe("out_of_scope");
      const viewer = await withSession({ permissions: ["kpi.view"], terminals: [e.terminal_id] });
      expect((await postForm(viewer, { employee_id: e.id, comment: "Нарушение" })).status).toBe(403);
      expect((await postForm(foreign, { employee_id: "not-a-uuid", comment: "Нарушение" })).status).toBe(404);
    });

    it("без фото при violation_photo_required=true — 422 photo_required; настройка возвращается", async () => {
      setNow(NOW);
      const e = await cook();
      const ev = await evaluator(e.terminal_id);
      const hr = await withSession({ permissions: ["kpi.manage"] });
      expect((await api(hr, "PUT", "/api/kpi/settings", { violation_photo_required: true })).status).toBe(200);
      try {
        const r = await postForm(ev, { employee_id: e.id, comment: "Нарушение" });
        expect(r.status).toBe(422);
        expect(r.body.error).toBe("photo_required");
        expect((await postForm(ev, { employee_id: e.id, comment: "Нарушение" }, [PNG()])).status).toBe(200);
      } finally {
        await api(hr, "PUT", "/api/kpi/settings", { violation_photo_required: false });
      }
      expect((await postForm(ev, { employee_id: e.id, comment: "Нарушение" })).status).toBe(200);
    });

    it("occurred_at: будущее больше чем на 5 минут и мусор — 422 bad_occurred_at; закрытый месяц — 409", async () => {
      setNow(NOW);
      const e = await cook();
      const ev = await evaluator(e.terminal_id);
      const base = { employee_id: e.id, comment: "Нарушение" };
      const future = await postForm(ev, { ...base, occurred_at: "2025-05-15T12:10:00+05:00" });
      expect(future.status).toBe(422);
      expect(future.body.error).toBe("bad_occurred_at");
      expect((await postForm(ev, { ...base, occurred_at: "вчера" })).body.error).toBe("bad_occurred_at");
      const soon = await postForm(ev, { ...base, occurred_at: "2025-05-15T12:03:00+05:00" });
      expect(soon.status).toBe(200);
      const past = await postForm(ev, { ...base, occurred_at: "2025-05-10T09:00:00+05:00" });
      expect(past.status).toBe(200);
      expect(past.body.period).toBe(P5);
      expect(new Date(past.body.occurred_at).toISOString()).toBe(new Date("2025-05-10T09:00:00+05:00").toISOString());

      await db.insert(kpi_periods).values({ period: P5, status: "closed" });
      try {
        const before = uploadDirs();
        const closed = await postForm(ev, base, [PNG()]);
        expect(closed.status).toBe(409);
        expect(closed.body.error).toBe("period_closed");
        expect(uploadDirs()).toBe(before);
      } finally {
        await db.delete(kpi_periods).where(eq(kpi_periods.period, P5));
      }
    });

    it("в форме оценки нарушение под пунктом, violation_hint 90; без пункта — в other_violations; после cancel пропало", async () => {
      setNow(NOW);
      const e = await cook();
      const ev = await evaluator(e.terminal_id);
      const v = (await postForm(ev, { employee_id: e.id, card_item_id: cookItems[2], comment: "Грязный фартук" }, [PNG()])).body as ViolationRow;
      const loose = (await postForm(ev, { employee_id: e.id, comment: "Общее замечание" })).body as ViolationRow;

      const f = (await form(ev, e.id)).body as ReviewForm;
      const item = f.items.find((i) => i.item_id === cookItems[2])!;
      expect(item.violations.map((x) => x.id)).toEqual([v.id]);
      expect(item.violation_hint).toBe(90);
      expect(f.items.find((i) => i.item_id === cookItems[1])!.violation_hint).toBeNull();
      expect(f.other_violations.map((x) => x.id)).toEqual([loose.id]);

      const c = await api(ev, "POST", `/api/kpi/violations/${v.id}/cancel`, { reason: "Ошибся сотрудником" });
      expect(c.status).toBe(200);
      const after = (await form(ev, e.id)).body as ReviewForm;
      const item2 = after.items.find((i) => i.item_id === cookItems[2])!;
      expect(item2.violations).toHaveLength(0);
      expect(item2.violation_hint).toBeNull();
      expect(after.other_violations.map((x) => x.id)).toEqual([loose.id]);
    });

    it("отмена: чужой оценщик — 403, автор — 200, повторная — 409 already_cancelled", async () => {
      setNow(NOW);
      const e = await cook();
      const author = await evaluator(e.terminal_id);
      const peer = await evaluator(e.terminal_id);
      const v = (await postForm(author, { employee_id: e.id, comment: "Нарушение" })).body as ViolationRow;

      const denied = await api(peer, "POST", `/api/kpi/violations/${v.id}/cancel`, { reason: "Не согласен с записью" });
      expect(denied.status).toBe(403);
      expect(denied.body.error).toBe("forbidden");
      const short = await api(author, "POST", `/api/kpi/violations/${v.id}/cancel`, { reason: " а " });
      expect(short.status).toBe(422);
      expect(short.body.error).toBe("comment_required");
      const ok = await api(author, "POST", `/api/kpi/violations/${v.id}/cancel`, { reason: "Записал по ошибке" });
      expect(ok.status).toBe(200);
      expect(ok.body.status).toBe("cancelled");
      expect(ok.body.cancel_reason).toBe("Записал по ошибке");
      const [row] = await db.select().from(kpi_violations).where(eq(kpi_violations.id, v.id));
      expect(row.cancelled_by).toBe(author.userId);
      expect(row.cancelled_at).not.toBeNull();
      const again = await api(author, "POST", `/api/kpi/violations/${v.id}/cancel`, { reason: "Записал по ошибке" });
      expect(again.status).toBe(409);
      expect(again.body.error).toBe("already_cancelled");
      expect((await api(author, "POST", `/api/kpi/violations/${randomUUID()}/cancel`, { reason: "Записал по ошибке" })).status).toBe(404);
      expect((await api(author, "POST", `/api/kpi/violations/not-a-uuid/cancel`, { reason: "Записал по ошибке" })).status).toBe(404);
    });

    it("закрытый месяц: автор не отменяет (403), kpi.approve отменяет", async () => {
      setNow(NOW);
      const e = await cook();
      const author = await evaluator(e.terminal_id);
      const v = (await postForm(author, { employee_id: e.id, comment: "Нарушение" })).body as ViolationRow;
      await db.insert(kpi_periods).values({ period: P5, status: "closed" });
      try {
        const denied = await api(author, "POST", `/api/kpi/violations/${v.id}/cancel`, { reason: "Записал по ошибке" });
        expect(denied.status).toBe(403);
        const hr = await withSession({ permissions: ["kpi.approve"] });
        const ok = await api(hr, "POST", `/api/kpi/violations/${v.id}/cancel`, { reason: "Решение комиссии" });
        expect(ok.status).toBe(200);
      } finally {
        await db.delete(kpi_periods).where(eq(kpi_periods.period, P5));
      }
    });

    it("список: фильтры, видимость по филиалу, open_dispute", async () => {
      setNow(NOW);
      const e = await cook();
      const ev = await evaluator(e.terminal_id);
      const v1 = (await postForm(ev, { employee_id: e.id, comment: "Первое" }, [PNG()])).body as ViolationRow;
      const v2 = (await postForm(ev, { employee_id: e.id, comment: "Второе" })).body as ViolationRow;
      await api(ev, "POST", `/api/kpi/violations/${v2.id}/cancel`, { reason: "Записал по ошибке" });
      await db.insert(kpi_disputes).values({
        subject_type: "violation",
        subject_id: v1.id,
        employee_id: e.id,
        period: P5,
        opened_via: "admin",
        reason: "Не было такого",
      });

      const all = await api(ev, "GET", `/api/kpi/violations?period=${P5}&employee_id=${e.id}`);
      expect(all.status).toBe(200);
      expect((all.body as ViolationRow[]).map((x) => x.id).sort()).toEqual([v1.id, v2.id].sort());
      const first = (all.body as ViolationRow[]).find((x) => x.id === v1.id)!;
      expect(first.open_dispute).toBe(true);
      expect(first.terminal_name === null || typeof first.terminal_name === "string").toBe(true);
      const active = await api(ev, "GET", `/api/kpi/violations?period=${P5}&terminal_id=${e.terminal_id}&status=active`);
      expect((active.body as ViolationRow[]).map((x) => x.id)).toEqual([v1.id]);
      const cancelled = await api(ev, "GET", `/api/kpi/violations?employee_id=${e.id}&status=cancelled`);
      expect((cancelled.body as ViolationRow[]).map((x) => x.id)).toEqual([v2.id]);

      const viewer = await withSession({ permissions: ["kpi.view"], terminals: [e.terminal_id] });
      expect(((await api(viewer, "GET", `/api/kpi/violations?employee_id=${e.id}`)).body as ViolationRow[])).toHaveLength(2);
      const stranger = await withSession({ permissions: ["kpi.view"], terminals: [randomUUID()] });
      expect((await api(stranger, "GET", `/api/kpi/violations?employee_id=${e.id}`)).body).toEqual([]);
      const net = await withSession({ permissions: ["kpi.manage"] });
      expect(((await api(net, "GET", `/api/kpi/violations?employee_id=${e.id}`)).body as ViolationRow[])).toHaveLength(2);

      expect((await api(ev, "GET", "/api/kpi/violations?period=2025-05-15")).status).toBe(422);
      expect((await api(ev, "GET", "/api/kpi/violations?period=")).body.error).toBe("bad_period");
      expect((await api(ev, "GET", "/api/kpi/violations?status=x")).status).toBe(422);
      expect((await api(ev, "GET", "/api/kpi/violations?employee_id=x")).status).toBe(422);
      expect((await api(null, "GET", "/api/kpi/violations")).status).toBeGreaterThanOrEqual(401);
      const noPerm = await withSession({ permissions: [] });
      expect((await api(noPerm, "GET", "/api/kpi/violations")).status).toBe(403);
    });
  });
}
