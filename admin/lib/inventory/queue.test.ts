import { describe, expect, test } from "bun:test";
import type { InventoryCountDetail } from "@backend/modules/inventory/types";
import { applyResult, isLineDone, loadQueue, overlay, pendingOps, rejectAll, saveQueue, type KV, type QueuedOp } from "./queue";

function memoryKV(): KV & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const L1 = "11111111-1111-4111-8111-111111111111";
const L2 = "22222222-2222-4222-8222-222222222222";

function detail(): InventoryCountDetail {
  return {
    id: "c", store_id: "s", store_name: "Склад", template_id: "t", template_name: "Месячная",
    period: "2026-10-31", status: "draft", created_at: "", submitted_at: null, submitted_by_name: null,
    lines_total: 2, lines_done: 1, participants: ["Иван"], viewer_id: "me", access: "write",
    can_manage: true, can_reopen: false,
    lines: [
      {
        id: L1, product_id: "p1", product_name: "Говядина", unit_name: "кг", group_id: null, group_name: "Мясо",
        source: "template", skipped: false, fact_qty: null, total: "2.5",
        entries: [{ id: "e1", line_id: L1, qty: "2.5", created_by: "u1", created_by_name: "Иван", client_created_at: "2026-10-31T10:00:00Z" }],
      },
      {
        id: L2, product_id: "p2", product_name: "Соль", unit_name: "кг", group_id: null, group_name: "Без группы",
        source: "template", skipped: false, fact_qty: null, total: "0", entries: [],
      },
    ],
  };
}

const add = (id: string, line_id: string, qty: number): QueuedOp => ({
  state: "pending",
  op: { op: "add", id, line_id, qty, client_created_at: "2026-10-31T11:00:00Z" },
});
const del = (id: string): QueuedOp => ({ state: "pending", op: { op: "delete", id } });

describe("очередь в KV", () => {
  test("сохраняет и читает, пустая очередь удаляет ключ", () => {
    const kv = memoryKV();
    saveQueue(kv, "c", [add("a", L1, 1)]);
    expect(loadQueue(kv, "c")).toEqual([add("a", L1, 1)]);
    saveQueue(kv, "c", []);
    expect(kv.data.has("inventory:queue:c")).toBe(false);
  });
  test("битый JSON — пустая очередь", () => {
    const kv = memoryKV();
    kv.setItem("inventory:queue:c", "{oops");
    expect(loadQueue(kv, "c")).toEqual([]);
  });
});

describe("applyResult / rejectAll", () => {
  test("применённые уходят, отклонённые помечаются", () => {
    const q = [add("a", L1, 1), add("b", L1, -1), add("c", L2, 2)];
    const next = applyResult(q, { applied: ["a"], rejected: [{ id: "b", reason: "invalid_qty" }] });
    expect(next).toEqual([{ ...add("b", L1, -1), state: "rejected", reason: "invalid_qty" }, add("c", L2, 2)]);
    expect(pendingOps(next).map((o) => o.id)).toEqual(["c"]);
  });
  test("add и delete с одним id уходят вместе", () => {
    const q = [add("a", L1, 1), del("a")];
    expect(applyResult(q, { applied: ["a", "a"], rejected: [] })).toEqual([]);
  });
  test("rejectAll помечает пачку", () => {
    const q = [add("a", L1, 1), add("b", L1, 2)];
    expect(rejectAll(q, ["a"], "not_draft")[0]).toEqual({ ...add("a", L1, 1), state: "rejected", reason: "not_draft" });
    expect(rejectAll(q, ["a"], "not_draft")[1]).toEqual(add("b", L1, 2));
  });
});

describe("overlay", () => {
  test("неотправленная запись добавляется к строке и в итог", () => {
    const o = overlay(detail(), [add("n1", L2, 0.1), add("n2", L2, 0.2)], "Вы");
    const l2 = o.lines.find((l) => l.id === L2)!;
    expect(l2.total).toBe("0.3");
    expect(l2.entries.map((e) => [e.id, e.pending, e.created_by_name])).toEqual([
      ["n1", true, "Вы"],
      ["n2", true, "Вы"],
    ]);
    expect(o.lines_done).toBe(2);
  });
  test("неотправленное удаление скрывает запись", () => {
    const o = overlay(detail(), [del("e1")], "Вы");
    const l1 = o.lines.find((l) => l.id === L1)!;
    expect(l1.entries).toEqual([]);
    expect(l1.total).toBe("0");
    expect(o.lines_done).toBe(0);
  });
  test("pending add с id, который уже пришёл от сервера, не дублируется", () => {
    const o = overlay(detail(), [add("e1", L1, 2.5)], "Вы");
    const l1 = o.lines.find((l) => l.id === L1)!;
    expect(l1.entries.length).toBe(1);
    expect(l1.total).toBe("2.5");
  });
  test("отклонённые операции в итог не входят", () => {
    const o = overlay(detail(), [{ ...add("x", L2, 5), state: "rejected", reason: "not_draft" }], "Вы");
    expect(o.lines.find((l) => l.id === L2)!.total).toBe("0");
  });
  test("isLineDone: записи или «не считали»", () => {
    const o = overlay(detail(), [], "Вы");
    expect(isLineDone(o.lines[0])).toBe(true);
    expect(isLineDone(o.lines[1])).toBe(false);
    expect(isLineDone({ ...o.lines[1], skipped: true })).toBe(true);
  });
});
