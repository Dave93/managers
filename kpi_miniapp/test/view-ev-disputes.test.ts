import { expect, it } from "bun:test";
import type { EvDispute, EvDisputeDetail, EvFormItem, EvReviewForm } from "@backend/modules/kpi/tg-app/ev-types";
import { draftFromItems } from "../src/view/ev-score";
import { evDisputesView, resolveBody, resolveIssues } from "../src/view/ev-disputes";

const DR = (o: Partial<EvDispute> = {}): EvDispute => ({ id: "d1", subject_type: "review", subject_id: "r1", employee_id: "e1", employee_name: "Алиев Ботир", terminal_name: "Филиал А",
  period: "2026-10-01", reason: "Не согласен", status: "open", resolution_comment: null, resolved_at: null, created_at: "2026-10-01T07:00:00.000Z", can_resolve: true,
  subject: { kind: "review", score_pct: 91.4 }, ...o });
const item = (id: string, score: number): EvFormItem => ({ item_id: id, title_ru: id, title_uz: id, hint_ru: null, weight: 1, source: "manual", group_key: "base", score, note: null, suggestion: null, violations: [], violation_hint: null });
const FORM: EvReviewForm = { period: "2026-10-01", period_status: "open", employee: { id: "e1", first_name: "Ботир", last_name: "Алиев", terminal_name: "Филиал А" }, card_title: "Повар",
  review: { id: "r1", status: "submitted", score_pct: 75, version: 1, submitted_at: "2026-10-25T07:00:00.000Z", late: false }, items: [item("m1", 100), item("m2", 50)], other_violations: [],
  can_edit: false, open_dispute: true, dispute_rejected: false, submit_opens_at: "2026-10-19T19:00:00.000Z", review_deadline: "2026-11-07T18:59:59.999Z" };
const DET: EvDisputeDetail = { dispute: DR(), comment_min: 5, form: FORM };

it("порядок и чипы: ждут моего разбора, открытые чужие, разобранные по давности", () => {
  const vm = evDisputesView({ items: [
    DR({ id: "acc", status: "accepted", can_resolve: false, resolved_at: "2026-10-12T07:00:00.000Z", created_at: "2026-10-09T07:00:00.000Z" }),
    DR({ id: "other", can_resolve: false, created_at: "2026-10-15T07:00:00.000Z" }),
    DR({ id: "old", created_at: "2026-10-10T07:00:00.000Z" }),
    DR({ id: "new", created_at: "2026-10-14T07:00:00.000Z", subject_type: "violation", subject: { kind: "violation", item_title_ru: null, comment: "Грязь", photo_ids: [] } }),
    DR({ id: "rej", status: "rejected", can_resolve: false, resolved_at: "2026-10-13T07:00:00.000Z" }),
  ] }, "ru");
  expect(vm.rows.map((r) => r.id)).toEqual(["new", "old", "other", "rej", "acc"]);
  const by = new Map(vm.rows.map((r) => [r.id, r]));
  expect([by.get("new")!.chip, by.get("other")!.chip, by.get("acc")!.chip, by.get("rej")!.chip]).toEqual([
    { text: "Ждёт разбора", tone: "wait" }, { text: "Открыт", tone: "muted" }, { text: "Принят", tone: "ok" }, { text: "Отклонён", tone: "muted" }]);
  expect(by.get("new")).toMatchObject({ who: "Алиев Ботир · Филиал А", kind: "Нарушение, октябрь", canResolve: true, hash: "#/ev/dispute/new" });
  expect(by.get("old")!.kind).toBe("Оценка за октябрь");
  expect(evDisputesView({ items: [] }, "ru").empty).toBe(true);
});
it("resolveIssues: отклонить — только комментарий; принять оценку — баллы и комментарий; нарушение — только комментарий", () => {
  const same = draftFromItems(DET.form!.items, false);
  expect(resolveIssues({ decision: "rejected", comment: "ок", draft: same }, DET)).toEqual([{ code: "comment_required" }]);
  expect(resolveIssues({ decision: "rejected", comment: "Оценка верна", draft: same }, DET)).toEqual([]);
  expect(resolveIssues({ decision: "accepted", comment: "Пересчитал по табелю", draft: same }, DET)).toEqual([{ code: "no_changes" }]);
  const changed = { ...same, m2: { score: 100, note: "" } };
  expect(resolveIssues({ decision: "accepted", comment: "Пересчитал по табелю", draft: changed }, DET)).toEqual([]);
  expect(resolveIssues({ decision: "accepted", comment: "", draft: changed }, DET)).toEqual([{ code: "comment_required" }]);
  const vio: EvDisputeDetail = { ...DET, form: null, dispute: DR({ subject_type: "violation", subject: { kind: "violation", item_title_ru: null, comment: "Грязь", photo_ids: [] } }) };
  expect(resolveIssues({ decision: "accepted", comment: "Нарушение снято", draft: {} }, vio)).toEqual([]);
});
it("resolveBody: баллы только при принятии оценки, комментарий обрезан", () => {
  const changed = { ...draftFromItems(DET.form!.items, false), m2: { score: 100, note: "" } };
  expect(resolveBody({ decision: "accepted", comment: "  Пересчитал по табелю ", draft: changed }, DET)).toEqual({
    decision: "accepted", comment: "Пересчитал по табелю", items: [{ item_id: "m1", score: 100, note: null }, { item_id: "m2", score: 100, note: null }] });
  expect(resolveBody({ decision: "rejected", comment: "Оценка верна", draft: changed }, DET)).toEqual({ decision: "rejected", comment: "Оценка верна" });
});
