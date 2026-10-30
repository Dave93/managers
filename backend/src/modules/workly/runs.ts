// Журнал прогонов Workly, построение плана в фоне, применение и ночной автопрогон
// (разделы 5.3, 5.5 и 5.9 спеки).
//
// Прогон: startRun вставляет строку running (по одной на организацию и вид, это
// охраняет частичный уникальный индекс), задача очереди вызывает executeRun, он
// обходит Workly и сохраняет план со статусом planned. applyRun применяет план:
// каждый пункт отдельно и только если сотрудник не изменился с момента построения.
// Ничего сверх перечисленного в плане applyRun не меняет.
import type { DrizzleDB } from "@backend/lib/db";
import { employees, staff_roles, terminals, workly_sync_runs } from "backend/drizzle/schema";
import { and, eq, ne, sql } from "drizzle-orm";
import type Redis from "ioredis";
import type { DbLike } from "../kpi/access";
import { UUID_RE } from "../kpi/employees";
import { KpiError } from "../kpi/errors";
import { iso } from "../kpi/iso";
import type { Period } from "../kpi/time";
import { structureFrom } from "../staff_roles/catalog";
import { clientFor, WorklyError, type WorklyClient } from "./client";
import { connKeyOf } from "./config";
import { checkGuards, type BlockReason, type GuardInput } from "./guards";
import { refreshLocations, terminalMap } from "./locations";
import { buildPlan, countsOf, type EmployeeFields, type OurEmployee, type PlanItem, type SyncPlan } from "./plan";
import type { ConnKey } from "./types";

export type RunKind = "employees" | "attendance";
export type RunClient = Pick<WorklyClient, "companyId" | "employees" | "dismissed" | "locations" | "t12" | "lateIn" | "absence">;
export interface RunRow {
  id: string;
  organization_id: string;
  kind: RunKind;
  trigger: "manual" | "schedule";
  status: "running" | "planned" | "applied" | "blocked" | "failed" | "rolled_back";
  block_reason: BlockReason | null;
  counts: Record<string, number | string>;
  period: string | null;
  plan: SyncPlan | null;
  error: string | null;
  created_at: string;
  applied_at: string | null;
}

type SkipReason = "excluded" | "stale" | "conflict";

// Строка running старше этого срока считается брошенной (воркер упал посреди обхода).
const STALE_AFTER = sql.raw("interval '15 minutes'");

// Ошибка прогона со своим кодом (не из клиента Workly): пишется в error как есть.
class RunFailed extends Error {
  constructor(public code: "empty_crawl" | "crawl_failed") {
    super(code);
  }
}

// Подключение организации по строке журнала. Подмена только для тестов: тестовые
// организации называются не как подключения, а настоящие имена в тестах не используются.
type ConnKeyResolver = (db: DbLike, organizationId: string) => Promise<ConnKey | null>;
let connKeyResolver: ConnKeyResolver | null = null;

export function setConnKeyResolver(f: ConnKeyResolver | null): void {
  connKeyResolver = f;
}

// Нарушение конкретного уникального индекса. drizzle 0.44 заворачивает ошибку pg в cause.
function violates(e: unknown, constraint: string): boolean {
  const x = e as { code?: unknown; constraint?: unknown; cause?: { code?: unknown; constraint?: unknown } } | null;
  const code = x?.code ?? x?.cause?.code;
  const name = x?.constraint ?? x?.cause?.constraint;
  return code === "23505" && name === constraint;
}

const runIs = (runId: string, status: RunRow["status"]) =>
  and(eq(workly_sync_runs.id, runId), eq(workly_sync_runs.status, status));

function toRow(r: typeof workly_sync_runs.$inferSelect): RunRow {
  return {
    id: r.id,
    organization_id: r.organization_id,
    kind: r.kind as RunKind,
    trigger: r.trigger as RunRow["trigger"],
    status: r.status as RunRow["status"],
    block_reason: (r.block_reason as BlockReason | null) ?? null,
    counts: (r.counts ?? {}) as Record<string, number | string>,
    period: r.period ?? null,
    plan: (r.plan as SyncPlan | null) ?? null,
    error: r.error ?? null,
    created_at: iso(r.created_at),
    applied_at: iso(r.applied_at),
  };
}

export async function startRun(
  db: DrizzleDB,
  org: { id: string; key: ConnKey },
  kind: RunKind,
  trigger: "manual" | "schedule",
  userId: string | null,
  period?: Period
): Promise<{ run_id: string }> {
  // Брошенную строку закрываем, иначе индекс не дал бы начать новый прогон никогда.
  await db
    .update(workly_sync_runs)
    .set({ status: "failed", error: "stale" })
    .where(
      and(
        eq(workly_sync_runs.organization_id, org.id),
        eq(workly_sync_runs.kind, kind),
        eq(workly_sync_runs.status, "running"),
        sql`${workly_sync_runs.created_at} < now() - ${STALE_AFTER}`
      )
    );
  try {
    const [row] = await db
      .insert(workly_sync_runs)
      .values({ organization_id: org.id, kind, trigger, status: "running", period: period ?? null, created_by: userId })
      .returning({ id: workly_sync_runs.id });
    return { run_id: row.id };
  } catch (e) {
    // Одновременность охраняет индекс, отдельной блокировки в Redis нет.
    if (violates(e, "workly_sync_runs_running_uq")) throw new KpiError(409, "run_in_progress");
    throw e;
  }
}

export async function getRun(db: DbLike, runId: string): Promise<RunRow> {
  if (!UUID_RE.test(runId)) throw new KpiError(404, "run_not_found");
  const [row] = await db.select().from(workly_sync_runs).where(eq(workly_sync_runs.id, runId)).limit(1);
  if (!row) throw new KpiError(404, "run_not_found");
  return toRow(row);
}

// Все наши сотрудники организации, активные и нет: неактивный может вернуться (reactivate),
// а связанный с уволенной записью нужен, чтобы не создать его заново.
async function loadOurs(db: DbLike, organizationId: string): Promise<OurEmployee[]> {
  return db
    .select({
      id: employees.id,
      first_name: employees.first_name,
      last_name: employees.last_name,
      position: employees.position,
      terminal_id: employees.terminal_id,
      active: employees.active,
      workly_id: employees.workly_id,
      workly_company_id: employees.workly_company_id,
      // Без табельного номера его смена в Workly никогда не дошла бы до нас.
      workly_tab_number: employees.workly_tab_number,
    })
    .from(employees)
    .innerJoin(terminals, eq(terminals.id, employees.terminal_id))
    .where(eq(terminals.organization_id, organizationId));
}

async function planEmployees(db: DrizzleDB, runId: string, organizationId: string, client: RunClient, companyId: number) {
  // Обходы строго по одному: параллельные вызовы одного клиента могут делить вход (см. client.ts).
  await refreshLocations(db, client, companyId, organizationId);
  const active = await client.employees();
  const fetched = new Set(active.map((w) => w.id)).size;
  // Пустой обход заведомо сбой (у обеих компаний сотни активных): плана по нему не строим.
  if (fetched === 0) throw new RunFailed("empty_crawl");
  const dismissed = await client.dismissed();

  const ours = await loadOurs(db, organizationId);
  const roles = await db.select().from(staff_roles);
  const plan = buildPlan({
    companyId,
    ours,
    active,
    dismissed,
    terminalByLocation: await terminalMap(db, companyId),
    structure: (title) => structureFrom(roles, { position: title }, false),
  });
  // Строку, которую успели закрыть как брошенную, обратно не открываем.
  await db
    .update(workly_sync_runs)
    .set({ status: "planned", plan, counts: countsOf(plan), active_fetched: fetched })
    .where(runIs(runId, "running"));
}

/**
 * Выполняет прогон по строке журнала (задача очереди). Строка не в статусе running —
 * ничего не делает. Любой сбой завершает прогон статусом failed с кодом: код WorklyError,
 * empty_crawl или crawl_failed. Текст исключения не пишется ни в строку, ни в лог.
 * Если не удалось записать и сам failed, пробрасывается исходная ошибка.
 */
export async function executeRun(
  db: DrizzleDB,
  redis: Redis,
  runId: string,
  clientOf: (key: ConnKey) => RunClient = (key) => clientFor(key, redis)
): Promise<void> {
  if (!UUID_RE.test(runId)) return;
  const [run] = await db.select().from(workly_sync_runs).where(eq(workly_sync_runs.id, runId)).limit(1);
  if (!run || run.status !== "running") return;

  try {
    const key = await (connKeyResolver ?? connKeyOf)(db, run.organization_id);
    if (!key) throw new WorklyError("not_configured", "Организация не подключена к Workly");
    const client = clientOf(key);
    const companyId = await client.companyId();
    await db.update(workly_sync_runs).set({ workly_company_id: companyId }).where(runIs(runId, "running"));

    if (run.kind === "employees") await planEmployees(db, runId, run.organization_id, client, companyId);
    // Ветка посещаемости появится вместе с runAttendance; до тех пор такой прогон — сбой.
    else throw new RunFailed("crawl_failed");
  } catch (e) {
    const code = e instanceof WorklyError || e instanceof RunFailed ? e.code : "crawl_failed";
    console.error(`workly: прогон ${runId} завершился ошибкой ${code}`);
    try {
      await db.update(workly_sync_runs).set({ status: "failed", error: code }).where(runIs(runId, "running"));
    } catch {
      console.error(`workly: прогон ${runId}: не удалось записать статус failed`);
      throw e;
    }
  }
}

// ---------- применение ----------

// Поля сотрудника, которые план вправе менять. Остальное в after (если появится) не пишется.
const WRITABLE: readonly (keyof EmployeeFields)[] = [
  "first_name",
  "last_name",
  "workly_company_id",
  "workly_id",
  "workly_tab_number",
  "position",
  "staff_role_id",
  "grade",
  "shift",
  "is_trainee",
  "terminal_id",
  "active",
];

function valuesOf(after: Partial<EmployeeFields>): Partial<EmployeeFields> {
  const out: Record<string, unknown> = {};
  for (const k of WRITABLE) if (k in after) out[k] = after[k] ?? null;
  // Пара (компания, сотрудник) пишется только целиком: строка с одной половиной
  // ушла бы из-под уникального индекса employees_workly_uq.
  const hasId = "workly_id" in out && out.workly_id !== null;
  const hasCompany = "workly_company_id" in out && out.workly_company_id !== null;
  if (("workly_id" in out) !== ("workly_company_id" in out) || hasId !== hasCompany) {
    throw new Error("workly: пункт плана пишет workly_id и workly_company_id не парой");
  }
  return out as Partial<EmployeeFields>;
}

const sameValue = (a: unknown, b: unknown) => (a ?? null) === (b ?? null);

async function terminalOfOrg(db: DbLike, terminalId: unknown, organizationId: string): Promise<boolean> {
  if (typeof terminalId !== "string" || !UUID_RE.test(terminalId)) return false;
  const [t] = await db
    .select({ id: terminals.id })
    .from(terminals)
    .where(and(eq(terminals.id, terminalId), eq(terminals.organization_id, organizationId)))
    .limit(1);
  return !!t;
}

// Один пункт внутри своей точки сохранения. null — пункт устарел, ничего не записано.
async function applyItem(db: DbLike, item: PlanItem, organizationId: string): Promise<{ createdId: string | null } | null> {
  const values = valuesOf(item.after);

  if (item.kind === "create") {
    const { first_name, last_name, terminal_id } = values;
    if (typeof first_name !== "string" || typeof last_name !== "string" || typeof terminal_id !== "string") {
      throw new Error("workly: пункт create без имени или филиала");
    }
    if (!(await terminalOfOrg(db, terminal_id, organizationId))) return null;
    const [row] = await db
      .insert(employees)
      .values({ ...values, first_name, last_name, terminal_id })
      .returning({ id: employees.id });
    return { createdId: row.id };
  }

  if (!item.employee_id || !item.before) throw new Error(`workly: пункт ${item.kind} без сотрудника или before`);
  // Сотрудник под замком до конца применения; ушедший в другую организацию считается изменившимся.
  const [cur] = await db
    .select({
      first_name: employees.first_name,
      last_name: employees.last_name,
      workly_company_id: employees.workly_company_id,
      workly_id: employees.workly_id,
      workly_tab_number: employees.workly_tab_number,
      position: employees.position,
      staff_role_id: employees.staff_role_id,
      grade: employees.grade,
      shift: employees.shift,
      is_trainee: employees.is_trainee,
      terminal_id: employees.terminal_id,
      active: employees.active,
    })
    .from(employees)
    .innerJoin(terminals, eq(terminals.id, employees.terminal_id))
    .where(and(eq(employees.id, item.employee_id), eq(terminals.organization_id, organizationId)))
    .limit(1)
    .for("update", { of: employees });
  if (!cur) return null;
  const current = cur as Record<string, unknown>;
  for (const [k, v] of Object.entries(item.before)) {
    // Поле, которого мы не знаем, сравнить нельзя: пункт пропускается.
    if (!(WRITABLE as readonly string[]).includes(k) || !sameValue(current[k], v)) return null;
  }
  if ("terminal_id" in values && !(await terminalOfOrg(db, values.terminal_id, organizationId))) return null;
  await db
    .update(employees)
    .set({ ...values, updated_at: sql`now()` })
    .where(eq(employees.id, item.employee_id));
  return { createdId: null };
}

/**
 * Применяет сохранённый план (только статус planned, иначе 409 run_not_planned).
 * Каждый пункт идёт в своей точке сохранения (вложенная транзакция): пункт применяется,
 * только если текущие значения полей из before совпадают с before (иначе stale);
 * занятый workly_id даёт conflict, остальные пункты продолжаются. Перенос сотрудника,
 * чья связь link/relink не применилась, пропускается с той же причиной. Строка журнала
 * заперта на всё время применения, и статус applied с plan.applied фиксируется одной
 * транзакцией с изменениями сотрудников: откат (Task 13) видит ровно то, что записано.
 */
export async function applyRun(
  db: DrizzleDB,
  runId: string,
  exclude: string[],
  _userId: string | null
): Promise<{ applied: number; skipped: { key: string; reason: SkipReason }[] }> {
  if (!UUID_RE.test(runId)) throw new KpiError(404, "run_not_found");
  return db.transaction(async (tx) => {
    const [run] = await tx
      .select()
      .from(workly_sync_runs)
      .where(eq(workly_sync_runs.id, runId))
      .limit(1)
      .for("update");
    if (!run) throw new KpiError(404, "run_not_found");
    if (run.status !== "planned" || run.kind !== "employees" || !run.plan) throw new KpiError(409, "run_not_planned");

    const plan = run.plan as SyncPlan;
    const excluded = new Set(exclude);
    const skipped: { key: string; reason: SkipReason }[] = [];
    const applied: string[] = [];
    const items: PlanItem[] = [...plan.items];
    // Связь по имени, которая не применилась (исключена, устарела, конфликт): её сотрудник
    // и причина. Перенос такого сотрудника держится на той же связи и пропускается с ней,
    // иначе человек уехал бы в филиал записи Workly, которую никто не подтвердил.
    const unlinked = new Map<string, SkipReason>();
    const skip = (item: PlanItem, reason: SkipReason) => {
      skipped.push({ key: item.key, reason });
      if ((item.kind === "link" || item.kind === "relink") && item.employee_id) unlinked.set(item.employee_id, reason);
    };

    // Переносы идут после всех остальных пунктов: к ним уже известна судьба связи.
    const order = items.map((_, k) => k).sort((a, b) => Number(items[a].kind === "move") - Number(items[b].kind === "move"));
    for (const k of order) {
      const item = items[k];
      if (excluded.has(item.key)) {
        skip(item, "excluded");
        continue;
      }
      const linkSkipped = item.kind === "move" && item.employee_id ? unlinked.get(item.employee_id) : undefined;
      if (linkSkipped) {
        skip(item, linkSkipped);
        continue;
      }
      let res: { createdId: string | null } | null;
      try {
        res = await tx.transaction((sp) => applyItem(sp, item, run.organization_id));
      } catch (e) {
        // Любая другая ошибка откатывает всё применение: прогон остаётся planned.
        if (!violates(e, "employees_workly_uq")) throw e;
        skip(item, "conflict");
        continue;
      }
      if (!res) {
        skip(item, "stale");
        continue;
      }
      applied.push(item.key);
      if (res.createdId) items[k] = { ...item, employee_id: res.createdId };
    }

    const next: SyncPlan = { ...plan, items, applied };
    await tx
      .update(workly_sync_runs)
      .set({ status: "applied", applied_at: sql`now()`, plan: next })
      .where(eq(workly_sync_runs.id, runId));
    return { applied: applied.length, skipped };
  });
}

// ---------- ночной прогон ----------

export async function hasAppliedRun(db: DbLike, organizationId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: workly_sync_runs.id })
    .from(workly_sync_runs)
    .where(
      and(
        eq(workly_sync_runs.organization_id, organizationId),
        eq(workly_sync_runs.kind, "employees"),
        eq(workly_sync_runs.status, "applied")
      )
    )
    .limit(1);
  return !!row;
}

// Вход предохранителей. null — какое-то из чисел не целое: это сбой, а не «можно применять».
async function guardInput(db: DrizzleDB, run: RunRow): Promise<GuardInput | null> {
  const [org] = await db
    .select({ n: sql<string>`count(*)` })
    .from(employees)
    .innerJoin(terminals, eq(terminals.id, employees.terminal_id))
    .where(and(eq(terminals.organization_id, run.organization_id), eq(employees.active, true)));
  const [self] = await db
    .select({ fetched: workly_sync_runs.active_fetched })
    .from(workly_sync_runs)
    .where(eq(workly_sync_runs.id, run.id));
  const [last] = await db
    .select({ fetched: workly_sync_runs.active_fetched })
    .from(workly_sync_runs)
    .where(
      and(
        eq(workly_sync_runs.organization_id, run.organization_id),
        eq(workly_sync_runs.kind, "employees"),
        eq(workly_sync_runs.status, "applied"),
        ne(workly_sync_runs.id, run.id)
      )
    )
    .orderBy(sql`${workly_sync_runs.applied_at} desc nulls last`, sql`${workly_sync_runs.created_at} desc`)
    .limit(1);

  const input: GuardInput = {
    deactivations: Number(run.counts.deactivate),
    creations: Number(run.counts.create),
    orgActive: Number(org?.n),
    activeFetched: Number(self?.fetched),
    lastApplied: last ? { activeFetched: Number(last.fetched) } : null,
  };
  const numbers = [input.deactivations, input.creations, input.orgActive, input.activeFetched];
  if (input.lastApplied) numbers.push(input.lastApplied.activeFetched);
  return numbers.every((n) => Number.isInteger(n)) ? input : null;
}

/**
 * Ночная сверка сотрудников: строит план и применяет его сам, только если план
 * проходит предохранители (checkGuards); иначе план сохраняется со статусом blocked.
 */
export async function syncAuto(
  db: DrizzleDB,
  redis: Redis,
  org: { id: string; key: ConnKey },
  clientOf?: (key: ConnKey) => RunClient
): Promise<RunRow> {
  const { run_id } = await startRun(db, org, "employees", "schedule", null);
  await executeRun(db, redis, run_id, clientOf);
  const run = await getRun(db, run_id);
  if (run.status !== "planned") return run;

  const input = await guardInput(db, run);
  if (!input) {
    console.error(`workly: прогон ${run_id}: счётчики для предохранителей не целые, прогон не применён`);
    await db.update(workly_sync_runs).set({ status: "failed", error: "crawl_failed" }).where(runIs(run_id, "planned"));
    return getRun(db, run_id);
  }
  const guard = checkGuards(input);
  if (!guard.ok) {
    await db.update(workly_sync_runs).set({ status: "blocked", block_reason: guard.reason }).where(runIs(run_id, "planned"));
    return getRun(db, run_id);
  }
  await applyRun(db, run_id, [], null);
  return getRun(db, run_id);
}

// ---------- ручная связь ----------

const TAB_MAX = 32; // employees.workly_tab_number — varchar(32)

/**
 * Связывает нашего сотрудника организации с записью Workly (экран HR, «связать вручную»).
 * workly_id компании уже у другого сотрудника — 409 workly_id_taken; сотрудник не этой
 * организации — 404 employee_not_found. Пара (компания, id) пишется только вместе.
 */
export async function linkManually(
  db: DrizzleDB,
  a: { organizationId: string; companyId: number; employeeId: string; worklyId: number; tabNumber: string },
  _userId: string | null
): Promise<void> {
  if (!UUID_RE.test(a.employeeId) || !UUID_RE.test(a.organizationId)) throw new KpiError(404, "employee_not_found");
  if (!Number.isInteger(a.companyId) || !Number.isInteger(a.worklyId)) throw new KpiError(422, "bad_workly_id");
  const tab = (a.tabNumber ?? "").trim() || null;
  if (tab !== null && tab.length > TAB_MAX) throw new KpiError(422, "bad_tab_number");

  const [own] = await db
    .select({ id: employees.id })
    .from(employees)
    .innerJoin(terminals, eq(terminals.id, employees.terminal_id))
    .where(and(eq(employees.id, a.employeeId), eq(terminals.organization_id, a.organizationId)))
    .limit(1);
  if (!own) throw new KpiError(404, "employee_not_found");

  const [taken] = await db
    .select({ id: employees.id })
    .from(employees)
    .where(
      and(
        eq(employees.workly_company_id, a.companyId),
        eq(employees.workly_id, a.worklyId),
        ne(employees.id, a.employeeId)
      )
    )
    .limit(1);
  if (taken) throw new KpiError(409, "workly_id_taken");

  try {
    await db
      .update(employees)
      .set({ workly_company_id: a.companyId, workly_id: a.worklyId, workly_tab_number: tab, updated_at: sql`now()` })
      .where(eq(employees.id, a.employeeId));
  } catch (e) {
    // Гонка: тот же id заняли между проверкой и записью.
    if (violates(e, "employees_workly_uq")) throw new KpiError(409, "workly_id_taken");
    throw e;
  }
}
