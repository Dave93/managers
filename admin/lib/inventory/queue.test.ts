import { describe, expect, test } from "bun:test";
import type { InventoryCountDetail } from "@backend/modules/inventory/types";
import {
  appendOps,
  applyResult,
  buildAddOps,
  classifySyncError,
  isLineDone,
  loadQueue,
  overlay,
  pendingOps,
  pruneConfirmed,
  rejectAll,
  rejectedAddCount,
  retryRejected,
  saveQueue,
  type KV,
  type QueuedOp,
} from "./queue";

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
    period: "2026-10-31", status: "draft", exord_filtered: false, created_at: "", submitted_at: null, submitted_by_name: null,
    lines_total: 2, lines_done: 1, participants: ["Иван"], viewer_id: "me", access: "write",
    deadline: "2026-11-02T07:00:00.000Z", unlocked_until: null, input_open: true,
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
  test("применённые становятся confirmed с временем, отклонённые помечаются", () => {
    const q = [add("a", L1, 1), add("b", L1, -1), add("c", L2, 2)];
    const next = applyResult(q, { applied: ["a"], rejected: [{ id: "b", reason: "invalid_qty" }] }, 1000);
    expect(next).toEqual([
      { ...add("a", L1, 1), state: "confirmed", confirmedAt: 1000 },
      { ...add("b", L1, -1), state: "rejected", reason: "invalid_qty" },
      add("c", L2, 2),
    ]);
    expect(pendingOps(next).map((o) => o.id)).toEqual(["c"]);
  });
  test("add и delete с одним id подтверждаются вместе", () => {
    const q = [add("a", L1, 1), del("a")];
    expect(applyResult(q, { applied: ["a", "a"], rejected: [] }, 5).map((x) => x.state)).toEqual(["confirmed", "confirmed"]);
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

describe("подтверждённые операции ждут эха сервера", () => {
  test("confirmed add виден и считается, пока сервер его не вернул", () => {
    const q: QueuedOp[] = [{ ...add("n1", L2, 4), state: "confirmed", confirmedAt: 10 }];
    const l2 = overlay(detail(), q, "Вы").lines.find((l) => l.id === L2)!;
    expect(l2.total).toBe("4");
    expect(l2.entries.map((e) => e.id)).toEqual(["n1"]);
  });
  test("confirmed delete продолжает скрывать запись", () => {
    const q: QueuedOp[] = [{ ...del("e1"), state: "confirmed", confirmedAt: 10 }];
    expect(overlay(detail(), q, "Вы").lines.find((l) => l.id === L1)!.entries).toEqual([]);
  });
  test("pruneConfirmed убирает только подтверждённые до начала успешного запроса", () => {
    const q: QueuedOp[] = [
      { ...add("old", L1, 1), state: "confirmed", confirmedAt: 100 },
      { ...add("new", L1, 1), state: "confirmed", confirmedAt: 300 },
      add("p", L1, 1),
      { ...add("r", L1, 1), state: "rejected", reason: "not_draft" },
    ];
    expect(pruneConfirmed(q, 200).map((x) => x.op.id)).toEqual(["new", "p", "r"]);
  });
});

describe("отклонённые записи остаются видны", () => {
  test("rejected add показан в line.rejected, но не в итоге и не в прогрессе", () => {
    const q: QueuedOp[] = [{ ...add("x", L2, 5), state: "rejected", reason: "not_draft" }];
    const o = overlay(detail(), q, "Вы");
    const l2 = o.lines.find((l) => l.id === L2)!;
    expect(l2.total).toBe("0");
    expect(l2.entries).toEqual([]);
    expect(l2.rejected.map((e) => [e.id, e.qty])).toEqual([["x", "5"]]);
    expect(o.lines_done).toBe(1);
    expect(rejectedAddCount(detail(), q)).toBe(1);
  });
  test("rejected add, который сервер уже принял (потерянный ответ), не показывается и не считается в баннере", () => {
    const q: QueuedOp[] = [{ ...add("e1", L1, 2.5), state: "rejected", reason: "not_draft" }];
    expect(overlay(detail(), q, "Вы").lines.find((l) => l.id === L1)!.rejected).toEqual([]);
    expect(rejectedAddCount(detail(), q)).toBe(0);
  });
  test("retryRejected возвращает отклонённые в pending", () => {
    const q: QueuedOp[] = [{ ...add("x", L2, 5), state: "rejected", reason: "not_draft" }, add("p", L1, 1)];
    expect(retryRejected(q)).toEqual([add("x", L2, 5), add("p", L1, 1)]);
  });
});

describe("classifySyncError", () => {
  test("409/403/4xx — отклонить пачку, 401 — вход, сеть и 5xx — повторить", () => {
    expect(classifySyncError(409)).toEqual({ kind: "reject", reason: "not_draft" });
    expect(classifySyncError(403)).toEqual({ kind: "reject", reason: "forbidden" });
    expect(classifySyncError(422)).toEqual({ kind: "reject", reason: "http_422" });
    expect(classifySyncError(400)).toEqual({ kind: "reject", reason: "http_400" });
    expect(classifySyncError(404)).toEqual({ kind: "reject", reason: "http_404" });
    expect(classifySyncError(401)).toEqual({ kind: "auth" });
    expect(classifySyncError(0)).toEqual({ kind: "retry" });
    expect(classifySyncError(500)).toEqual({ kind: "retry" });
    expect(classifySyncError(503)).toEqual({ kind: "retry" });
    expect(classifySyncError(429)).toEqual({ kind: "retry" });
  });
});

describe("операции создаются вне функции обновления состояния (StrictMode вызывает её дважды)", () => {
  test("buildAddOps: по записи на значение, id из генератора, общее время", () => {
    let n = 0;
    const ops = buildAddOps(L1, [3, 2.5], "2026-10-03T10:00:00.000Z", () => `id-${++n}`);
    expect(ops).toEqual([
      { state: "pending", op: { op: "add", id: "id-1", line_id: L1, qty: 3, client_created_at: "2026-10-03T10:00:00.000Z" } },
      { state: "pending", op: { op: "add", id: "id-2", line_id: L1, qty: 2.5, client_created_at: "2026-10-03T10:00:00.000Z" } },
    ]);
  });
  test("appendOps(ops) — чистая: два вызова на той же очереди дают одинаковый результат", () => {
    let n = 0;
    const update = appendOps(buildAddOps(L1, [1], "t", () => `id-${++n}`));
    const q = [add("a", L2, 5)];
    expect(update(q)).toEqual(update(q));
    expect(update(q).map((x) => x.op.id)).toEqual(["a", "id-1"]);
  });
});
