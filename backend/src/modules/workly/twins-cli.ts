import { drizzleDb } from "../../lib/db";
import { employee_twins, employees, terminals } from "backend/drizzle/schema";
import { and, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getWorklyQueue } from "./queue";
import { syncTwins } from "./twins";

// Утилита оператора для двойников между компаниями Workly (см. twins.ts). Запуск из backend/:
//   bun run src/modules/workly/twins-cli.ts list                  найденные пары (с именами, только на сервере)
//   bun run src/modules/workly/twins-cli.ts block <id пары>       разорвать ошибочную пару: задача её не тронет и не создаст заново
//   bun run src/modules/workly/twins-cli.ts unblock <id пары>     вернуть разорванную пару (дальше решает ночной пересчёт)
//   bun run src/modules/workly/twins-cli.ts sync                  пересчитать пары сейчас (обход двух компаний, около минуты)
// Присутствие в записи двойника закрывает прогул в другой записи на чтении, kpi_attendance не меняется,
// поэтому разрыв пары возвращает прежние числа сразу, без пересинхронизации посещаемости.

const [cmd, arg] = process.argv.slice(2);

async function list() {
  const A = alias(employees, "ea");
  const B = alias(employees, "eb");
  const TA = alias(terminals, "ta");
  const TB = alias(terminals, "tb");
  const rows = await drizzleDb
    .select({
      id: employee_twins.id,
      rule: employee_twins.rule,
      blocked: employee_twins.blocked,
      a: A.last_name,
      a2: A.first_name,
      ta: TA.name,
      b: B.last_name,
      b2: B.first_name,
      tb: TB.name,
    })
    .from(employee_twins)
    .innerJoin(A, eq(A.id, employee_twins.employee_a))
    .innerJoin(B, eq(B.id, employee_twins.employee_b))
    .leftJoin(TA, eq(TA.id, A.terminal_id))
    .leftJoin(TB, eq(TB.id, B.terminal_id));
  for (const r of rows) {
    console.log(`${r.id}  ${r.blocked ? "РАЗОРВАНА" : "действует"}  ${r.rule}  ${r.a} ${r.a2} (${r.ta}) = ${r.b} ${r.b2} (${r.tb})`);
  }
  console.log(`всего ${rows.length}, разорвано ${rows.filter((r) => r.blocked).length}`);
}

async function setBlocked(id: string | undefined, blocked: boolean) {
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    console.error("нужен id пары (первая колонка list)");
    process.exit(1);
  }
  const res = await drizzleDb
    .update(employee_twins)
    .set({ blocked })
    .where(and(eq(employee_twins.id, id), eq(employee_twins.blocked, !blocked)))
    .returning({ id: employee_twins.id });
  console.log(res.length ? `${blocked ? "разорвана" : "возвращена"} пара ${id}` : "пара не найдена или уже в этом состоянии");
}

if (cmd === "list") await list();
else if (cmd === "block") await setBlocked(arg, true);
else if (cmd === "unblock") await setBlocked(arg, false);
else if (cmd === "sync") {
  const queue = getWorklyQueue();
  const redis = (await queue.client) as unknown as Parameters<typeof syncTwins>[1];
  console.log(JSON.stringify(await syncTwins(drizzleDb, redis)));
  await queue.close();
} else {
  console.error("команды: list | block <id> | unblock <id> | sync");
  process.exit(1);
}
process.exit(0);
