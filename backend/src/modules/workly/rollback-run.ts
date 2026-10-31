// Откат применённого прогона сверки сотрудников Workly (раздел 5.5 спеки). Запуск из backend/:
//   bun run src/modules/workly/rollback-run.ts <run_id>
// Печатает «restored=… deleted=… deactivated=… skipped=…» и по строке на каждый пропущенный пункт.
// Ошибка — одна строка «error <код>» и код выхода 1. Текст исключения не печатается никогда:
// в нём бывают параметры запроса (имена сотрудников) и строка подключения.
// Вся логика в rollbackRun (runs.ts); здесь только аргументы и вывод.
import { UUID_RE } from "../kpi/employees";
import { KpiError } from "../kpi/errors";
import type { RollbackResult } from "./plan";

const USAGE = "usage: bun run src/modules/workly/rollback-run.ts <run_id>";

// Аргументы после имени скрипта: ровно один id прогона.
export function parseRollbackArgs(argv: string[]): { runId: string } | { error: "usage" | "bad_run_id" } {
  if (argv.length !== 1) return { error: "usage" };
  const id = (argv[0] ?? "").trim();
  if (!UUID_RE.test(id)) return { error: "bad_run_id" };
  return { runId: id.toLowerCase() };
}

export function resultLines(r: RollbackResult): string[] {
  return [
    `restored=${r.restored} deleted=${r.deleted} deactivated=${r.deactivated} skipped=${r.skipped.length}`,
    ...r.skipped.map((s) => `skipped ${s.key} ${s.reason}`),
  ];
}

// Только код: у KpiError он свой, у прочих ошибок общий.
export function errorLine(e: unknown): string {
  return `error ${e instanceof KpiError ? e.code : "rollback_failed"}`;
}

async function main(): Promise<void> {
  const args = parseRollbackArgs(process.argv.slice(2));
  if ("error" in args) {
    console.error(args.error === "usage" ? USAGE : `error ${args.error}`);
    process.exit(1);
  }
  try {
    // База и runs.ts подгружаются только при запуске: тест чистых функций выше их не трогает.
    // Импорт внутри try: сбой загрузки модуля тоже печатается одним кодом, без текста.
    const { drizzleDb } = await import("../../lib/db");
    const { rollbackRun } = await import("./runs");
    for (const line of resultLines(await rollbackRun(drizzleDb, args.runId))) console.log(line);
  } catch (e) {
    console.error(errorLine(e));
    process.exit(1);
  }
  process.exit(0);
}

if (import.meta.main) {
  main().catch(() => {
    console.error("error rollback_failed");
    process.exit(1);
  });
}
