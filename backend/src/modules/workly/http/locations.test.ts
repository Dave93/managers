import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";

// Тот же guard, что в kpi/http/attendance.test.ts: голый `bun test` пропускает файл,
// запуск через test:http:workly доходит до тестов.
const dbLooksLikeTest = process.env.DATABASE_URL?.endsWith("/managers_tickets_test") ?? false;
const prefixLooksLikeTest = process.env.PROJECT_PREFIX === "managers_test_";

if (!dbLooksLikeTest && !prefixLooksLikeTest) {
  describe.skip("workly/locations (пропущено: запускайте через bun run test:http:workly)", () => {
    it("пропущено — нет тестового окружения", () => {});
  });
} else {
  // Хелпер kpi/http тут не подключается (он тянет приложение и Redis), поэтому его
  // fail-fast повторён: с тестовым префиксом, но не с тестовой базой не пишем ничего.
  if (!dbLooksLikeTest) {
    throw new Error(
      "workly/http/locations.test.ts: DATABASE_URL не указывает на managers_tickets_test. " +
        "Гоняйте тесты через bun run test:http:workly."
    );
  }

  const { drizzleDb } = await import("backend/src/lib/db");
  const { organization, terminals, workly_locations } = await import("backend/drizzle/schema");
  const { KpiError } = await import("../../kpi/errors");
  const { refreshLocations, setLocationTerminal, terminalMap } = await import("../locations");
  const { and, eq, inArray } = await import("drizzle-orm");

  const db = drizzleDb;
  const hex = () => randomUUID().replace(/-/g, "").slice(0, 8);

  describe("workly: карта локаций", () => {
    const tag = hex();
    // Компании в Workly нет ни у кого, кроме этого файла: число из большого диапазона.
    const company = 2_000_000 + Math.floor(Math.random() * 100_000_000);
    const company2 = company + 1;
    const orgIds: string[] = [];
    const terminalIds: string[] = [];

    let orgA = "";
    let orgB = "";
    let tA1 = "";
    let tA2 = "";
    let tB1 = "";
    let inactiveA = "";

    // Названия локаций Workly подбираются под названия терминалов: бренд + метка прогона.
    const titleOybek = `WLT-${tag.toUpperCase()}`; // ключ WLTxxxxxxxx
    const titleB = `WLB-${tag.toUpperCase()}`;
    const titleOff = `WLI-${tag.toUpperCase()}`;

    const mkOrg = async (name: string) => {
      const [row] = await db.insert(organization).values({ name }).returning({ id: organization.id });
      orgIds.push(row.id);
      return row.id;
    };
    const mkTerminal = async (organization_id: string, name: string, active = true) => {
      const [row] = await db
        .insert(terminals)
        .values({ name, latitude: 0, longitude: 0, organization_id, active })
        .returning({ id: terminals.id });
      terminalIds.push(row.id);
      return row.id;
    };
    const rows = async (companyId = company) => {
      const list = await db.select().from(workly_locations).where(eq(workly_locations.workly_company_id, companyId));
      return new Map(list.map((r) => [r.workly_location_id, r]));
    };
    const fake = (list: { id: number; title: string }[]) => ({ locations: async () => list });

    beforeAll(async () => {
      orgA = await mkOrg(`wl_test_org_a_${tag}`);
      orgB = await mkOrg(`wl_test_org_b_${tag}`);
      tA1 = await mkTerminal(orgA, `Les Ailes Wlt${tag}`);
      tA2 = await mkTerminal(orgA, `Les Ailes Other${tag}`);
      tB1 = await mkTerminal(orgB, `Chopar Pizza Wlb${tag}`);
      inactiveA = await mkTerminal(orgA, `Les Ailes Wli${tag}`, false);
    }, 60000);

    afterAll(async () => {
      await db.delete(workly_locations).where(inArray(workly_locations.workly_company_id, [company, company2]));
      if (terminalIds.length) await db.delete(terminals).where(inArray(terminals.id, terminalIds));
      if (orgIds.length) await db.delete(organization).where(inArray(organization.id, orgIds));
    });

    it("refreshLocations добавляет строки с подсказкой терминала своей организации", async () => {
      await refreshLocations(
        db,
        fake([
          { id: 1, title: titleOybek },
          { id: 2, title: "SKLAD" },
          { id: 3, title: titleB }, // терминал есть, но у организации B: подсказки нет
          { id: 4, title: titleOff }, // терминал неактивен: подсказки нет
        ]),
        company,
        orgA
      );
      const r = await rows();
      expect(r.size).toBe(4);
      expect(r.get(1)).toMatchObject({ title: titleOybek, terminal_id: tA1, organization_id: orgA });
      expect(r.get(2)).toMatchObject({ title: "SKLAD", terminal_id: null, organization_id: orgA });
      expect(r.get(3)?.terminal_id).toBeNull();
      expect(r.get(4)?.terminal_id).toBeNull();
    });

    it("повторный вызов не затирает терминал, выставленный вручную, и не трогает остальное", async () => {
      const before = await rows();
      // Строка 2: вручную на терминал A2. Строка 1: вручную снята привязка (подсказка не возвращается).
      await setLocationTerminal(db, before.get(2)!.id, tA2, orgA);
      await setLocationTerminal(db, before.get(1)!.id, null, orgA);

      await refreshLocations(
        db,
        fake([
          { id: 1, title: titleOybek },
          { id: 2, title: "SKLAD 2" }, // переименована в Workly
          { id: 3, title: titleB },
          { id: 4, title: titleOff },
        ]),
        company,
        orgA
      );

      const after = await rows();
      expect(after.size).toBe(4);
      expect(after.get(2)).toMatchObject({ title: "SKLAD 2", terminal_id: tA2, organization_id: orgA });
      expect(after.get(1)).toMatchObject({ terminal_id: null, organization_id: orgA });
      // id и created_at у существующих строк те же, updated_at ушёл вперёд.
      expect(after.get(2)!.id).toBe(before.get(2)!.id);
      expect(after.get(2)!.created_at).toBe(before.get(2)!.created_at);
      expect(Date.parse(after.get(2)!.updated_at)).toBeGreaterThan(Date.parse(before.get(2)!.updated_at));
    });

    it("локации, исчезнувшие из Workly, не удаляются", async () => {
      await refreshLocations(db, fake([{ id: 2, title: "SKLAD 2" }]), company, orgA);
      const r = await rows();
      expect([...r.keys()].sort()).toEqual([1, 2, 3, 4]);
      expect(r.get(2)?.terminal_id).toBe(tA2);
    });

    it("пустой ответ Workly ничего не меняет", async () => {
      await refreshLocations(db, fake([]), company, orgA);
      expect((await rows()).size).toBe(4);
    });

    it("повторы id в ответе не ломают вставку", async () => {
      await refreshLocations(
        db,
        fake([
          { id: 10, title: "DUP" },
          { id: 10, title: "DUP 2" },
        ]),
        company,
        orgA
      );
      expect((await rows()).get(10)?.title).toBe("DUP 2");
    });

    it("чужая организация не переписывает ни организацию, ни название существующей строки", async () => {
      await refreshLocations(db, fake([{ id: 1, title: "ЧУЖОЕ" }]), company, orgB);
      const r = await rows();
      expect(r.get(1)).toMatchObject({ title: titleOybek, organization_id: orgA });
    });

    it("подсказка для новой строки другой компании берётся из терминалов её организации", async () => {
      await refreshLocations(db, fake([{ id: 1, title: titleB }]), company2, orgB);
      const r = await rows(company2);
      expect(r.get(1)).toMatchObject({ terminal_id: tB1, organization_id: orgB });
    });

    it("setLocationTerminal: терминал чужой организации — 422 terminal_other_org, строка не меняется", async () => {
      const row = (await rows()).get(2)!;
      const err = await setLocationTerminal(db, row.id, tB1, orgA).catch((e) => e);
      expect(err).toBeInstanceOf(KpiError);
      expect(err).toMatchObject({ status: 422, code: "terminal_other_org" });
      expect((await rows()).get(2)?.terminal_id).toBe(tA2);
    });

    it("setLocationTerminal: несуществующий терминал — 422 terminal_other_org", async () => {
      const row = (await rows()).get(2)!;
      await expect(setLocationTerminal(db, row.id, randomUUID(), orgA)).rejects.toMatchObject({
        status: 422,
        code: "terminal_other_org",
      });
    });

    it("setLocationTerminal: строка чужой организации или несуществующая — 404 location_not_found", async () => {
      const row = (await rows()).get(2)!;
      const err = await setLocationTerminal(db, row.id, tB1, orgB).catch((e) => e);
      expect(err).toBeInstanceOf(KpiError);
      expect(err).toMatchObject({ status: 404, code: "location_not_found" });
      await expect(setLocationTerminal(db, randomUUID(), null, orgA)).rejects.toMatchObject({
        status: 404,
        code: "location_not_found",
      });
      // Чужая строка не изменилась.
      expect((await rows()).get(2)?.terminal_id).toBe(tA2);
    });

    it("setLocationTerminal: терминал своей организации ставится, null снимает привязку", async () => {
      const row = (await rows()).get(2)!;
      await setLocationTerminal(db, row.id, tA1, orgA);
      expect((await rows()).get(2)?.terminal_id).toBe(tA1);
      await setLocationTerminal(db, row.id, null, orgA);
      expect((await rows()).get(2)?.terminal_id).toBeNull();
      // Неактивный терминал своей организации допустим: HR может привязать закрытый филиал.
      await setLocationTerminal(db, row.id, inactiveA, orgA);
      expect((await rows()).get(2)?.terminal_id).toBe(inactiveA);
    });

    it("terminalMap: терминал или null для несопоставленных, только эта компания", async () => {
      const row2 = (await rows()).get(2)!;
      await setLocationTerminal(db, row2.id, tA2, orgA);
      const map = await terminalMap(db, company);
      expect(map).toBeInstanceOf(Map);
      expect(map.get(2)).toBe(tA2);
      expect(map.get(1)).toBeNull();
      expect(map.get(3)).toBeNull();
      expect(map.has(999)).toBe(false);
      expect([...map.keys()].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 10]);
      // Локация другой компании сюда не попадает.
      expect(await terminalMap(db, company2)).toEqual(new Map([[1, tB1]]));
      expect((await terminalMap(db, company + 999)).size).toBe(0);
    });

    it("refreshLocations и setLocationTerminal работают внутри транзакции", async () => {
      await db
        .transaction(async (tx) => {
          await refreshLocations(tx, fake([{ id: 20, title: "TX" }]), company, orgA);
          expect((await tx.select().from(workly_locations).where(and(eq(workly_locations.workly_company_id, company), eq(workly_locations.workly_location_id, 20)))).length).toBe(1);
          throw new Error("откат");
        })
        .catch(() => {});
      expect((await rows()).has(20)).toBe(false);
    });
  });
}
