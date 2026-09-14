import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { callApi, closeTestRedis, ensureApp, withSession } from "../../../tests/helpers/http";
import { drizzleDb } from "@backend/lib/db";
import { ticket_types, tickets } from "backend/drizzle/schema";
import { inArray } from "drizzle-orm";

const call = (path: string, init: RequestInit = {}) => callApi(path, init);

describe("доступ к заявкам", () => {
  // ensureApp() (первый импорт src/app) поднимает весь Elysia-граф — по
  // отчёту задачи 1, холодный старт занимает ~30-35с на этой машине. Первый
  // тест ниже не проходит через withSession() (у него нет сессии вовсе), а
  // значит не получает бесплатный прогрев, который withSession() делает для
  // всех остальных тестов файла (она сама зовёт ensureApp() первой строкой).
  // Без явного прогрева здесь первый тест наткнулся бы на дефолтный
  // 5-секундный таймаут bun:test прямо на импорте приложения — не на
  // проверяемой логике. Прогреваем один раз здесь, с запасом по времени.
  beforeAll(async () => {
    await ensureApp();
  }, 60000);

  it("без сессии отдаёт 401", async () => {
    const res = await call("/api/tickets?limit=10&offset=0");
    expect(res.status).toBe(401);
  });

  it("с сессией без нужного права отдаёт 403", async () => {
    const s = await withSession({ permissions: ["users.list"] });
    try {
      const res = await call("/api/tickets?limit=10&offset=0", { headers: s.headers });
      expect(res.status).toBe(403);
    } finally {
      await s.cleanup();
    }
  });

  it("с правом tickets.list отдаёт список", async () => {
    const s = await withSession({ permissions: ["tickets.list"] });
    try {
      const res = await call("/api/tickets?limit=10&offset=0", { headers: s.headers });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty("data");
      expect(Array.isArray(body.data)).toBe(true);
    } finally {
      await s.cleanup();
    }
  });

  it("несуществующая заявка отдаёт 404, а не 500", async () => {
    const s = await withSession({ permissions: ["tickets.list"] });
    try {
      const res = await call("/api/tickets/99999999-9999-9999-9999-999999999999", { headers: s.headers });
      expect(res.status).toBe(404);
    } finally {
      await s.cleanup();
    }
  });

  it("кривой id отдаёт 404, а не ошибку базы", async () => {
    const s = await withSession({ permissions: ["tickets.list"] });
    try {
      const res = await call("/api/tickets/not-a-uuid", { headers: s.headers });
      expect(res.status).toBe(404);
    } finally {
      await s.cleanup();
    }
  });

  it("утверждение сумм закрыто от роли без этого права", async () => {
    const s = await withSession({ permissions: ["tickets.list", "tickets.close"] });
    try {
      const res = await call("/api/tickets/payment/approve", {
        method: "POST",
        headers: { ...s.headers, "content-type": "application/json" },
        body: JSON.stringify({ ids: ["11111111-1111-1111-1111-111111111111"] }),
      });
      expect(res.status).toBe(403);
    } finally {
      await s.cleanup();
    }
  });

  it("справочники закрыты от менеджера", async () => {
    const s = await withSession({ permissions: ["tickets.create", "tickets.list"] });
    try {
      const res = await call("/api/ticket_contractors", { headers: s.headers });
      expect(res.status).toBe(403);
    } finally {
      await s.cleanup();
    }
  });

  it("список типов доступен по праву создания", async () => {
    const s = await withSession({ permissions: ["tickets.create"] });
    try {
      const res = await call("/api/ticket_types", { headers: s.headers });
      expect(res.status).toBe(200);
    } finally {
      await s.cleanup();
    }
  });

  // Пустая база не даёт проверить скоуп по терминалам на трюизме — цикл по
  // пустому data[] прошёл бы, даже если весь WHERE inArray(terminal_id, ...)
  // выпилить из контроллера. Поэтому заводим две реальные строки в tickets
  // напрямую (в тестовую БД, не через API — вложения/файлы тут не нужны) в
  // двух разных филиалах, и проверяем, что чужая заявка не протекает ни в
  // список, ни в GET по id. tickets.terminal_id/organization_id не имеют FK
  // (см. drizzle/schema.ts и миграцию 0024_tickets_core.sql — только
  // type_id и assigned_executor_id ссылаются наружу), поэтому терминалы можно
  // взять произвольными UUID, а не заводить реальные строки terminals.
  describe("филиальный скоуп (с фикстурными заявками)", () => {
    const mineTerminal = randomUUID();
    const otherTerminal = randomUUID();
    let typeId: string;
    let mineTicketId: string;
    let otherTicketId: string;

    beforeAll(async () => {
      const [type] = await drizzleDb
        .insert(ticket_types)
        .values({
          code: "test_scope_" + randomUUID().slice(0, 8),
          number_prefix: "TS",
          name_ru: "Тестовый тип (скоуп)",
          name_uz: "Test turi (scope)",
          executor_kind: "staff",
          fields_schema: [],
        })
        .returning({ id: ticket_types.id });
      typeId = type.id;

      const [mine] = await drizzleDb
        .insert(tickets)
        .values({
          type_id: typeId,
          terminal_id: mineTerminal,
          organization_id: randomUUID(),
          created_by: randomUUID(),
        })
        .returning({ id: tickets.id });
      mineTicketId = mine.id;

      const [other] = await drizzleDb
        .insert(tickets)
        .values({
          type_id: typeId,
          terminal_id: otherTerminal,
          organization_id: randomUUID(),
          created_by: randomUUID(),
        })
        .returning({ id: tickets.id });
      otherTicketId = other.id;
    });

    afterAll(async () => {
      await drizzleDb.delete(tickets).where(inArray(tickets.id, [mineTicketId, otherTicketId]));
      await drizzleDb.delete(ticket_types).where(inArray(ticket_types.id, [typeId]));
    });

    it("список видит только заявку своего филиала", async () => {
      const s = await withSession({ permissions: ["tickets.list"], terminals: [mineTerminal] });
      try {
        const res = await call("/api/tickets?limit=200&offset=0", { headers: s.headers });
        expect(res.status).toBe(200);
        const body = await res.json();
        const ids: string[] = body.data.map((r: { id: string }) => r.id);
        expect(ids).toContain(mineTicketId);
        expect(ids).not.toContain(otherTicketId);
      } finally {
        await s.cleanup();
      }
    });

    it("заявка чужого филиала отдаётся как 404, а не 200 с чужими данными", async () => {
      const s = await withSession({ permissions: ["tickets.list"], terminals: [mineTerminal] });
      try {
        const res = await call(`/api/tickets/${otherTicketId}`, { headers: s.headers });
        expect(res.status).toBe(404);
      } finally {
        await s.cleanup();
      }
    });

    it("офисная роль без ограничения по филиалу видит заявки обоих филиалов", async () => {
      const s = await withSession({ permissions: ["tickets.list"] });
      try {
        const res = await call("/api/tickets?limit=200&offset=0", { headers: s.headers });
        expect(res.status).toBe(200);
        const body = await res.json();
        const ids: string[] = body.data.map((r: { id: string }) => r.id);
        expect(ids).toContain(mineTicketId);
        expect(ids).toContain(otherTicketId);
      } finally {
        await s.cleanup();
      }
    });
  });

  afterAll(async () => {
    await closeTestRedis();
  });
});
