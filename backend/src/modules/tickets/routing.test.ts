import { describe, expect, it } from "bun:test";
import { routeEvent, type RoutingInput } from "./routing";

const ex = (id: string, chat: number, lang = "ru") => ({ id, tg_user_id: chat, lang, is_active: true });

const base: RoutingInput = {
  event: { type: "created", actor_kind: "manager" },
  ticket: { id: "t1", status: "new", assigned_executor_id: null },
  firmExecutors: [ex("e1", 111), ex("e2", 222)],
  broadcast: [],
};

describe("routeEvent", () => {
  it("рассылает новую заявку всем исполнителям фирмы", () => {
    const r = routeEvent(base);
    expect(r.map((x) => x.chat_id).sort()).toEqual([111, 222]);
    expect(r.every((x) => x.kind === "send")).toBe(true);
  });

  it("пропускает неактивных исполнителей и людей без привязки к боту", () => {
    const r = routeEvent({
      ...base,
      firmExecutors: [ex("e1", 111), { ...ex("e2", 222), is_active: false }, { id: "e3", tg_user_id: null, lang: "ru", is_active: true }],
    });
    expect(r.map((x) => x.chat_id)).toEqual([111]);
  });

  it("при захвате гасит кнопку у остальных и подтверждает взявшему", () => {
    const r = routeEvent({
      event: { type: "assigned", actor_kind: "executor", actor_executor_id: "e1" },
      ticket: { id: "t1", status: "in_progress", assigned_executor_id: "e1" },
      firmExecutors: [ex("e1", 111), ex("e2", 222)],
      broadcast: [
        { executor_id: "e1", chat_id: 111, tg_message_id: 900 },
        { executor_id: "e2", chat_id: 222, tg_message_id: 901 },
      ],
    });
    const edits = r.filter((x) => x.kind === "edit");
    expect(edits.map((x) => x.chat_id)).toEqual([222]);
    expect(edits[0].target_message_id).toBe(901);
    const sends = r.filter((x) => x.kind === "send");
    expect(sends.map((x) => x.chat_id)).toEqual([111]);
  });

  it("при захвате исполнителем, который ушёл из фирмы, только гасит кнопки", () => {
    const r = routeEvent({
      event: { type: "assigned", actor_kind: "executor", actor_executor_id: "e1" },
      ticket: { id: "t1", status: "in_progress", assigned_executor_id: "e1" },
      firmExecutors: [ex("e2", 222)], // e1 больше не в списке
      broadcast: [
        { executor_id: "e1", chat_id: 111, tg_message_id: 900 },
        { executor_id: "e2", chat_id: 222, tg_message_id: 901 },
      ],
    });
    // Нет send для e1 (его нет в firmExecutors)
    expect(r.filter((x) => x.kind === "send")).toEqual([]);
    // e2 получает edit чтобы убрать кнопку
    expect(r.filter((x) => x.kind === "edit").map((x) => x.chat_id)).toEqual([222]);
  });

  it("комментарий менеджера уходит только исполнителю", () => {
    const r = routeEvent({
      event: { type: "comment", actor_kind: "manager" },
      ticket: { id: "t1", status: "in_progress", assigned_executor_id: "e1" },
      firmExecutors: [ex("e1", 111), ex("e2", 222)],
      broadcast: [],
    });
    expect(r.map((x) => x.chat_id)).toEqual([111]);
  });

  it("комментарий исполнителя не уходит никому", () => {
    const r = routeEvent({
      event: { type: "comment", actor_kind: "executor", actor_executor_id: "e1" },
      ticket: { id: "t1", status: "in_progress", assigned_executor_id: "e1" },
      firmExecutors: [ex("e1", 111)],
      broadcast: [],
    });
    expect(r).toEqual([]);
  });

  it("возврат в работу и закрытие уходят исполнителю", () => {
    for (const type of ["reopened", "closed"] as const) {
      const r = routeEvent({
        event: { type, actor_kind: "manager" },
        ticket: { id: "t1", status: type === "closed" ? "closed" : "in_progress", assigned_executor_id: "e1" },
        firmExecutors: [ex("e1", 111), ex("e2", 222)],
        broadcast: [],
      });
      expect(r.map((x) => x.chat_id)).toEqual([111]);
    }
  });

  it("отмена гасит кнопку у нерешивших и пишет взявшему", () => {
    const r = routeEvent({
      event: { type: "cancelled", actor_kind: "manager" },
      ticket: { id: "t1", status: "cancelled", assigned_executor_id: "e1" },
      firmExecutors: [ex("e1", 111), ex("e2", 222)],
      broadcast: [
        { executor_id: "e1", chat_id: 111, tg_message_id: 900 },
        { executor_id: "e2", chat_id: 222, tg_message_id: 901 },
      ],
    });
    expect(r.filter((x) => x.kind === "edit").map((x) => x.chat_id)).toEqual([222]);
    expect(r.filter((x) => x.kind === "send").map((x) => x.chat_id)).toEqual([111]);
  });

  it("отмена неназначенной заявки только гасит кнопки", () => {
    const r = routeEvent({
      event: { type: "cancelled", actor_kind: "manager" },
      ticket: { id: "t1", status: "cancelled", assigned_executor_id: null },
      firmExecutors: [ex("e1", 111), ex("e2", 222)],
      broadcast: [
        { executor_id: "e1", chat_id: 111, tg_message_id: 900 },
        { executor_id: "e2", chat_id: 222, tg_message_id: 901 },
      ],
    });
    expect(r.every((x) => x.kind === "edit")).toBe(true);
    expect(r.map((x) => x.chat_id).sort()).toEqual([111, 222]);
  });

  it("платёжные события не уходят наружу", () => {
    for (const type of ["payment_approved", "payment_rejected"] as const) {
      const r = routeEvent({
        event: { type, actor_kind: "office" },
        ticket: { id: "t1", status: "closed", assigned_executor_id: "e1" },
        firmExecutors: [ex("e1", 111)],
        broadcast: [],
      });
      expect(r).toEqual([]);
    }
  });

  it("сдача работы исполнителем никому не шлётся", () => {
    const r = routeEvent({
      event: { type: "done_submitted", actor_kind: "executor", actor_executor_id: "e1" },
      ticket: { id: "t1", status: "done", assigned_executor_id: "e1" },
      firmExecutors: [ex("e1", 111)],
      broadcast: [],
    });
    expect(r).toEqual([]);
  });

  it("язык получателя переносится в адресата", () => {
    const r = routeEvent({ ...base, firmExecutors: [ex("e1", 111, "uz")] });
    expect(r[0].lang).toBe("uz");
  });
});
