import { describe, expect, it } from "bun:test";
import type { TgBindingRow } from "@admin/lib/kpi-api";
import { bindingLabel, chunkIds, indexBindings, inviteHint } from "./telegram";

const row = (o: Partial<TgBindingRow>): TgBindingRow =>
  ({ id: "b1", employee_id: null, user_id: null, lang: "ru", active: true, created_at: "2025-10-25T05:00:00.000Z", ...o });

describe("telegram", () => {
  it("chunkIds: без повторов и пустых, по 100", () => {
    const ids = Array.from({ length: 250 }, (_, i) => `id${i}`);
    expect(chunkIds([...ids, "id1", ""]).map((c) => c.length)).toEqual([100, 100, 50]);
    expect(chunkIds([])).toEqual([]);
  });
  it("indexBindings разделяет сотрудников и пользователей", () => {
    const ix = indexBindings([row({ id: "b1", employee_id: "e1" }), row({ id: "b2", user_id: "u1", lang: "uz" })]);
    expect([ix.employee.get("e1")?.id, ix.user.get("u1")?.id, ix.employee.has("u1")]).toEqual(["b1", "b2", false]);
  });
  it("bindingLabel", () => {
    expect(bindingLabel(row({ employee_id: "e1" }))).toBe("Привязан · RU");
    expect(bindingLabel(row({ employee_id: "e1", lang: "uz" }))).toBe("Привязан · UZ");
    expect(bindingLabel(undefined)).toBe("Не привязан");
  });
  it("inviteHint — срок по Ташкенту", () => {
    expect(inviteHint("2025-11-01T05:00:00.000Z")).toBe("Ссылка одноразовая, действует до 01.11.2025 10:00. Новая ссылка отменяет прежнюю.");
  });
});
