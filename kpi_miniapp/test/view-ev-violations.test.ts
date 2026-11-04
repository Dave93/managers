import { expect, it } from "bun:test";
import type { EvViolation, EvViolations } from "@backend/modules/kpi/tg-app/ev-types";
import { evViolationsView } from "../src/view/ev-violations";

const V = (o: Partial<EvViolation>): EvViolation => ({ id: "v1", employee_id: "e1", employee_name: "Алиев Ботир", terminal_name: "Филиал А", card_item_id: null, item_title_ru: "Чистота кухни",
  period: "2026-10-01", occurred_at: "2026-10-14T14:40:00.000Z", comment: "Грязный пол у кассы", status: "active", cancel_reason: null, photo_ids: ["p1"], open_dispute: false, can_cancel: true, ...o });
const D = (items: EvViolation[], closed = false): EvViolations => ({ period: "2026-10-01", period_status: closed ? "closed" : "open", items });

it("строка: пункт, время по Ташкенту, статус, право отмены", () => {
  const vm = evViolationsView(D([V({})]), "ru");
  expect(vm.title).toBe("Мои нарушения · октябрь");
  expect(vm.items[0]).toEqual({ id: "v1", who: "Алиев Ботир · Филиал А", item: "Чистота кухни", when: "14 октября, 19:40", comment: "Грязный пол у кассы",
    status: { text: "действует", tone: "active" }, cancelReason: null, photoIds: ["p1"], canCancel: true, line: null });
});
it("отменённое, спор, закрытый месяц, без пункта", () => {
  const vm = evViolationsView(D([
    V({ id: "a", status: "cancelled", cancel_reason: "записано по ошибке", can_cancel: false }),
    V({ id: "b", open_dispute: true, can_cancel: false }),
    V({ id: "c", can_cancel: false, item_title_ru: null }),
  ], true), "ru");
  const by = new Map(vm.items.map((x) => [x.id, x]));
  expect(by.get("a")).toMatchObject({ status: { text: "отменено", tone: "muted" }, cancelReason: "записано по ошибке", line: null });
  expect(by.get("b")).toMatchObject({ status: { text: "спор открыт", tone: "warn" }, line: "По нарушению открыт спор. Отменить его можно только разбором спора." });
  expect(by.get("c")).toMatchObject({ item: "Без пункта карты", line: "Месяц закрыт, отменить нельзя." });
  expect(evViolationsView(D([]), "ru").empty).toBe(true);
});
