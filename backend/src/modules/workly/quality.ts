// Качество данных посещаемости из Workly: HR видит, насколько импорт правдоподобен,
// прежде чем доверять ему (раздел про «Качество данных»). Две проверки: доля прогулов
// по филиалам (выбросы на фоне остальных) и сотрудники, прогулявшие почти все дни.
import { employees, kpi_attendance, terminals } from "backend/drizzle/schema";
import { and, eq, gte, inArray, lt } from "drizzle-orm";
import type { DbLike } from "../kpi/access";
import { addMonths, type Period } from "../kpi/time";

export interface BranchQuality {
  terminal_id: string;
  terminal_name: string;
  /** Строки (сотрудник, день) филиала за месяц. */
  days: number;
  /** Из них прогулов. */
  absent: number;
  /** absent / days. */
  share: number;
  flagged: boolean;
}

export interface HeavyAbsentee {
  employee_id: string;
  days: number;
  absent: number;
}

export interface Quality {
  branches: BranchQuality[];
  median: number;
  heavy: HeavyAbsentee[];
}

// Сотрудник — «прогульщик», если прогулял больше 90% дней (строго) и дней не меньше пяти:
// порог в 5 дней, чтобы один прогул единственного дня не давал «100%».
const HEAVY_MIN_DAYS = 5;

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Чистый расчёт качества по строкам (сотрудник, день). terminalNames — названия филиалов;
 * для неизвестного терминала подставляется его id.
 */
export function qualityOf(
  rows: { employee_id: string; terminal_id: string; absent: boolean }[],
  terminalNames: ReadonlyMap<string, string>
): Quality {
  const perBranch = new Map<string, { days: number; absent: number }>();
  const perEmployee = new Map<string, { days: number; absent: number }>();
  for (const r of rows) {
    const b = perBranch.get(r.terminal_id) ?? { days: 0, absent: 0 };
    b.days += 1;
    if (r.absent) b.absent += 1;
    perBranch.set(r.terminal_id, b);

    const e = perEmployee.get(r.employee_id) ?? { days: 0, absent: 0 };
    e.days += 1;
    if (r.absent) e.absent += 1;
    perEmployee.set(r.employee_id, e);
  }

  // Медиана долей как дробь num / den: средняя доля или среднее двух средних.
  const asc = [...perBranch.values()].sort((a, b) => a.absent * b.days - b.absent * a.days);
  let num = 0;
  let den = 1;
  if (asc.length % 2 === 1) {
    const m = asc[asc.length >> 1];
    num = m.absent;
    den = m.days;
  } else if (asc.length) {
    const lo = asc[asc.length / 2 - 1];
    const hi = asc[asc.length / 2];
    num = lo.absent * hi.days + hi.absent * lo.days;
    den = 2 * lo.days * hi.days;
  }
  const median = num / den;

  const branches: BranchQuality[] = [...perBranch.entries()].map(([terminal_id, b]) => {
    // Филиал отмечается, если его доля больше удвоенной медианы по организации:
    // share > 2 * median ⇔ absent * den > 2 * num * days. При нулевой медиане удвоенная медиана
    // тоже 0, и правило отметило бы любой филиал хотя бы с одним прогулом; поэтому тогда
    // отмечается только доля больше половины дней: share > 0,5 ⇔ 2 * absent > days.
    // Сравнения целыми числами, без плавающей точки: граница «ровно вдвое» не зависит от
    // округления. Произведения порядка days^3 (строк месяца у филиала тысячи) далеко под 2^53.
    const flagged = num > 0 ? b.absent * den > 2 * num * b.days : 2 * b.absent > b.days;
    return {
      terminal_id,
      terminal_name: terminalNames.get(terminal_id) ?? terminal_id,
      days: b.days,
      absent: b.absent,
      share: b.absent / b.days,
      flagged,
    };
  });
  branches.sort((a, b) => b.share - a.share || byText(a.terminal_name, b.terminal_name) || byText(a.terminal_id, b.terminal_id));

  // 0,9 проверяется целыми числами: absent / days > 0.9 ⇔ absent * 10 > days * 9, без плавающей точки.
  const heavy: HeavyAbsentee[] = [...perEmployee.entries()]
    .filter(([, e]) => e.days >= HEAVY_MIN_DAYS && e.absent * 10 > e.days * 9)
    .map(([employee_id, e]) => ({ employee_id, days: e.days, absent: e.absent }))
    .sort((a, b) => b.absent - a.absent || byText(a.employee_id, b.employee_id));

  return { branches, median, heavy };
}

/**
 * Качество посещаемости организации за месяц period (YYYY-MM-01): строки kpi_attendance
 * филиалов этой организации за дни [period, period + 1 месяц). employee_names — «Фамилия Имя»
 * только для прогульщиков; сотрудника без строки в employees в словаре нет.
 */
export async function qualityReport(
  db: DbLike,
  organizationId: string,
  period: Period
): Promise<Quality & { employee_names: Record<string, string> }> {
  const rows = await db
    .select({
      employee_id: kpi_attendance.employee_id,
      terminal_id: kpi_attendance.terminal_id,
      absent: kpi_attendance.absent,
      terminal_name: terminals.name,
    })
    .from(kpi_attendance)
    .innerJoin(terminals, eq(terminals.id, kpi_attendance.terminal_id))
    .where(
      and(
        eq(terminals.organization_id, organizationId),
        gte(kpi_attendance.day, period),
        lt(kpi_attendance.day, addMonths(period, 1))
      )
    );

  const names = new Map<string, string>();
  for (const r of rows) names.set(r.terminal_id, r.terminal_name);

  const quality = qualityOf(rows, names);

  const employee_names: Record<string, string> = {};
  if (quality.heavy.length) {
    const found = await db
      .select({ id: employees.id, first_name: employees.first_name, last_name: employees.last_name })
      .from(employees)
      .where(inArray(employees.id, quality.heavy.map((h) => h.employee_id)));
    for (const e of found) employee_names[e.id] = `${e.last_name} ${e.first_name}`.trim();
  }

  return { ...quality, employee_names };
}
