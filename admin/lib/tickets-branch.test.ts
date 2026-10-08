/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";

import {
  ACTIVE_STATUSES,
  FINISHED_STATUSES,
  branchFilters,
  canAccept,
  canReturn,
  cardHasUnread,
  countGroups,
  currentResultPhotos,
  createdIdFrom,
  groupTickets,
  hasUnread,
  lastEventOf,
  resultColumn,
  showUnreadDot,
} from "./tickets-branch";
import type { TicketPriority, TicketStatus } from "./tickets-api";

// Здесь проверяется то, что на планшете ломается молча: точка не горит у
// комментария исполнителя или не гаснет после открытия, а заявка, ждущая
// приёмки, оказывается не в первой группе.

// Строки времени в том виде, как их отдаёт Postgres: пояс сессии БД («+05»),
// доли секунды до микросекунд. Тест на `new Date(s)` здесь бы не поймал ничего.
const SEEN = "2026-10-05 15:00:00.250+05"; // 10:00:00.250Z

describe("hasUnread", () => {
  test("отметки нет вовсе: горит, даже если событий нет", () => {
    expect(hasUnread({ manager_seen_at: null, last_event_at: null })).toBe(true);
    expect(hasUnread({ manager_seen_at: null, last_event_at: "2026-10-05 09:00:00+05" })).toBe(true);
    expect(hasUnread({ manager_seen_at: undefined, last_event_at: null })).toBe(true);
    expect(hasUnread({ manager_seen_at: "", last_event_at: null })).toBe(true);
  });

  test("событие новее отметки: горит (комментарий исполнителя)", () => {
    expect(hasUnread({ manager_seen_at: SEEN, last_event_at: "2026-10-05 16:30:00.100000+05" })).toBe(true);
  });

  test("событие старше отметки: не горит", () => {
    expect(hasUnread({ manager_seen_at: SEEN, last_event_at: "2026-10-05 14:59:59.999000+05" })).toBe(false);
  });

  test("события нет, отметка есть: не горит", () => {
    expect(hasUnread({ manager_seen_at: SEEN, last_event_at: null })).toBe(false);
  });

  test("сравнивается момент, а не текст: те же секунды в другом поясе", () => {
    // 10:30Z против 10:00:00.250Z. Как строка «2026-10-05 10:30:00+00» меньше
    // «2026-10-05 15:00:00.250+05», и сравнение текстом дало бы обратный ответ.
    expect(hasUnread({ manager_seen_at: SEEN, last_event_at: "2026-10-05 10:30:00+00" })).toBe(true);
    expect(hasUnread({ manager_seen_at: SEEN, last_event_at: "2026-10-05 09:30:00+00" })).toBe(false);
  });

  test("событие и отметка в один момент: не горит", () => {
    expect(hasUnread({ manager_seen_at: SEEN, last_event_at: SEEN })).toBe(false);
  });

  test("не разобралось время: горит, пропущенный комментарий дороже лишней точки", () => {
    expect(hasUnread({ manager_seen_at: "мусор", last_event_at: null })).toBe(true);
    expect(hasUnread({ manager_seen_at: SEEN, last_event_at: "мусор" })).toBe(true);
  });

  test("seen после события гасит точку (сценарий открытия карточки)", () => {
    const row = { manager_seen_at: null as string | null, last_event_at: "2026-10-05 16:30:00+05" };
    expect(hasUnread(row)).toBe(true);
    expect(hasUnread({ ...row, manager_seen_at: "2026-10-05 17:00:00.500+05" })).toBe(false);
  });
});

const ev = (created_at: string) => ({
  id: created_at,
  type: "comment" as const,
  actor_kind: "executor" as const,
  payload: {},
  created_at,
});

describe("lastEventOf / cardHasUnread", () => {
  test("берёт максимум по моменту, а не последнюю строку ленты", () => {
    const card = { events: [ev("2026-10-05 16:00:00+05"), ev("2026-10-05 12:00:00+05"), ev("2026-10-05 09:00:00+05")] };
    expect(lastEventOf(card)).toBe("2026-10-05 16:00:00+05");
  });

  test("пустая или битая лента даёт null", () => {
    expect(lastEventOf({ events: [] })).toBeNull();
    expect(lastEventOf({ events: [ev("мусор")] })).toBeNull();
    expect(lastEventOf({ events: undefined as never })).toBeNull();
  });

  test("карточка с комментарием после отметки непрочитана, после seen нет", () => {
    const events = [ev("2026-10-05 12:00:00+05"), ev("2026-10-05 16:00:00+05")];
    expect(cardHasUnread({ events, manager_seen_at: SEEN })).toBe(true);
    expect(cardHasUnread({ events, manager_seen_at: "2026-10-05 17:00:00+05" })).toBe(false);
    expect(cardHasUnread({ events, manager_seen_at: null })).toBe(true);
  });
});

const row = (id: string, status: TicketStatus, priority: TicketPriority = "normal") => ({ id, status, priority });

describe("groupTickets", () => {
  test("раскладывает по статусам: сдана, в работе, новая", () => {
    const g = groupTickets([row("a", "new"), row("b", "done"), row("c", "in_progress"), row("d", "done")]);
    expect(g.awaiting.map((r) => r.id)).toEqual(["b", "d"]);
    expect(g.inProgress.map((r) => r.id)).toEqual(["c"]);
    expect(g.fresh.map((r) => r.id)).toEqual(["a"]);
    expect(countGroups(g)).toBe(4);
  });

  test("свежая new-заявка не прячется никаким фильтром: она в группе «Новые»", () => {
    const g = groupTickets([row("created", "new")]);
    expect(g.fresh.map((r) => r.id)).toEqual(["created"]);
    expect(countGroups(g)).toBe(1);
  });

  test("срочные идут первыми, остальной порядок ответа сервера сохраняется", () => {
    const g = groupTickets([
      row("1", "new"),
      row("2", "new", "urgent"),
      row("3", "new"),
      row("4", "new", "urgent"),
    ]);
    expect(g.fresh.map((r) => r.id)).toEqual(["2", "4", "1", "3"]);
  });

  test("закрытые и отменённые не показываются в активных группах", () => {
    const g = groupTickets([row("x", "closed"), row("y", "cancelled")]);
    expect(countGroups(g)).toBe(0);
  });

  test("вход не мутируется", () => {
    const input = [row("1", "new"), row("2", "new", "urgent")];
    groupTickets(input);
    expect(input.map((r) => r.id)).toEqual(["1", "2"]);
  });
});

describe("branchFilters", () => {
  test("статусы и филиалы уходят оператором in, филиалы отсортированы для стабильного ключа", () => {
    expect(branchFilters(ACTIVE_STATUSES, ["b", "a"])).toEqual([
      { field: "status", operator: "in", value: ["new", "in_progress", "done"] },
      { field: "terminal_id", operator: "in", value: ["a", "b"] },
    ]);
  });

  test("активные и закрытые статусы не пересекаются и вместе покрывают все пять", () => {
    expect(ACTIVE_STATUSES.filter((s) => FINISHED_STATUSES.includes(s))).toEqual([]);
    expect([...ACTIVE_STATUSES, ...FINISHED_STATUSES].sort()).toEqual(
      ["cancelled", "closed", "done", "in_progress", "new"]
    );
  });

  test("исходный массив филиалов не переставляется", () => {
    const ids = ["b", "a"];
    branchFilters(ACTIVE_STATUSES, ids);
    expect(ids).toEqual(["b", "a"]);
  });
});

describe("createdIdFrom", () => {
  test("UUID проходит, регистр не важен", () => {
    expect(createdIdFrom("0b8f3c9e-1d2a-4f6b-8c7d-9e0a1b2c3d4e")).toBe("0b8f3c9e-1d2a-4f6b-8c7d-9e0a1b2c3d4e");
    expect(createdIdFrom("0B8F3C9E-1D2A-4F6B-8C7D-9E0A1B2C3D4E")).not.toBeNull();
  });

  test("всё остальное из адресной строки отбрасывается", () => {
    expect(createdIdFrom(null)).toBeNull();
    expect(createdIdFrom(undefined)).toBeNull();
    expect(createdIdFrom("")).toBeNull();
    expect(createdIdFrom("123")).toBeNull();
    expect(createdIdFrom("0b8f3c9e-1d2a-4f6b-8c7d-9e0a1b2c3d4e'; drop")).toBeNull();
    expect(createdIdFrom("../../tickets")).toBeNull();
  });
});

describe("панель приёмки: правая колонка и кнопки", () => {
  const all: TicketStatus[] = ["new", "in_progress", "done", "closed", "cancelled"];

  test("нет фото результата у new и in_progress: исполнитель ещё не сдал, принять нельзя", () => {
    for (const s of ["new", "in_progress"] as const) {
      expect(resultColumn(s, 0)).toBe("not_submitted");
      expect(canAccept(s, 0)).toBe(false);
    }
  });

  test("done без фото: принять нельзя, вернуть в работу можно", () => {
    expect(resultColumn("done", 0)).toBe("submitted_without_photos");
    expect(canAccept("done", 0)).toBe(false);
    expect(canReturn("done")).toBe(true);
  });

  test("done с фото: колонка с фото, принять можно", () => {
    expect(resultColumn("done", 2)).toBe("photos");
    expect(canAccept("done", 2)).toBe(true);
  });

  test("принять можно только из done: у остальных статусов кнопки нет даже с фото", () => {
    expect(all.filter((s) => canAccept(s, 3))).toEqual(["done"]);
    expect(all.filter((s) => canReturn(s))).toEqual(["done"]);
  });

  test("закрытая и отменённая без фото: просто «не приложены»", () => {
    expect(resultColumn("closed", 0)).toBe("none");
    expect(resultColumn("cancelled", 0)).toBe("none");
    expect(resultColumn("closed", 1)).toBe("photos");
  });
});

describe("resultColumn: статус раньше числа фото", () => {
  test("в работе и новая с фото прошлой сдачи: «ещё не сдал», не фото", () => {
    expect(resultColumn("in_progress", 2)).toBe("not_submitted");
    expect(resultColumn("new", 1)).toBe("not_submitted");
    expect(canAccept("in_progress", 2)).toBe(false);
  });
});

const att = (id: string, created_at: string, phase = "result") => ({ id, phase, created_at });
const reopened = (created_at: string) => ({ type: "reopened", created_at });

describe("currentResultPhotos", () => {
  test("возврата не было: все результатные, фото проблемы не берутся", () => {
    const card = { attachments: [att("a", "2026-10-05 10:00:00+05"), att("p", "2026-10-05 09:00:00+05", "problem")], events: [] };
    expect(currentResultPhotos(card).map((a) => a.id)).toEqual(["a"]);
  });

  test("после возврата прежние фото отвергнуты, новых нет: пусто", () => {
    const card = {
      attachments: [att("old1", "2026-10-05 10:00:00+05"), att("old2", "2026-10-05 10:01:00+05")],
      events: [reopened("2026-10-05 11:00:00+05")],
    };
    expect(currentResultPhotos(card)).toEqual([]);
  });

  test("после возврата и повторной сдачи: только новые снимки", () => {
    const card = {
      attachments: [att("old", "2026-10-05 10:00:00+05"), att("new", "2026-10-05 12:00:00+05")],
      events: [reopened("2026-10-05 11:00:00+05")],
    };
    expect(currentResultPhotos(card).map((a) => a.id)).toEqual(["new"]);
  });

  test("несколько возвратов: считается последний", () => {
    const card = {
      attachments: [att("r1", "2026-10-05 10:00:00+05"), att("r2", "2026-10-05 12:00:00+05"), att("r3", "2026-10-05 14:00:00+05")],
      events: [reopened("2026-10-05 11:00:00+05"), reopened("2026-10-05 13:00:00+05")],
    };
    expect(currentResultPhotos(card).map((a) => a.id)).toEqual(["r3"]);
  });

  test("сравнивается момент, а не текст (другой пояс)", () => {
    // 10:30Z-снимок позже 10:00:00.250Z-возврата, хотя как строка меньше.
    const card = { attachments: [att("a", "2026-10-05 10:30:00+00")], events: [reopened("2026-10-05 15:00:00.250+05")] };
    expect(currentResultPhotos(card).map((a) => a.id)).toEqual(["a"]);
  });

  test("возврат был, время вложения не разобралось: не текущее; возврата нет, не разобралось: остаётся", () => {
    expect(currentResultPhotos({ attachments: [att("a", "мусор")], events: [reopened("2026-10-05 11:00:00+05")] })).toEqual([]);
    expect(currentResultPhotos({ attachments: [att("a", "мусор")], events: [] })).toHaveLength(1);
  });

  test("возврат с неразобранным временем: давность снимков неизвестна, текущих нет (даже единственный такой возврат)", () => {
    const card = { attachments: [att("old", "2026-10-05 10:00:00+05"), att("new", "2026-10-05 12:00:00+05")], events: [reopened("мусор")] };
    expect(currentResultPhotos(card)).toEqual([]);
    const mixed = { ...card, events: [reopened("2026-10-05 11:00:00+05"), reopened("мусор")] };
    expect(currentResultPhotos(mixed)).toEqual([]);
    expect(canAccept("done", currentResultPhotos(card).length)).toBe(false);
  });

  test("сданная повторно без новых фото: принять нельзя, вернуть можно", () => {
    const card = { attachments: [att("old", "2026-10-05 10:00:00+05")], events: [reopened("2026-10-05 11:00:00+05")] };
    const n = currentResultPhotos(card).length;
    expect(resultColumn("done", n)).toBe("submitted_without_photos");
    expect(canAccept("done", n)).toBe(false);
    expect(canReturn("done")).toBe(true);
  });
});

describe("showUnreadDot: закрытые заявки без точки", () => {
  const unread = { manager_seen_at: "2026-10-05 10:00:00+05", last_event_at: "2026-10-05 12:00:00+05" };
  test("событие оплаты после отметки у закрытой и отменённой точку не зажигает", () => {
    expect(showUnreadDot({ status: "closed", ...unread })).toBe(false);
    expect(showUnreadDot({ status: "cancelled", ...unread })).toBe(false);
    expect(showUnreadDot({ status: "closed", manager_seen_at: null, last_event_at: null })).toBe(false);
  });
  test("у активных точка как у hasUnread", () => {
    for (const status of ["new", "in_progress", "done"] as const) {
      expect(showUnreadDot({ status, ...unread })).toBe(true);
      expect(showUnreadDot({ status, manager_seen_at: unread.last_event_at, last_event_at: unread.manager_seen_at })).toBe(false);
    }
  });
});
