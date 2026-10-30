import type { StructuredPosition } from "../staff_roles/catalog";
import { nameKey, worklyNameKeys } from "./names";
import type { WorklyDismissed, WorklyEmployee } from "./types";

// План сверки сотрудников с Workly: чистая функция от списков Workly и наших
// сотрудников одной организации. Ни базы, ни сети: план строится, показывается
// человеку и только потом применяется (см. раздел 5.3 спеки).
//
// Главное свойство: план никого не деактивирует по отсутствию. Деактивация
// требует положительного свидетельства из списка уволенных, а всё сомнительное
// (пустой или короткий обход, тёзки, чужая связь) уходит в отчёт и не меняет данных.

export interface OurEmployee {
  id: string;
  first_name: string;
  last_name: string;
  position: string | null;
  terminal_id: string;
  active: boolean;
  workly_id: number | null;
  workly_company_id: number | null;
  /**
   * Табельный номер из Workly, как он записан у нас. Необязательное: если загрузчик
   * поле не передал (undefined), табельный номер не сравнивается и update из-за него
   * не создаётся. null означает «у нас пусто».
   */
  workly_tab_number?: string | null;
  /**
   * Структура должности, как она записана у нас. Нужна только для before: пункт
   * хранит текущие значения всего, что меняет. undefined (загрузчик поле не передал)
   * пишется в before как null: при расхождении с базой пункт устареет, а не перезапишет.
   */
  staff_role_id?: string | null;
  grade?: number | null;
  shift?: string | null;
  is_trainee?: boolean | null;
}

export interface EmployeeFields {
  first_name: string;
  last_name: string;
  workly_company_id: number | null;
  workly_id: number | null;
  workly_tab_number: string | null;
  position: string | null;
  staff_role_id: string | null;
  grade: number | null;
  shift: "day" | "night" | null;
  is_trainee: boolean | null;
  terminal_id: string;
  active: boolean;
}

export type PlanKind = "link" | "relink" | "update" | "move" | "create" | "deactivate" | "reactivate";

export interface PlanItem {
  key: string;
  kind: PlanKind;
  employee_id: string | null;
  workly_id: number;
  label: string;
  before: Partial<EmployeeFields> | null;
  after: Partial<EmployeeFields>;
}

export interface PlanReport {
  ambiguous: { workly_id: number; label: string; employee_ids: string[] }[];
  not_found: { employee_id: string; label: string }[];
  no_branch: { workly_id: number; label: string }[];
}

export interface SyncPlan {
  items: PlanItem[];
  report: PlanReport;
  /**
   * Ключи применённых пунктов; пишет applyRun. Пропущенные (исключённые, устаревшие,
   * конфликтные) сюда не входят: откат прогона трогает только эти пункты.
   */
  applied?: string[];
  /** Пропущенные при применении пункты и причины; пишет applyRun вместе с applied. */
  skipped?: { key: string; reason: "excluded" | "stale" | "conflict" }[];
}

export interface PlanInput {
  companyId: number;
  ours: OurEmployee[];
  active: WorklyEmployee[];
  dismissed: WorklyDismissed[];
  terminalByLocation: ReadonlyMap<number, string | null>;
  structure: (title: string | null) => StructuredPosition;
}

// Наш сотрудник вместе с ключом имени. eligible: может стать кандидатом на связь,
// то есть не связан с Workly либо связан с записью из списка уволенных. Связанный
// с активной записью кандидатом не бывает (спека 5.3).
interface Emp {
  e: OurEmployee;
  key: string;
  eligible: boolean;
}

const fullName = (p: { first_name: string; last_name: string }): string =>
  `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim();

const normTab = (t: string | null | undefined): string | null => (t ?? "").trim() || null;

const itemKey = (kind: PlanKind, employeeId: string | null, worklyId: number): string =>
  `${kind}:${employeeId ?? "w" + worklyId}`;

/**
 * before пункта: текущее значение каждого поля, которое меняет after (откат вернёт ровно
 * их, а правка после построения плана сделает пункт устаревшим). undefined пишется как null.
 * pinLink дополнительно закрепляет пару Workly у сотрудника, уже связанного с активной записью.
 */
function beforeOf(e: OurEmployee, after: Partial<EmployeeFields>, pinLink: boolean): Partial<EmployeeFields> {
  const cur = e as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(after)) out[k] = cur[k] ?? null;
  if (pinLink) {
    out.workly_company_id = e.workly_company_id ?? null;
    out.workly_id = e.workly_id ?? null;
  }
  return out as Partial<EmployeeFields>;
}

function structFields(s: StructuredPosition): Partial<EmployeeFields> {
  return {
    position: s.position,
    staff_role_id: s.staff_role_id,
    grade: s.grade,
    shift: s.shift,
    is_trainee: s.is_trainee,
  };
}

// Минимальная система непересекающихся множеств: нужна, чтобы собрать группы записей
// Workly и наших сотрудников, связанных общим ключом имени.
function makeDsu(n: number) {
  const parent = Array.from({ length: n }, (_, k) => k);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!;
      x = parent[x]!;
    }
    return x;
  };
  const union = (a: number, b: number) => {
    parent[find(a)] = find(b);
  };
  return { find, union };
}

function pushIndex<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const list = m.get(k);
  if (list) list.push(v);
  else m.set(k, [v]);
}

export function buildPlan(i: PlanInput): SyncPlan {
  const items: PlanItem[] = [];
  const report: PlanReport = { ambiguous: [], not_found: [], no_branch: [] };

  // Записи по id. Запись, пришедшая в обоих списках, считается активной: уволенной
  // её признавать нельзя, это вердикт против живого человека.
  const activeById = new Map<number, WorklyEmployee>();
  for (const w of i.active) if (!activeById.has(w.id)) activeById.set(w.id, w);
  const active = [...activeById.values()];
  const dismissedById = new Map<number, WorklyDismissed>();
  for (const x of i.dismissed) if (!activeById.has(x.id) && !dismissedById.has(x.id)) dismissedById.set(x.id, x);

  // Ключи имён: по всем активным (в том числе уже занятым связью) и по уволенным.
  const activeKeys = new Set<string>();
  for (const w of active) for (const k of worklyNameKeys(w)) if (k) activeKeys.add(k);
  const dismissedByKey = new Map<string, Set<number>>();
  for (const x of dismissedById.values()) {
    for (const k of worklyNameKeys(x)) {
      if (!k) continue;
      const s = dismissedByKey.get(k);
      if (s) s.add(x.id);
      else dismissedByKey.set(k, new Set([x.id]));
    }
  }

  // Сотрудник, связанный с записью ДРУГОЙ компании, к этому плану не относится:
  // ни кандидат, ни деактивация, ни строка отчёта. Пространство id у компаний своё.
  const mine: Emp[] = [];
  for (const e of i.ours) {
    if (e.workly_id != null && e.workly_company_id != null && e.workly_company_id !== i.companyId) continue;
    const eligible = e.workly_id == null || dismissedById.has(e.workly_id);
    mine.push({ e, key: nameKey(e.first_name, e.last_name), eligible });
  }

  // На кого указывает какой workly_id.
  const pointedBy = new Map<number, Emp[]>();
  for (const m of mine) if (m.e.workly_id != null) pushIndex(pointedBy, m.e.workly_id, m);

  // Должность из первой записи Workly. Пустой заголовок — «данных нет».
  const structOf = (w: WorklyEmployee): StructuredPosition | null => {
    const title = w.positions?.[0]?.title?.trim();
    return title ? i.structure(title) : null;
  };

  // Терминал по локациям: берём, только если ровно одна локация сопоставлена.
  const terminalOf = (w: WorklyEmployee): string | null => {
    const seen = new Set<number>();
    let found: string | null = null;
    let n = 0;
    for (const l of w.locations ?? []) {
      if (seen.has(l.id)) continue;
      seen.add(l.id);
      const t = i.terminalByLocation.get(l.id);
      if (t) {
        n++;
        found = t;
      }
    }
    return n === 1 ? found : null;
  };

  // --- Правило 1: активные записи, на которые никто не указывает ---------------
  // Запись и кандидаты связываются ключом имени. Группы собираются через общий
  // ключ: две записи-тёзки, два наших тёзки и цепочки из них. Однозначна только
  // группа «одна запись, один кандидат».
  const unpointed = active.filter((w) => !pointedBy.has(w.id));
  const nW = unpointed.length;
  const wKeys = unpointed.map((w) => worklyNameKeys(w).filter(Boolean));
  const wIndex = new Map<number, number>();
  unpointed.forEach((w, k) => wIndex.set(w.id, k));

  const wsByKey = new Map<string, number[]>();
  wKeys.forEach((keys, k) => keys.forEach((key) => pushIndex(wsByKey, key, k)));
  const esByKey = new Map<string, number[]>();
  const eligibleCount = new Map<string, number>();
  mine.forEach((m, k) => {
    if (!m.eligible || !m.key) return;
    pushIndex(esByKey, m.key, k);
    eligibleCount.set(m.key, (eligibleCount.get(m.key) ?? 0) + 1);
  });

  const dsu = makeDsu(nW + mine.length);
  for (const [key, ws] of wsByKey) {
    for (const w of ws) dsu.union(w, ws[0]!);
    for (const e of esByKey.get(key) ?? []) dsu.union(nW + e, ws[0]!);
  }
  interface Group {
    ws: number[];
    es: number[];
    reported: boolean;
  }
  const groups = new Map<number, Group>();
  const groupOf = (root: number): Group => {
    let g = groups.get(root);
    if (!g) groups.set(root, (g = { ws: [], es: [], reported: false }));
    return g;
  };
  for (let k = 0; k < nW; k++) if (wKeys[k]!.length) groupOf(dsu.find(k)).ws.push(k);
  // В группу попадают только кандидаты, чей ключ совпал с ключом какой-то записи:
  // без этого они остались бы в одиночных множествах без записи.
  const touched = new Set<number>();
  mine.forEach((m, k) => {
    if (!m.eligible || !m.key || !wsByKey.has(m.key)) return;
    groupOf(dsu.find(nW + k)).es.push(k);
    touched.add(k);
  });

  // --- Сборка пунктов -------------------------------------------------------------
  // pinLink: сотрудник уже связан с этой активной записью, и перенос закрепляет пару Workly.
  // При связи по имени (link/relink) не закрепляет: связь меняет пару раньше переноса.
  const moveItem = (m: Emp, w: WorklyEmployee, pinLink: boolean) => {
    const t = terminalOf(w);
    if (!t || t === m.e.terminal_id) return;
    const after: Partial<EmployeeFields> = { terminal_id: t };
    items.push({
      key: itemKey("move", m.e.id, w.id),
      kind: "move",
      employee_id: m.e.id,
      workly_id: w.id,
      label: fullName(m.e),
      before: beforeOf(m.e, after, pinLink),
      after,
    });
  };

  // Правило 2: запись уже связана с нашим сотрудником.
  const existing = (m: Emp, w: WorklyEmployee) => {
    const e = m.e;
    const after: Partial<EmployeeFields> = {};
    const tab = normTab(w.tab_number);
    if (e.workly_tab_number !== undefined && normTab(e.workly_tab_number) !== tab) {
      after.workly_tab_number = tab;
    }
    // Если в Workly должности нет, наша остаётся: пустое значение не стирает данные.
    const st = structOf(w);
    if (st && st.position != null && st.position !== (e.position ?? null)) {
      Object.assign(after, structFields(st));
    }
    const changed = Object.keys(after).length > 0;
    if (!e.active) {
      const afterR: Partial<EmployeeFields> = { active: true, ...after };
      items.push({
        key: itemKey("reactivate", e.id, w.id),
        kind: "reactivate",
        employee_id: e.id,
        workly_id: w.id,
        label: fullName(e),
        before: beforeOf(e, afterR, true),
        after: afterR,
      });
    } else if (changed) {
      items.push({
        key: itemKey("update", e.id, w.id),
        kind: "update",
        employee_id: e.id,
        workly_id: w.id,
        label: fullName(e),
        before: beforeOf(e, after, true),
        after,
      });
    }
    moveItem(m, w, true);
  };

  // Правило 1, один кандидат: связать (workly_id пуст) или перепривязать (был на уволенную).
  const linkOne = (m: Emp, w: WorklyEmployee) => {
    const e = m.e;
    const kind: PlanKind = e.workly_id == null ? "link" : "relink";
    const st = structOf(w);
    const after: Partial<EmployeeFields> = {
      workly_company_id: i.companyId,
      workly_id: w.id,
      workly_tab_number: normTab(w.tab_number),
      ...(st ? structFields(st) : {}),
      active: true,
    };
    items.push({
      key: itemKey(kind, e.id, w.id),
      kind,
      employee_id: e.id,
      workly_id: w.id,
      label: fullName(e),
      // Пара Workly и так в after, поэтому её прежнее значение попадает в before.
      before: beforeOf(e, after, false),
      after,
    });
    // Терминал меняется отдельным пунктом, иначе после применения плана второй
    // проход нашёл бы его снова.
    moveItem(m, w, false);
  };

  const createOne = (w: WorklyEmployee) => {
    const terminal = terminalOf(w);
    if (!terminal) {
      report.no_branch.push({ workly_id: w.id, label: fullName(w) });
      return;
    }
    const st = structOf(w);
    items.push({
      key: itemKey("create", null, w.id),
      kind: "create",
      employee_id: null,
      workly_id: w.id,
      label: fullName(w),
      before: null,
      after: {
        first_name: (w.first_name ?? "").trim(),
        last_name: (w.last_name ?? "").trim(),
        workly_company_id: i.companyId,
        workly_id: w.id,
        workly_tab_number: normTab(w.tab_number),
        ...(st
          ? structFields(st)
          : { position: null, staff_role_id: null, grade: null, shift: null, is_trainee: null }),
        terminal_id: terminal,
        active: true,
      },
    });
  };

  // Одна строка отчёта на группу. workly_id — наименьший в группе, остальные id
  // в подписи. employee_ids — все наши кандидаты группы (чтобы HR мог связать вручную);
  // пуст, только если у группы нет ни одного нашего кандидата.
  const reportAmbiguous = (g: Group) => {
    if (g.reported) return;
    g.reported = true;
    const recs = g.ws.map((k) => unpointed[k]!).sort((a, b) => a.id - b.id);
    const head = recs[0]!;
    const label = recs.length > 1 ? `${fullName(head)} (Workly: ${recs.map((r) => r.id).join(", ")})` : fullName(head);
    const employee_ids = g.es.map((k) => mine[k]!.e.id).sort();
    report.ambiguous.push({ workly_id: head.id, label, employee_ids });
  };

  for (const w of active) {
    const owners = pointedBy.get(w.id);
    if (owners) {
      for (const m of owners) existing(m, w);
      continue;
    }
    const k = wIndex.get(w.id)!;
    if (!wKeys[k]!.length) {
      // Запись без имени сопоставить не с чем, а создать безымянного сотрудника нельзя.
      report.ambiguous.push({ workly_id: w.id, label: `${fullName(w) || "без имени"} (Workly: ${w.id})`, employee_ids: [] });
      continue;
    }
    const g = groupOf(dsu.find(k));
    if (g.ws.length > 1 || g.es.length > 1) reportAmbiguous(g);
    else if (g.es.length === 1) linkOne(mine[g.es[0]!]!, w);
    else createOne(w);
  }

  // --- Правило 3: наши активные сотрудники, которых правила 1 и 2 не затронули -----
  const dismissedKeyed = (m: Emp): WorklyDismissed | null => {
    // Деактивация по одному имени: только если имя не встречается среди активных,
    // совпало ровно с одной уволенной записью, её не занял другой наш сотрудник
    // и у нас нет второго сотрудника с тем же именем (иначе неясно, кто из них уволен).
    if (!m.key || activeKeys.has(m.key)) return null;
    const ids = dismissedByKey.get(m.key);
    if (!ids || ids.size !== 1) return null;
    const id = [...ids][0]!;
    if (pointedBy.has(id) || (eligibleCount.get(m.key) ?? 0) !== 1) return null;
    const dd = dismissedById.get(id) ?? null;
    // Ключи совпадают несимметрично: наш ключ (имя+фамилия) мог не встретиться среди
    // активных, а у уволенной записи есть второй ключ с отчеством. Если любой ключ
    // этой записи есть у активной (новая запись без отчества рядом со старой с ним,
    // типичный повторный приём), человек, скорее всего, жив: не деактивируем.
    if (dd && worklyNameKeys(dd).some((k) => k && activeKeys.has(k))) return null;
    return dd;
  };

  mine.forEach((m, k) => {
    const e = m.e;
    if (!e.active) return;
    if (e.workly_id != null && activeById.has(e.workly_id)) return; // правило 2
    if (touched.has(k)) return; // правило 1: связан, перепривязан или в неоднозначной группе
    const d = e.workly_id != null ? dismissedById.get(e.workly_id) ?? null : dismissedKeyed(m);
    if (!d) {
      report.not_found.push({ employee_id: e.id, label: fullName(e) });
      return;
    }
    items.push({
      key: itemKey("deactivate", e.id, d.id),
      kind: "deactivate",
      employee_id: e.id,
      workly_id: d.id,
      label: fullName(e),
      before: { active: true, workly_id: e.workly_id, workly_company_id: e.workly_company_id },
      after: { active: false, workly_company_id: i.companyId, workly_id: d.id },
    });
  });

  return { items, report };
}

export function countsOf(p: SyncPlan): Record<PlanKind | "ambiguous" | "not_found" | "no_branch", number> {
  const out: Record<PlanKind | "ambiguous" | "not_found" | "no_branch", number> = {
    link: 0,
    relink: 0,
    update: 0,
    move: 0,
    create: 0,
    deactivate: 0,
    reactivate: 0,
    ambiguous: p.report.ambiguous.length,
    not_found: p.report.not_found.length,
    no_branch: p.report.no_branch.length,
  };
  for (const it of p.items) out[it.kind]++;
  return out;
}
