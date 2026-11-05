import { expect, it } from "bun:test";
import type { EvDayOff, EvDaysOff } from "@backend/modules/kpi/tg-app/ev-types";
import { evDaysOffView } from "../src/view/ev-daysoff";

const R = (o: Partial<EvDayOff>): EvDayOff => ({
  id: "d1", employee_id: "e1", employee_name: "Алиев Ботир", terminal_name: "Филиал А", day: "2025-10-27",
  reason_code: "sick", reason_text: null, status: "active", can_cancel: true, ...o,
});
const D = (items: EvDayOff[], closed = false): EvDaysOff => ({ period: "2025-10-01", period_status: closed ? "closed" : "open", items });

it("строка: кто, день, причина, статус, право отмены", () => {
  const vm = evDaysOffView(D([R({})]), "ru");
  expect(vm.title).toBe("Выданные выходные · октябрь");
  expect(vm.items[0]).toEqual({ id: "d1", who: "Алиев Ботир · Филиал А", day: "27 октября", reason: "Болезнь", status: { text: "действует", tone: "active" }, canCancel: true });
  expect([vm.empty, vm.closed]).toEqual([false, false]);
});

it("«другая» причина показывает текст, отменённый приглушён и не отменяется", () => {
  const vm = evDaysOffView(
    D([R({ id: "a", reason_code: "other", reason_text: "Свадьба брата" }), R({ id: "b", status: "cancelled", can_cancel: false, terminal_name: null })]),
    "ru"
  );
  const by = new Map(vm.items.map((x) => [x.id, x]));
  expect(by.get("a")).toMatchObject({ reason: "Свадьба брата" });
  expect(by.get("b")).toMatchObject({ who: "Алиев Ботир", status: { text: "отменён", tone: "muted" }, canCancel: false });
});

it("пустой список и закрытый месяц", () => {
  expect(evDaysOffView(D([]), "ru")).toMatchObject({ empty: true, closed: false, items: [] });
  expect(evDaysOffView(D([R({ can_cancel: false })], true), "ru")).toMatchObject({ empty: false, closed: true });
  expect(evDaysOffView(D([R({})]), "uz").items[0]!.day).toBe("27-oktabr");
});
