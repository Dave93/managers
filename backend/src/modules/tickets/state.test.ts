import { describe, expect, it } from "bun:test";
import { allowedActions, allowedFrom, nextStatus, type TicketAction, type TicketStatus } from "./state";

describe("машина состояний заявки", () => {
  it("проводит заявку по основному пути", () => {
    expect(nextStatus("claim", "new")).toBe("in_progress");
    expect(nextStatus("submit", "in_progress")).toBe("done");
    expect(nextStatus("accept", "done")).toBe("closed");
  });

  it("возвращает сданную заявку в работу", () => {
    expect(nextStatus("reopen", "done")).toBe("in_progress");
  });

  it("отменяет только незавершённые заявки", () => {
    expect(nextStatus("cancel", "new")).toBe("cancelled");
    expect(nextStatus("cancel", "in_progress")).toBe("cancelled");
    expect(nextStatus("cancel", "done")).toBeNull();
    expect(nextStatus("cancel", "closed")).toBeNull();
  });

  it("отвергает все остальные пары действие-статус", () => {
    const actions: TicketAction[] = ["claim", "submit", "accept", "reopen", "cancel"];
    const statuses: TicketStatus[] = ["new", "in_progress", "done", "closed", "cancelled"];
    const allowed = new Set([
      "claim:new",
      "submit:in_progress",
      "accept:done",
      "reopen:done",
      "cancel:new",
      "cancel:in_progress",
    ]);
    for (const a of actions) {
      for (const s of statuses) {
        const expected = allowed.has(`${a}:${s}`);
        expect(nextStatus(a, s) !== null).toBe(expected);
      }
    }
  });

  it("закрытая и отменённая заявки не принимают ничего", () => {
    expect(allowedActions("closed")).toEqual([]);
    expect(allowedActions("cancelled")).toEqual([]);
  });

  it("перечисляет действия для сданной заявки", () => {
    expect(allowedActions("done").sort()).toEqual(["accept", "reopen"]);
  });

  describe("allowedFrom", () => {
    it("возвращает статусы, из которых допускается действие", () => {
      expect(allowedFrom("cancel").sort()).toEqual(["in_progress", "new"]);
      expect(allowedFrom("accept")).toEqual(["done"]);
      expect(allowedFrom("claim")).toEqual(["new"]);
    });

    it("возвращает пустой массив для несуществующего действия", () => {
      expect(allowedFrom("nonexistent" as TicketAction)).toEqual([]);
    });

    it("защищает внутренний массив от мутации", () => {
      const first = allowedFrom("cancel");
      first.push("closed");
      const second = allowedFrom("cancel");
      expect(second).toEqual(["new", "in_progress"]);
    });
  });
});
