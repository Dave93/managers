import { expect, it } from "bun:test";
import type { EvReviewForm } from "@backend/modules/kpi/tg-app/ev-types";
import { evReviewView } from "../src/view/ev-review";

const item = (id: string, group: "base" | "extra", o: Partial<EvReviewForm["items"][number]> = {}): EvReviewForm["items"][number] =>
  ({ item_id: id, title_ru: `Пункт ${id}`, title_uz: `Band ${id}`, hint_ru: null, weight: 1, source: "manual", group_key: group, score: null, note: null, suggestion: null, violations: [], violation_hint: null, ...o });
const F: EvReviewForm = {
  period: "2026-10-01", period_status: "open", employee: { id: "e1", first_name: "Ботир", last_name: "Алиев", terminal_name: "Филиал А" }, card_title: "Повар (Chopar и Les Ailes)",
  review: null, items: [
    item("i1", "base", { source: "attendance", suggestion: { score: 80, basis: "Workly: 20 из 25 дней вовремя" }, violations: [{ id: "v1", occurred_at: "2026-10-14T14:40:00.000Z", comment: "Грязный пол" }], violation_hint: 90 }),
    item("i2", "base"), item("i3", "extra"),
  ],
  other_violations: [], can_edit: true, open_dispute: false, dispute_rejected: false, submit_opens_at: "2026-10-19T19:00:00.000Z", review_deadline: "2026-11-07T18:59:59.999Z",
};
const OPEN = Date.parse("2026-10-26T10:00:00+05:00");

it("шапка, группы, пункты", () => {
  const vm = evReviewView(F, "ru", OPEN);
  expect([vm.title, vm.sub, vm.mode, vm.banner, vm.submitAllowed]).toEqual(["Алиев Ботир", "Филиал А · Повар (Chopar и Les Ailes) · Октябрь", "edit", null, true]);
  expect(vm.groups.map((g) => [g.key, g.title, g.items.length])).toEqual([["base", "Основные пункты", 2], ["extra", "Дополнительные пункты", 1]]);
  expect(vm.groups[0]!.items[0]).toMatchObject({ sourceLabel: "по данным Workly", suggestionText: "Предложение: 80 · Workly: 20 из 25 дней вовремя", violationLine: "Нарушений за месяц: 1. Подсказка: 90", violationComments: ["14 октября: Грязный пол"] });
  expect(vm.groups[0]!.items[1]).toMatchObject({ sourceLabel: null, suggestionText: null, violationLine: null });
});
it("баннеры: закрыт, отправлена, спор, вне назначения, отправка ещё не открыта", () => {
  const sub = { ...F, review: { id: "r", status: "submitted" as const, score_pct: 90, version: 1, submitted_at: "2026-10-25T07:00:00.000Z", late: false }, can_edit: false };
  expect(evReviewView({ ...F, period_status: "closed", can_edit: false }, "ru", OPEN).banner).toEqual({ key: "ev_closed" });
  expect(evReviewView(sub, "ru", OPEN)).toMatchObject({ mode: "readonly", submitAllowed: false, banner: { key: "ev_readonly_submitted", vars: { date: "25 октября" } } });
  expect(evReviewView({ ...sub, open_dispute: true }, "ru", OPEN).banner).toEqual({ key: "ev_readonly_submitted", vars: { date: "25 октября" } });
  expect(evReviewView({ ...F, open_dispute: true, can_edit: false }, "ru", OPEN).banner).toEqual({ key: "ev_readonly_dispute" });
  expect(evReviewView({ ...F, can_edit: false }, "ru", OPEN).banner).toEqual({ key: "ev_readonly_scope" });
  const early = evReviewView(F, "ru", Date.parse("2026-10-10T10:00:00+05:00"));
  expect([early.mode, early.submitAllowed, early.banner]).toEqual(["edit", false, { key: "ev_form_opens", vars: { date: "20 октября" } }]);
});
it("узбекское название пункта, русского нет — русское", () => {
  const vm = evReviewView({ ...F, items: [{ ...F.items[0]!, title_uz: "" }, ...F.items.slice(1)] }, "uz", OPEN);
  expect(vm.groups[0]!.items[0]!.title).toBe(F.items[0]!.title_ru);
});
