import { expect, it } from "bun:test";
import type { EvViolationForm } from "@backend/modules/kpi/tg-app/ev-types";
import { buildViolationForm, violationIssues } from "../src/view/ev-violation";

const F: EvViolationForm = { employee: { id: "e1", first_name: "Ботир", last_name: "Алиев", terminal_name: "Филиал А" }, card_title: "Повар",
  items: [{ id: "i1", title_ru: "Чистота кухни", title_uz: "Oshxona tozaligi" }], photo_required: false, max_photos: 3, max_photo_bytes: 10485760, comment_min: 3 };
const ph = (n: number) => Array.from({ length: n }, (_, i) => new File(["x"], `p${i}.png`, { type: "image/png" }));

it("violationIssues: комментарий, обязательное фото, лимит", () => {
  expect(violationIssues({ item_id: null, comment: "аб", photos: [] }, F)).toEqual(["comment"]);
  expect(violationIssues({ item_id: null, comment: "...", photos: [] }, F)).toEqual(["comment"]);
  expect(violationIssues({ item_id: null, comment: "Грязь", photos: [] }, F)).toEqual([]);
  expect(violationIssues({ item_id: null, comment: "Грязь", photos: [] }, { ...F, photo_required: true })).toEqual(["photo_required"]);
  expect(violationIssues({ item_id: null, comment: "Грязь", photos: ph(4) }, F)).toEqual(["too_many_photos"]);
});
it("buildViolationForm: поля, trim, пункт только если выбран, фото по одному полю", () => {
  const fd = buildViolationForm("emp-1", { item_id: "i1", comment: "  Грязный пол ", photos: ph(2) });
  expect([fd.get("employee_id"), fd.get("card_item_id"), fd.get("comment"), fd.getAll("photos").length]).toEqual(["emp-1", "i1", "Грязный пол", 2]);
  expect(buildViolationForm("emp-1", { item_id: null, comment: "Грязь", photos: [] }).has("card_item_id")).toBe(false);
});
