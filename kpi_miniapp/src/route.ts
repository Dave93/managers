// Маршрут живёт в хеше. Telegram дописывает к фрагменту свои параметры
// запуска (`#/review/2026-10?tgWebAppData=…` или целиком `#tgWebAppData=…`),
// поэтому путь берётся до первого «?» или «&».
export type Route =
  | { name: "home" }
  | { name: "review"; period: string }
  | { name: "violations"; period: string }
  | { name: "history" }
  | { name: "attendance"; month: string | null }
  // Экраны оценщика (роль evaluator): период — «YYYY-MM-01»; null — месяц по умолчанию решает сервер.
  | { name: "ev"; period: string | null }
  | { name: "ev_review"; period: string; employee_id: string }
  | { name: "ev_violation"; employee_id: string }
  | { name: "ev_violations"; period: string | null }
  | { name: "ev_disputes" }
  | { name: "ev_dispute"; id: string }
  // Выходные: форма выдачи сотруднику и список выданных (месяц «YYYY-MM-01»; null — месяц по умолчанию решает сервер).
  | { name: "ev_dayoff"; employee_id: string }
  | { name: "ev_dayoff_pick" }
  | { name: "ev_daysoff"; period: string | null };

const HOME: Route = { name: "home" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** «YYYY-MM» → «YYYY-MM-01»; кривой месяц — null. */
function monthStart(ym: string): string | null {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m) return null;
  const month = Number(m[2]);
  return month >= 1 && month <= 12 ? `${m[1]}-${m[2]}-01` : null;
}

// Экраны оценщика. Порядок разбора важен: «disputes» и «violations» — не месяцы.
function parseEv(path: string): Route {
  if (path === "/ev") return { name: "ev", period: null };
  if (path === "/ev/disputes") return { name: "ev_disputes" };
  if (path === "/ev/violations") return { name: "ev_violations", period: null };
  if (path === "/ev/daysoff") return { name: "ev_daysoff", period: null };
  if (path === "/ev/dayoff") return { name: "ev_dayoff_pick" };
  const seg = path.split("/").slice(2); // после «/ev/»
  const [kind = "", x = "", y = ""] = seg;
  if (kind === "dispute" && seg.length === 2) return UUID.test(x) ? { name: "ev_dispute", id: x } : { ...HOME };
  if (kind === "violation" && seg.length === 2) return UUID.test(x) ? { name: "ev_violation", employee_id: x } : { ...HOME };
  if (kind === "dayoff" && seg.length === 2) return UUID.test(x) ? { name: "ev_dayoff", employee_id: x } : { ...HOME };
  if (kind === "daysoff" && seg.length === 2) {
    const period = monthStart(x);
    return period ? { name: "ev_daysoff", period } : { ...HOME };
  }
  if (kind === "violations" && seg.length === 2) {
    const period = monthStart(x);
    return period ? { name: "ev_violations", period } : { ...HOME };
  }
  if (kind === "review" && seg.length === 3) {
    const period = monthStart(x);
    return period && UUID.test(y) ? { name: "ev_review", period, employee_id: y } : { ...HOME };
  }
  if (seg.length === 1) {
    const period = monthStart(kind);
    if (period) return { name: "ev", period };
  }
  return { ...HOME };
}

export function parseHash(hash: string): Route {
  let path = hash.startsWith("#") ? hash.slice(1) : hash;
  const cut = path.search(/[?&]/);
  if (cut >= 0) path = path.slice(0, cut);

  if (path === "/ev" || path.startsWith("/ev/")) return parseEv(path);
  if (path === "/history") return { name: "history" };
  if (path === "/attendance") return { name: "attendance", month: null };
  const a = /^\/attendance\/([1-9]\d{3})-(\d{2})$/.exec(path);
  if (a) {
    const month = Number(a[2]);
    // Месяц «YYYY-MM»; кривой месяц — главный экран.
    if (month >= 1 && month <= 12) return { name: "attendance", month: `${a[1]}-${a[2]}` };
  }
  const m = /^\/(review|violations)\/(\d{4})-(\d{2})$/.exec(path);
  if (m) {
    const month = Number(m[3]);
    // Период всегда «YYYY-MM-01»; кривой месяц — главный экран.
    if (month >= 1 && month <= 12) return { name: m[1] as "review" | "violations", period: `${m[2]}-${m[3]}-01` };
  }
  return { ...HOME };
}

export function hashOf(r: Route): string {
  switch (r.name) {
    case "home":
      return "#/";
    case "history":
      return "#/history";
    case "attendance":
      return r.month === null ? "#/attendance" : `#/attendance/${r.month}`;
    case "review":
    case "violations":
      return `#/${r.name}/${r.period.slice(0, 7)}`;
    case "ev":
      return r.period ? `#/ev/${r.period.slice(0, 7)}` : "#/ev";
    case "ev_review":
      return `#/ev/review/${r.period.slice(0, 7)}/${r.employee_id}`;
    case "ev_violation":
      return `#/ev/violation/${r.employee_id}`;
    case "ev_violations":
      return r.period ? `#/ev/violations/${r.period.slice(0, 7)}` : "#/ev/violations";
    case "ev_disputes":
      return "#/ev/disputes";
    case "ev_dispute":
      return `#/ev/dispute/${r.id}`;
    case "ev_dayoff":
      return `#/ev/dayoff/${r.employee_id}`;
    case "ev_dayoff_pick":
      return "#/ev/dayoff";
    case "ev_daysoff":
      return r.period ? `#/ev/daysoff/${r.period.slice(0, 7)}` : "#/ev/daysoff";
  }
}

export function isEvRoute(r: Route): boolean {
  return r.name.startsWith("ev");
}

/** Главный экран — всем; экраны оценщика — роли evaluator; остальные — роли employee. */
export function routeAllowed(r: Route, roles: readonly string[]): boolean {
  if (r.name === "home") return true;
  return roles.indexOf(isEvRoute(r) ? "evaluator" : "employee") >= 0;
}
