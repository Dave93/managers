import { describe, expect, it } from "bun:test";
import type { CardItem, EmployeeRow } from "@admin/lib/kpi-api";
import {
  KPI_MAX_PHOTOS, buildViolationFormData, cancelReasonOk, createLatch, evaluableEmployees, evaluableTerminals, itemsForCard,
  violationIssues, type ViolationDraft,
} from "./violation-form";

const png = (name: string) => new File([Uint8Array.from([0x89, 0x50, 0x4e, 0x47])], name, { type: "image/png" });
const base: ViolationDraft = { terminal_id: "t1", employee_id: "e1", card_item_id: null, comment: "грязный пол на кухне", photos: [png("a.png")] };

describe("violationIssues", () => {
  it("лимит фото как на сервере", () => expect(KPI_MAX_PHOTOS).toBe(3));
  it("полная форма", () => expect(violationIssues(base, true)).toEqual([]));
  it("по порядку полей", () => {
    expect(violationIssues({ ...base, terminal_id: null, employee_id: null, comment: " ab ", photos: [] }, true)).toEqual([
      "Выберите филиал", "Выберите сотрудника", "Опишите нарушение: не меньше 3 символов", "Нужна хотя бы одна фотография",
    ]);
  });
  it("фото необязательно по настройке, но не больше трёх", () => {
    expect(violationIssues({ ...base, photos: [] }, false)).toEqual([]);
    expect(violationIssues({ ...base, photos: [png("1.png"), png("2.png"), png("3.png"), png("4.png")] }, false)).toEqual(["Не больше 3 фотографий"]);
  });
});

describe("buildViolationFormData", () => {
  it("без пункта поле не уходит, комментарий обрезан, фото под ключом photos", () => {
    const fd = buildViolationFormData({ ...base, comment: "  грязный пол  ", photos: [png("a.png"), png("b.png")] });
    expect(fd.get("employee_id")).toBe("e1");
    expect(fd.has("card_item_id")).toBe(false);
    expect(fd.has("terminal_id")).toBe(false);
    expect(fd.has("occurred_at")).toBe(false);
    expect(fd.get("comment")).toBe("грязный пол");
    expect(fd.getAll("photos")).toHaveLength(2);
  });
  it("с пунктом", () => expect(buildViolationFormData({ ...base, card_item_id: "i5" }).get("card_item_id")).toBe("i5"));
});

const emp = (o: Partial<EmployeeRow> & { id: string }): EmployeeRow => ({
  first_name: "Тест", last_name: "Повар", terminal_id: "t1", terminal_name: "Тест Филиал 1", staff_role_code: "cook",
  staff_role_name: "Повар", active: true, external_id: null, card: { id: "c-cook", code: "cook", title_ru: "Повар" },
  card_source: "role", review: null, open_dispute: false, can_evaluate: true, ...o,
});

describe("выбор сотрудника и пункта", () => {
  const rows = [
    emp({ id: "e1" }),
    emp({ id: "e2", terminal_id: "t2", terminal_name: "Тест Филиал 2", can_evaluate: false }),
    emp({ id: "e3", last_name: "Кассир" }),
  ];
  it("только филиалы из назначений", () => expect(evaluableTerminals(rows)).toEqual([{ id: "t1", name: "Тест Филиал 1" }]));
  it("сотрудники филиала по фамилии", () => expect(evaluableEmployees(rows, "t1").map((e) => e.id)).toEqual(["e3", "e1"]));
  it("без филиала — пусто", () => expect(evaluableEmployees(rows, null)).toEqual([]));
  const item = (o: Partial<CardItem> & { id: string }): CardItem => ({
    card_id: "c-cook", sort: 1, title_ru: "Пункт", title_uz: "Band", hint_ru: null, hint_uz: null, source: "manual",
    weight: 1, group_key: "base", active: true, ...o,
  });
  const cards = [{ id: "c-cook", items: [item({ id: "i2", sort: 2 }), item({ id: "i1", sort: 1 }), item({ id: "i3", sort: 3, active: false })] }];
  it("активные пункты карты по sort", () => expect(itemsForCard(cards, "c-cook").map((i) => i.id)).toEqual(["i1", "i2"]));
  it("нет карты — пусто", () => expect(itemsForCard(cards, null)).toEqual([]));
});

describe("createLatch", () => {
  it("второй захват до отпускания не проходит", () => {
    const l = createLatch();
    expect(l.acquire()).toBe(true);
    expect(l.acquire()).toBe(false);
    expect(l.held()).toBe(true);
    l.release();
    expect(l.acquire()).toBe(true);
  });
});

describe("cancelReasonOk", () => {
  it("не меньше 3 букв или цифр, как на сервере", () => {
    for (const bad of ["", "   ", "ок", "...", "о к", "!!!!!!"]) expect(cancelReasonOk(bad)).toBe(false);
    for (const ok of ["ошибка", "  а б в  ", "123", "дубль"]) expect(cancelReasonOk(ok)).toBe(true);
  });
});
