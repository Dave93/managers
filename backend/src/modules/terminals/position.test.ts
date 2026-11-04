import { describe, expect, it } from "bun:test";
import { ROLE_CODE_BY_PARSE_NAME, SEED_ROLES, composePosition, renameConflicts } from "../staff_roles/catalog";
import { parsePosition } from "./position";

describe("parsePosition: техничка", () => {
  it.each(["Техничка", "ТЕХНИЧКА", "Техничка зала", "техничка (мойка)", "Техничка 2 разряд день"])("«%s» → cleaner", (p) => {
    expect(ROLE_CODE_BY_PARSE_NAME[parsePosition(p).role]).toBe("cleaner");
    expect(parsePosition(p).group).toBe("other");
  });
  it("зал и мойка остались прежними", () => {
    expect(ROLE_CODE_BY_PARSE_NAME[parsePosition("Работник зала").role]).toBe("hall_worker");
    expect(ROLE_CODE_BY_PARSE_NAME[parsePosition("Мойка").role]).toBe("kitchen_worker");
  });
  it("роль есть в каталоге и собранная строка разбирается обратно", () => {
    const r = SEED_ROLES.find((x) => x.code === "cleaner")!;
    expect(r.name_ru).toBe("Техничка");
    expect(ROLE_CODE_BY_PARSE_NAME[parsePosition(composePosition(r.name_ru, 2, "day")).role]).toBe("cleaner");
    expect(renameConflicts("cleaner", r.name_ru)).toEqual([]);
  });
});
