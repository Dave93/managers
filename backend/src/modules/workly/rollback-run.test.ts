import { describe, expect, it } from "bun:test";
import { KpiError } from "../kpi/errors";
import { errorLine, parseRollbackArgs, resultLines } from "./rollback-run";

// Чистые части CLI отката: разбор аргументов и строки вывода. Процесс не запускается, база не нужна.
describe("workly: CLI отката прогона", () => {
  const id = "0b5f4c2e-8a51-4c7e-9a43-2f1d6c3b7e90";

  it("ровно один аргумент-uuid даёт runId (в нижнем регистре, без пробелов по краям)", () => {
    expect(parseRollbackArgs([id])).toEqual({ runId: id });
    expect(parseRollbackArgs([` ${id.toUpperCase()} `])).toEqual({ runId: id });
  });

  it("без аргумента или с лишними — usage", () => {
    expect(parseRollbackArgs([])).toEqual({ error: "usage" });
    expect(parseRollbackArgs([id, id])).toEqual({ error: "usage" });
  });

  it("не uuid — bad_run_id", () => {
    expect(parseRollbackArgs(["123"])).toEqual({ error: "bad_run_id" });
    expect(parseRollbackArgs([""])).toEqual({ error: "bad_run_id" });
    expect(parseRollbackArgs([`${id}; drop table employees`])).toEqual({ error: "bad_run_id" });
  });

  it("итог: одна строка с четырьмя числами и строка на каждый пропущенный пункт", () => {
    expect(
      resultLines({
        restored: 3,
        deleted: 1,
        deactivated: 2,
        skipped: [
          { key: "move:e1", reason: "changed_since" },
          { key: "create:w5", reason: "changed_since" },
        ],
      })
    ).toEqual(["restored=3 deleted=1 deactivated=2 skipped=2", "skipped move:e1 changed_since", "skipped create:w5 changed_since"]);
    expect(resultLines({ restored: 0, deleted: 0, deactivated: 0, skipped: [] })).toEqual([
      "restored=0 deleted=0 deactivated=0 skipped=0",
    ]);
  });

  it("ошибка: у KpiError только код, у прочих общий код без текста исключения", () => {
    expect(errorLine(new KpiError(409, "run_not_applied"))).toBe("error run_not_applied");
    expect(errorLine(new KpiError(404, "run_not_found", { secret: "x" }))).toBe("error run_not_found");
    const line = errorLine(new Error('password authentication failed for user "postgres" secret-xyz'));
    expect(line).toBe("error rollback_failed");
    expect(line).not.toContain("secret-xyz");
    expect(errorLine("строка")).toBe("error rollback_failed");
  });
});
