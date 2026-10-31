// Журнал прогонов Workly, построение плана в фоне, применение, откат и ночной автопрогон
// (разделы 5.3, 5.5 и 5.9 спеки).
//
// Прогон: startRun вставляет строку running (по одной на организацию и вид, это
// охраняет частичный уникальный индекс), задача очереди вызывает executeRun, он
// обходит Workly и сохраняет план со статусом planned. applyRun применяет план:
// каждый пункт отдельно и только если сотрудник не изменился с момента построения.
// Ничего сверх перечисленного в плане applyRun не меняет.
//
// Посещаемость (kind attendance) плана не строит: executeRun сразу пишет импорт месяца
// (runAttendance) и закрывает строку статусом applied со счётчиками в counts.
//
// Коды в workly_sync_runs.error: client_invalid, force_update, auth_failed, http_error,
// not_configured, company_mismatch (WorklyError; последний — учётка другой компании Workly),
// crawl_failed, empty_crawl (executeRun; у посещаемости — пустой
// T12 или ни одного дня к записи), stale (startRun),
// apply_failed (syncAuto: ночное применение упало), period_closed и period_not_started
// (посещаемость: месяц закрыт или в нём нет прошедших дней), enqueue_failed (маршрут
// создал строку, но задача не встала в очередь; см. routes.ts).
import type { DrizzleDB } from "@backend/lib/db";
import { employees, staff_roles, terminals, workly_sync_runs } from "backend/drizzle/schema";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import type Redis from "ioredis";
import type { DbLike } from "../kpi/access";
import { UUID_RE } from "../kpi/employees";
import { KpiError } from "../kpi/errors";
import { iso } from "../kpi/iso";
import { isPeriod, type Period } from "../kpi/time";
import { structureFrom } from "../staff_roles/catalog";
import { runAttendance } from "./attendance";
import { assertCompany, clientFor, WorklyError, type WorklyClient } from "./client";
import { connKeyOf } from "./config";
import { checkGuards, type BlockReason, type GuardInput } from "./guards";
import { refreshLocations, terminalMap } from "./locations";
import {
  buildPlan,
  countsOf,
  type EmployeeFields,
  type OurEmployee,
  type PlanItem,
  type RollbackResult,
  type SyncPlan,
} from "./plan";
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

// Отказы посещаемости (KpiError из runAttendance), которые журнал хранит своим кодом; прочие KpiError — crawl_failed.
const ATTENDANCE_CODES: ReadonlySet<string> = new Set(["period_closed", "period_not_started", "empty_crawl"]);

function errorCode(e: unknown): string {
  if (e instanceof WorklyError || e instanceof RunFailed) return e.code;
  if (e instanceof KpiError && ATTENDANCE_CODES.has(e.code)) return e.code;
  return "crawl_failed";
}

// Подключение организации по строке журнала. Подмена только для тестов: тестовые
// организации называются не как подключения, а настоящие имена в тестах не используются.
type ConnKeyResolver = (db: DbLike, organizationId: string) => Promise<ConnKey | null>;
let connKeyResolver: ConnKeyResolver | null = null;

export function setConnKeyResolver(f: ConnKeyResolver | null): void {
  connKeyResolver = f;
}

// Подключение организации с учётом подмены: им пользуются executeRun и маршруты.
export function resolveConnKey(db: DbLike, organizationId: string): Promise<ConnKey | null> {
  return (connKeyResolver ?? connKeyOf)(db, organizationId);
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
      // Структура должности нужна для before: пункт хранит всё, что меняет.
      staff_role_id: employees.staff_role_id,
      grade: employees.grade,
      shift: employees.shift,
      is_trainee: employees.is_trainee,
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

// Посещаемость: месяц и автор — из строки журнала; локации и план не участвуют.
async function syncAttendance(
  db: DrizzleDB,
  run: typeof workly_sync_runs.$inferSelect,
  client: RunClient,
  companyId: number
): Promise<void> {
  if (!isPeriod(run.period)) throw new RunFailed("crawl_failed");
  const res = await runAttendance(db, client, { id: run.organization_id }, run.period, run.created_by);
  await db
    .update(workly_sync_runs)
    .set({
      status: "applied",
      applied_at: sql`now()`,
      counts: { days: res.days, unknown: res.unknown, carried: res.carried, import_id: res.import_id },
      workly_company_id: companyId,
    })
    .where(runIs(run.id, "running"));
}

/**
 * Выполняет прогон по строке журнала (задача очереди). Строка не в статусе running —
 * ничего не делает. Сотрудники: план со статусом planned. Посещаемость: импорт месяца
 * и статус applied. Компания учётки сверяется с подключением сразу после companyId():
 * чужая компания даёт failed/company_mismatch, и ничего не записывается (даже workly_company_id).
 * Любой сбой завершает прогон статусом failed с кодом: код WorklyError,
 * empty_crawl, period_closed, period_not_started или crawl_failed. Текст исключения
 * не пишется ни в строку, ни в лог. Если не удалось записать и сам failed,
 * пробрасывается исходная ошибка.
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
    const key = await resolveConnKey(db, run.organization_id);
    if (!key) throw new WorklyError("not_configured", "Организация не подключена к Workly");
    const client = clientOf(key);
    const companyId = await client.companyId();
    // Учётка чужой компании: прогон падает до карты локаций, обходов и любой записи (спека 5.1).
    assertCompany(key, companyId);
    await db.update(workly_sync_runs).set({ workly_company_id: companyId }).where(runIs(runId, "running"));

    if (run.kind === "employees") await planEmployees(db, runId, run.organization_id, client, companyId);
    else if (run.kind === "attendance") await syncAttendance(db, run, client, companyId);
    else throw new RunFailed("crawl_failed");
  } catch (e) {
    const code = errorCode(e);
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

// Текущие значения всех полей, которые пишет план, у сотрудника этой организации (строка под
// замком до конца транзакции). null — сотрудника нет или он в филиале другой организации.
async function lockOwnEmployee(db: DbLike, employeeId: string, organizationId: string): Promise<Record<string, unknown> | null> {
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
    .where(and(eq(employees.id, employeeId), eq(terminals.organization_id, organizationId)))
    .limit(1)
    .for("update", { of: employees });
  return cur ?? null;
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

  // Без сотрудника или без полного before пункт не применяется никогда: проверять нечего,
  // а откат не узнал бы, что вернуть. before обязан хранить каждое поле из after.
  const before = item.before;
  if (!item.employee_id || !before || Object.keys(before).length === 0) return null;
  if (Object.keys(item.after).some((k) => !(k in before))) return null;
  // Сотрудник под замком до конца применения; ушедший в другую организацию считается изменившимся.
  const current = await lockOwnEmployee(db, item.employee_id, organizationId);
  if (!current) return null;
  for (const [k, v] of Object.entries(before)) {
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
 * План, у которого есть более новый прогон той же организации и вида в статусе planned,
 * applied, blocked или rolled_back, устарел целиком: 409 run_superseded, нужно построить
 * план заново. Откат более нового прогона не делает старый план снова применимым (R29).
 * Каждый пункт идёт в своей точке сохранения (вложенная транзакция): пункт применяется,
 * только если текущие значения полей из before совпадают с before (иначе stale);
 * занятый workly_id даёт conflict, остальные пункты продолжаются. Перенос сотрудника,
 * чья связь link/relink не применилась, пропускается с той же причиной. Строка журнала
 * заперта на всё время применения, и статус applied с plan.applied и plan.skipped
 * фиксируется одной транзакцией с изменениями сотрудников: откат (Task 13) видит ровно
 * то, что записано. Любая ошибка, кроме конфликта, откатывает всё, прогон остаётся planned.
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

    // Более новый план видел более свежий Workly: например, увольнение, которое потом
    // отменили. Старый план по нему деактивировал бы живого человека, хотя его before
    // ещё совпадает с базой. «Новее» — по created_at в базе, а не по часам процесса.
    // Откатанный более новый прогон тоже вытесняет: его данные Workly свежее этого плана.
    const [newer] = await tx
      .select({ id: workly_sync_runs.id })
      .from(workly_sync_runs)
      .where(
        and(
          eq(workly_sync_runs.organization_id, run.organization_id),
          eq(workly_sync_runs.kind, run.kind),
          inArray(workly_sync_runs.status, ["planned", "applied", "blocked", "rolled_back"]),
          sql`${workly_sync_runs.created_at} > (SELECT r.created_at FROM workly_sync_runs r WHERE r.id = ${run.id})`
        )
      )
      .limit(1);
    if (newer) throw new KpiError(409, "run_superseded");

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

    // Пропущенные с причинами остаются в журнале: отчёт о прогоне их показывает (спека 5.5).
    const next: SyncPlan = { ...plan, items, applied, skipped };
    await tx
      .update(workly_sync_runs)
      .set({ status: "applied", applied_at: sql`now()`, plan: next })
      .where(eq(workly_sync_runs.id, runId));
    return { applied: applied.length, skipped };
  });
}

// ---------- откат ----------

// Колонка другой таблицы, которой та ссылается на сотрудника.
interface RefColumn {
  table: string;
  column: string;
  uuid: boolean;
}

/**
 * Колонки, которыми базовые таблицы схемы public ссылаются на сотрудника: employee_id и
 * *_employee_id (например, passport_signoffs.actor_employee_id). Список берётся из
 * information_schema, а не из внешних ключей: на employees их почти нет (medical_exams, KPI
 * ссылаются без них), и новая таблица видна без правки кода. Представления не берутся:
 * представление над самой employees «ссылалось» бы на каждого.
 */
async function referenceColumns(db: DbLike): Promise<RefColumn[]> {
  const res = await db.execute(sql`
    SELECT c.table_name, c.column_name, c.data_type
    FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
      AND c.table_name <> 'employees'
      AND c.column_name ~ '(^|_)employee_id$'
    ORDER BY c.table_name, c.column_name`);
  return (res.rows as { table_name: string; column_name: string; data_type: string }[]).map((r) => ({
    table: r.table_name,
    column: r.column_name,
    uuid: r.data_type === "uuid",
  }));
}

// Есть ли хоть одна строка, которая ссылается на сотрудника. Имена таблиц и колонок — только
// через sql.identifier. Колонка не uuid сравнивается как текст: запрос не падает на чужом типе.
async function isReferenced(db: DbLike, refs: RefColumn[], employeeId: string): Promise<boolean> {
  if (refs.length === 0) return false;
  const checks = refs.map((r) => {
    const col = sql.identifier(r.column);
    const cond = r.uuid ? sql`${col} = ${employeeId}::uuid` : sql`${col}::text = ${employeeId}`;
    return sql`EXISTS (SELECT 1 FROM ${sql.identifier("public")}.${sql.identifier(r.table)} WHERE ${cond})`;
  });
  const res = await db.execute(sql`SELECT (${sql.join(checks, sql` OR `)}) AS found`);
  return (res.rows[0] as { found: boolean } | undefined)?.found === true;
}

// Без этих полей в after пункт create не узнать: имя, филиал и пара Workly обязаны быть.
const CREATED_IDENTITY: readonly (keyof EmployeeFields)[] = ["first_name", "last_name", "terminal_id", "workly_company_id", "workly_id"];

/**
 * Непредвиденная ошибка пункта при откате (не конфликт пары): весь откат отменён. Несёт только
 * ключ пункта (вид:id), без исходного сообщения: в нём бывают параметры запроса, то есть имена.
 */
export class RollbackItemError extends Error {
  constructor(public key: string) {
    super("rollback_item_failed");
    // По имени CLI узнаёт ошибку, не импортируя runs.ts.
    this.name = "RollbackItemError";
  }
}

type Undone = "restored" | "deleted" | "deactivated";

// Откат одного пункта внутри своей точки сохранения. null — пункт изменился после применения
// (или трогать его нельзя), ничего не записано.
async function undoItem(db: DbLike, item: PlanItem, organizationId: string, refs: RefColumn[]): Promise<Undone | null> {
  if (!item.employee_id) return null;
  // Под замком и только в своей организации: сотрудник в чужом филиале считается изменившимся.
  const current = await lockOwnEmployee(db, item.employee_id, organizationId);
  if (!current) return null;

  if (item.kind === "create") {
    // Созданный удаляется или выключается, только если с тех пор не менялось ни одно поле,
    // которое записал прогон: должность, табельный, роль, active и прочие. Правка прогона N+1
    // или HR делает пункт changed_since, и сотрудник остаётся как есть.
    if (CREATED_IDENTITY.some((k) => !(k in item.after))) return null;
    for (const [k, v] of Object.entries(item.after)) {
      if (!(WRITABLE as readonly string[]).includes(k) || !sameValue(current[k], v)) return null;
    }
    // Удаление оставило бы сирот: на кого есть ссылки, того только выключаем.
    if (await isReferenced(db, refs, item.employee_id)) {
      await db.update(employees).set({ active: false, updated_at: sql`now()` }).where(eq(employees.id, item.employee_id));
      return "deactivated";
    }
    await db.delete(employees).where(eq(employees.id, item.employee_id));
    return "deleted";
  }

  const before = item.before;
  const changedKeys = Object.keys(item.after) as (keyof EmployeeFields)[];
  if (!before || changedKeys.length === 0 || changedKeys.some((k) => !(k in before))) return null;
  // После применения у сотрудника ровно {...before, ...after}: поля из after такие, как их записал
  // прогон, а закреплённые только в before (пара Workly у update, move, reactivate) прежние.
  // Любое расхождение значит, что поле с тех пор менял кто-то другой (прогон N+1, HR): не трогаем.
  for (const [k, v] of Object.entries({ ...before, ...item.after })) {
    if (!(WRITABLE as readonly string[]).includes(k) || !sameValue(current[k], v)) return null;
  }
  // Возвращаются только поля, которые прогон менял; закреплённые и так равны before.
  const restore: Partial<EmployeeFields> = {};
  for (const k of changedKeys) Object.assign(restore, { [k]: before[k] ?? null });
  const values = valuesOf(restore);
  if ("terminal_id" in values && !(await terminalOfOrg(db, values.terminal_id, organizationId))) return null;
  await db
    .update(employees)
    .set({ ...values, updated_at: sql`now()` })
    .where(eq(employees.id, item.employee_id));
  return "restored";
}

/**
 * Откатывает применённый прогон сверки сотрудников (только статус applied и вид employees,
 * иначе 409 run_not_applied; прогоны посещаемости этим не откатываются). Трогает только
 * пункты из plan.applied, в обратном порядке применения (перенос раньше связи, к которой он
 * относится), каждый в своей точке сохранения. Пункт возвращается к before, только если
 * сотрудник с тех пор не менялся (иначе skipped с changed_since: откат прогона N не затирает
 * прогон N+1 и правки HR). Созданного прогоном сотрудника удаляет, если на него ничего не
 * ссылается, иначе выключает. Строка журнала заперта на всё время отката; статус rolled_back
 * и итог в plan.rolled_back пишутся той же транзакцией. Прежняя пара Workly, уже занятая
 * другим сотрудником, даёт changed_since; любая другая ошибка пункта откатывает весь откат
 * (RollbackItemError с ключом пункта), прогон остаётся applied.
 */
export async function rollbackRun(db: DrizzleDB, runId: string): Promise<RollbackResult> {
  if (!UUID_RE.test(runId)) throw new KpiError(404, "run_not_found");
  return db.transaction(async (tx) => {
    const [run] = await tx
      .select()
      .from(workly_sync_runs)
      .where(eq(workly_sync_runs.id, runId))
      .limit(1)
      .for("update");
    if (!run) throw new KpiError(404, "run_not_found");
    const plan = run.plan as SyncPlan | null;
    // Без списка применённых неизвестно, что откатывать: такой прогон не откатываем вовсе.
    if (run.status !== "applied" || run.kind !== "employees" || !plan || !Array.isArray(plan.applied)) {
      throw new KpiError(409, "run_not_applied");
    }

    const refs = await referenceColumns(tx);
    const byKey = new Map(plan.items.map((it) => [it.key, it]));
    const out: RollbackResult = { restored: 0, deleted: 0, deactivated: 0, skipped: [] };
    const seen = new Set<string>();
    for (const key of [...plan.applied].reverse()) {
      if (seen.has(key)) continue;
      seen.add(key);
      const item = byKey.get(key);
      let res: Undone | null = null;
      if (item) {
        try {
          res = await tx.transaction((sp) => undoItem(sp, item, run.organization_id, refs));
        } catch (e) {
          // Прежнюю пару Workly занял другой сотрудник: вернуть её нельзя, пункт изменился.
          // Любая другая ошибка отменяет весь откат; наружу уходит только ключ пункта.
          if (!violates(e, "employees_workly_uq")) throw new RollbackItemError(key);
        }
      }
      if (res) out[res]++;
      else out.skipped.push({ key, reason: "changed_since" });
    }

    const next: SyncPlan = { ...plan, rolled_back: out };
    await tx.update(workly_sync_runs).set({ status: "rolled_back", plan: next }).where(eq(workly_sync_runs.id, runId));
    return out;
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
 * Сбой самого применения — тревога: строка уходит в failed с кодом apply_failed
 * (applyRun уже откатил всё). План, который успели применить или вытеснить, не трогается.
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
  try {
    await applyRun(db, run_id, [], null);
  } catch (e) {
    // Применили раньше нас или план вытеснен более новым: строку не трогаем.
    if (e instanceof KpiError && (e.code === "run_not_planned" || e.code === "run_superseded")) return getRun(db, run_id);
    // Иначе без тревоги прогон навсегда остался бы planned. Текст ошибки не сохраняем и не логируем.
    console.error(`workly: прогон ${run_id} завершился ошибкой apply_failed`);
    try {
      await db.update(workly_sync_runs).set({ status: "failed", error: "apply_failed" }).where(runIs(run_id, "planned"));
    } catch {
      console.error(`workly: прогон ${run_id}: не удалось записать статус failed`);
      throw e;
    }
  }
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
