import { describe, expect, it } from "bun:test";
import { validateDetails, validateSchema, type FieldDef } from "./fields";

const SCHEMA: FieldDef[] = [
  {
    key: "tv_place",
    type: "select",
    required: true,
    label_ru: "Какой телевизор",
    label_uz: "Qaysi televizor",
    options: [
      { value: "hall", label_ru: "Зал", label_uz: "Zal" },
      { value: "kitchen", label_ru: "Кухня", label_uz: "Oshxona" },
    ],
  },
  { key: "note", type: "text", required: false, label_ru: "Описание", label_uz: "Izoh" },
];

describe("validateSchema", () => {
  it("принимает корректную схему", () => {
    const r = validateSchema(SCHEMA);
    expect(r.ok).toBe(true);
  });

  it("требует непустой список вариантов у select", () => {
    const r = validateSchema([{ ...SCHEMA[0], options: [] }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toContain("tv_place");
  });

  it("отвергает повторяющиеся ключи полей", () => {
    const r = validateSchema([SCHEMA[1], SCHEMA[1]]);
    expect(r.ok).toBe(false);
  });

  it("отвергает ключ не в snake_case", () => {
    const r = validateSchema([{ ...SCHEMA[1], key: "TV Place" }]);
    expect(r.ok).toBe(false);
  });

  it("требует обе подписи", () => {
    const r = validateSchema([{ ...SCHEMA[1], label_uz: "" }]);
    expect(r.ok).toBe(false);
  });

  it("отвергает повторяющиеся значения вариантов", () => {
    const r = validateSchema([
      {
        ...SCHEMA[0],
        options: [
          { value: "hall", label_ru: "Зал", label_uz: "Zal" },
          { value: "hall", label_ru: "Ещё зал", label_uz: "Yana zal" },
        ],
      },
    ]);
    expect(r.ok).toBe(false);
  });

  it("отвергает не массив", () => {
    expect(validateSchema({ key: "x" }).ok).toBe(false);
    expect(validateSchema(null).ok).toBe(false);
  });
});

describe("validateDetails", () => {
  it("принимает валидные значения и обрезает пробелы", () => {
    const r = validateDetails(SCHEMA, { tv_place: "hall", note: "  мигает  " });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.details).toEqual({ tv_place: "hall", note: "мигает" });
  });

  it("требует обязательное поле", () => {
    const r = validateDetails(SCHEMA, { note: "мигает" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toContain("tv_place");
  });

  it("считает пустую строку отсутствующим значением", () => {
    expect(validateDetails(SCHEMA, { tv_place: "   " }).ok).toBe(false);
  });

  it("отвергает значение select вне списка вариантов", () => {
    expect(validateDetails(SCHEMA, { tv_place: "toilet" }).ok).toBe(false);
  });

  it("отвергает неизвестные ключи", () => {
    expect(validateDetails(SCHEMA, { tv_place: "hall", hacked: "1" }).ok).toBe(false);
  });

  it("пропускает необязательное поле", () => {
    const r = validateDetails(SCHEMA, { tv_place: "kitchen" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.details).toEqual({ tv_place: "kitchen" });
  });

  it("ограничивает длину текста", () => {
    expect(validateDetails(SCHEMA, { tv_place: "hall", note: "x".repeat(2001) }).ok).toBe(false);
  });
});

// Fix round 1: Additional coverage and defect tests
describe("validateSchema - additional coverage", () => {
  it("отвергает массив как элемент схемы", () => {
    const r = validateSchema([[] as unknown]);
    expect(r.ok).toBe(false);
  });

  it("отвергает нестроковый label_ru", () => {
    const r = validateSchema([{ ...SCHEMA[1], label_ru: 123 }]);
    expect(r.ok).toBe(false);
  });

  it("отвергает нестроковый label_uz", () => {
    const r = validateSchema([{ ...SCHEMA[1], label_uz: null }]);
    expect(r.ok).toBe(false);
  });

  it("отвергает нестроковый option value", () => {
    const r = validateSchema([
      {
        ...SCHEMA[0],
        options: [{ value: 42, label_ru: "Зал", label_uz: "Zal" }],
      },
    ]);
    expect(r.ok).toBe(false);
  });

  it("отвергает не-объект в options", () => {
    const r = validateSchema([
      {
        ...SCHEMA[0],
        options: [null, { value: "hall", label_ru: "Зал", label_uz: "Zal" }],
      },
    ]);
    expect(r.ok).toBe(false);
  });
});

describe("validateDetails - additional coverage", () => {
  it("отвергает массив как raw", () => {
    const r = validateDetails(SCHEMA, []);
    expect(r.ok).toBe(false);
  });

  it("требует поле, присланное объектом", () => {
    const r = validateDetails(SCHEMA, { tv_place: { nested: "value" } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes("tv_place"))).toBe(true);
    // Error should NOT be "обязательное поле" since the key is present
    if (!r.ok) expect(r.errors.some((e) => e.includes("должно быть строкой"))).toBe(true);
  });

  it("отвергает опциональное поле, присланное объектом", () => {
    const r = validateDetails(SCHEMA, { tv_place: "hall", note: { bad: "value" } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes("note"))).toBe(true);
  });

  it("отвергает поле, присланное массивом", () => {
    const r = validateDetails(SCHEMA, { tv_place: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes("tv_place"))).toBe(true);
  });

  it("отвергает поле, присланное числом", () => {
    const r = validateDetails(SCHEMA, { tv_place: 42 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes("tv_place"))).toBe(true);
  });

  it("отвергает поле, присланное булевым", () => {
    const r = validateDetails(SCHEMA, { tv_place: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes("tv_place"))).toBe(true);
  });
});
