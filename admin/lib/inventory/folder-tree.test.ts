import { describe, expect, test } from "bun:test";
import { buildFolderTree } from "./folder-tree";

describe("buildFolderTree", () => {
  test("вложенность, накопленные productIds, пустые ветки отброшены, товары без папки", () => {
    const tree = buildFolderTree({
      groups: [
        { id: "root", name: "Склад", parent_id: null },
        { id: "meat", name: "Мясо", parent_id: "root" },
        { id: "empty", name: "Пусто", parent_id: "root" },
        { id: "orphan", name: "Сирота", parent_id: "missing" },
      ],
      products: [
        { id: "p1", name: "Говядина", unit_name: "кг", parent_id: "meat" },
        { id: "p2", name: "Соль", unit_name: "кг", parent_id: null },
        { id: "p3", name: "Перец", unit_name: "кг", parent_id: "orphan" },
      ],
    });
    const names = tree.map((n) => n.name);
    expect(names).toEqual(["Без группы", "Сирота", "Склад"]);
    const sklad = tree.find((n) => n.id === "root")!;
    expect(sklad.children.map((c) => c.id)).toEqual(["meat"]);
    expect(sklad.productIds).toEqual(["p1"]);
    expect(tree.find((n) => n.id === "__none__")!.productIds).toEqual(["p2"]);
    expect(tree.find((n) => n.id === "orphan")!.productIds).toEqual(["p3"]);
  });
});
