/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import {
  needsConfirmation,
  noRisks,
  orphanRisks,
  prefixChange,
  type FieldDraft,
  type OptionDraft,
  type OrphanRisks,
} from "./rules";

// Логика, которая решает, спросит ли редактор подтверждение перед
// разрушительной правкой схемы. Сбой здесь тихий: диалог просто не появится,
// а значения в старых заявках останутся без подписи. Валидацию схемы (зеркало
// backend validateSchema) здесь не проверяем — её сверяет
// backend/src/modules/tickets/schema-parity.test.ts.

const opt = (uid: string, value: string): OptionDraft => ({
  uid,
  value,
  label_ru: value,
  label_uz: value,
});

const text = (uid: string, key: string): FieldDraft => ({
  uid,
  key,
  type: "text",
  required: false,
  label_ru: key,
  label_uz: key,
  options: [],
  touched: true,
});

const select = (uid: string, key: string, values: string[]): FieldDraft => ({
  ...text(uid, key),
  type: "select",
  options: values.map((v, i) => opt(`${uid}o${i}`, v)),
});

const EMPTY: OrphanRisks = { removed: [], renamed: [], optionLoss: [], reused: [] };

describe("orphanRisks: правка без риска", () => {
  test("ничего не менялось", () => {
    const initial = [text("u1", "room"), select("u2", "kind", ["a", "b"])];
    expect(orphanRisks(initial, initial)).toEqual(EMPTY);
    expect(noRisks(orphanRisks(initial, initial))).toBe(true);
  });

  test("подписи, обязательность и порядок полей не рискуют ничем", () => {
    const initial = [text("u1", "room"), text("u2", "floor")];
    const current = [
      { ...text("u2", "floor"), label_ru: "Этаж", required: true },
      { ...text("u1", "room"), label_uz: "Xona" },
    ];
    expect(orphanRisks(initial, current)).toEqual(EMPTY);
  });

  test("новое поле с новым ключом", () => {
    const initial = [text("u1", "room")];
    const current = [text("u1", "room"), text("u3", "floor")];
    expect(orphanRisks(initial, current)).toEqual(EMPTY);
  });

  test("новые варианты у select ничего не осиротят", () => {
    const initial = [select("u1", "kind", ["a"])];
    const current = [select("u1", "kind", ["a", "b"])];
    expect(orphanRisks(initial, current)).toEqual(EMPTY);
  });

  test("text -> select ничего не осиротит", () => {
    const initial = [text("u1", "kind")];
    const current = [select("u1", "kind", ["a"])];
    expect(orphanRisks(initial, current)).toEqual(EMPTY);
  });

  test("поле без ключа в исходной схеме не считается: значений в заявках у него не было", () => {
    const initial = [text("u1", "")];
    expect(orphanRisks(initial, [text("u1", "room")])).toEqual(EMPTY);
    expect(orphanRisks(initial, [])).toEqual(EMPTY);
  });

  test("пустой ключ в правленой схеме не считается переиспользованием", () => {
    const initial = [text("u1", "room"), text("u2", "")];
    const current = [text("u1", "room"), text("u3", "")];
    expect(orphanRisks(initial, current)).toEqual(EMPTY);
  });
});

describe("orphanRisks: удаление и переименование", () => {
  test("удаление поля", () => {
    const initial = [text("u1", "room"), text("u2", "floor")];
    const r = orphanRisks(initial, [text("u1", "room")]);
    expect(r).toEqual({ ...EMPTY, removed: ["floor"] });
  });

  test("переименование ключа", () => {
    const initial = [text("u1", "room")];
    const r = orphanRisks(initial, [text("u1", "cabinet")]);
    expect(r).toEqual({ ...EMPTY, renamed: [{ from: "room", to: "cabinet" }] });
  });

  test("переименование поля с select не дублируется потерей вариантов", () => {
    const initial = [select("u1", "kind", ["a", "b"])];
    const r = orphanRisks(initial, [select("u1", "type", ["a"])]);
    expect(r.renamed).toEqual([{ from: "kind", to: "type" }]);
    expect(r.optionLoss).toEqual([]);
  });
});

describe("orphanRisks: переиспользование ключа", () => {
  test("удалили x и переименовали y в x: ключ x теперь у другого поля", () => {
    const initial = [text("u1", "x"), text("u2", "y")];
    const r = orphanRisks(initial, [text("u2", "x")]);
    expect(r.removed).toEqual(["x"]);
    expect(r.renamed).toEqual([{ from: "y", to: "x" }]);
    expect(r.reused).toEqual(["x"]);
  });

  test("ключи поменяли местами: оба переиспользованы, никто не удалён", () => {
    const initial = [text("u1", "a"), text("u2", "b")];
    const current = [text("u1", "b"), text("u2", "a")];
    const r = orphanRisks(initial, current);
    expect(r.removed).toEqual([]);
    expect(r.renamed).toEqual([
      { from: "a", to: "b" },
      { from: "b", to: "a" },
    ]);
    expect([...r.reused].sort()).toEqual(["a", "b"]);
    expect(noRisks(r)).toBe(false);
  });

  test("удалили поле и завели новое с тем же ключом: пометки «удалено» не будет, поэтому reused", () => {
    const initial = [text("u1", "room")];
    const r = orphanRisks(initial, [text("u9", "room")]);
    expect(r.removed).toEqual(["room"]);
    expect(r.reused).toEqual(["room"]);
  });

  test("новое поле, взявшее ключ существующего, при живом старом", () => {
    const initial = [text("u1", "room")];
    const r = orphanRisks(initial, [text("u1", "cabinet"), text("u9", "room")]);
    expect(r.renamed).toEqual([{ from: "room", to: "cabinet" }]);
    expect(r.reused).toEqual(["room"]);
  });

  test("один ключ у двух полей в момент набора называется один раз", () => {
    const initial = [text("u1", "a")];
    const r = orphanRisks(initial, [text("u2", "a"), text("u3", "a")]);
    expect(r.reused).toEqual(["a"]);
  });

  test("поле, оставшееся при своём ключе, не переиспользует его", () => {
    const initial = [text("u1", "a"), text("u2", "b")];
    expect(orphanRisks(initial, [text("u1", "a")]).reused).toEqual([]);
  });
});

describe("orphanRisks: потеря вариантов select", () => {
  test("убран вариант", () => {
    const initial = [select("u1", "kind", ["a", "b", "c"])];
    const r = orphanRisks(initial, [select("u1", "kind", ["a", "c"])]);
    expect(r.optionLoss).toEqual([{ key: "kind", values: ["b"], toText: false }]);
  });

  test("переименованное значение варианта считается потерей старого", () => {
    const initial = [select("u1", "kind", ["a", "b"])];
    const r = orphanRisks(initial, [select("u1", "kind", ["a", "z"])]);
    expect(r.optionLoss).toEqual([{ key: "kind", values: ["b"], toText: false }]);
  });

  test("значения сравниваются после обрезки пробелов", () => {
    const initial = [select("u1", "kind", ["a", "b"])];
    // « b» сервер сохранит как «b», то есть вариант цел.
    const kept = orphanRisks(initial, [select("u1", "kind", ["a", " b "])]);
    expect(kept.optionLoss).toEqual([]);
    const lost = orphanRisks([select("u1", "kind", [" a "])], [select("u1", "kind", ["b"])]);
    expect(lost.optionLoss).toEqual([{ key: "kind", values: ["a"], toText: false }]);
  });

  test("пустые значения в исходных вариантах не считаются потерей", () => {
    const initial = [select("u1", "kind", ["a", ""])];
    expect(orphanRisks(initial, [select("u1", "kind", ["a"])]).optionLoss).toEqual([]);
  });

  test("повтор потерянного значения называется один раз", () => {
    const initial = [select("u1", "kind", ["a", "b", "b"])];
    const r = orphanRisks(initial, [select("u1", "kind", ["a"])]);
    expect(r.optionLoss).toEqual([{ key: "kind", values: ["b"], toText: false }]);
  });

  test("select стал text: потеряны все варианты", () => {
    const initial = [select("u1", "kind", ["a", "b"])];
    const r = orphanRisks(initial, [text("u1", "kind")]);
    expect(r.optionLoss).toEqual([{ key: "kind", values: [], toText: true }]);
  });

  test("select без вариантов, ставший text, тоже помечается", () => {
    const r = orphanRisks([select("u1", "kind", [])], [text("u1", "kind")]);
    expect(r.optionLoss).toEqual([{ key: "kind", values: [], toText: true }]);
  });
});

describe("prefixChange", () => {
  test("при создании префикс не «меняется»", () => {
    expect(prefixChange("create", "", "TS")).toBeNull();
    expect(prefixChange("create", "AA", "BB")).toBeNull();
  });

  test("правка без изменения префикса", () => {
    expect(prefixChange("edit", "TS", "TS")).toBeNull();
  });

  test("пробелы по краям не считаются сменой", () => {
    expect(prefixChange("edit", "TS", " TS ")).toBeNull();
  });

  test("смена возвращает обрезанные значения", () => {
    expect(prefixChange("edit", " TS", "TX ")).toEqual({ from: "TS", to: "TX" });
  });

  test("регистр различается", () => {
    expect(prefixChange("edit", "TS", "ts")).toEqual({ from: "TS", to: "ts" });
  });
});

describe("needsConfirmation", () => {
  const change = { from: "TS", to: "TX" };

  test("создание типа не спрашивает ничего, даже при «рисках» и смене префикса", () => {
    const risky: OrphanRisks = { removed: ["a"], renamed: [], optionLoss: [], reused: ["b"] };
    expect(needsConfirmation("create", risky, change)).toBe(false);
    expect(needsConfirmation("create", EMPTY, null)).toBe(false);
  });

  test("правка без рисков и без смены префикса идёт без вопроса", () => {
    expect(needsConfirmation("edit", EMPTY, null)).toBe(false);
  });

  test("правка со сменой префикса спрашивает, даже если схема цела", () => {
    expect(needsConfirmation("edit", EMPTY, change)).toBe(true);
  });

  // Каждая категория риска сама по себе открывает диалог. Особенно reused:
  // отдельной пометки «поле удалено» у неё нет, и если её забыть в noRisks,
  // диалог не появится вовсе.
  test.each([
    ["removed", { ...EMPTY, removed: ["a"] }],
    ["renamed", { ...EMPTY, renamed: [{ from: "a", to: "b" }] }],
    ["optionLoss", { ...EMPTY, optionLoss: [{ key: "k", values: ["v"], toText: false }] }],
    ["reused", { ...EMPTY, reused: ["a"] }],
  ] as [string, OrphanRisks][])("правка с риском %s спрашивает", (_name, risks) => {
    expect(noRisks(risks)).toBe(false);
    expect(needsConfirmation("edit", risks, null)).toBe(true);
  });

  test("подтверждение выводится из рисков, найденных orphanRisks, без других данных", () => {
    const initial = [text("u1", "x"), text("u2", "y")];
    const risks = orphanRisks(initial, [text("u2", "x")]);
    expect(needsConfirmation("edit", risks, null)).toBe(true);
  });

  test("чистая правка схемы через orphanRisks не требует подтверждения", () => {
    const initial = [text("u1", "room")];
    const risks = orphanRisks(initial, [{ ...text("u1", "room"), required: true }, text("u2", "floor")]);
    expect(needsConfirmation("edit", risks, prefixChange("edit", "TS", "TS"))).toBe(false);
  });
});
