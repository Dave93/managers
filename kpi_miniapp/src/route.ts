// Маршрут живёт в хеше. Telegram дописывает к фрагменту свои параметры
// запуска (`#/review/2026-10?tgWebAppData=…` или целиком `#tgWebAppData=…`),
// поэтому путь берётся до первого «?» или «&».
export type Route =
  | { name: "home" }
  | { name: "review"; period: string }
  | { name: "violations"; period: string }
  | { name: "history" }
  | { name: "attendance"; month: string | null };

const HOME: Route = { name: "home" };

export function parseHash(hash: string): Route {
  let path = hash.startsWith("#") ? hash.slice(1) : hash;
  const cut = path.search(/[?&]/);
  if (cut >= 0) path = path.slice(0, cut);

  if (path === "/history") return { name: "history" };
  if (path === "/attendance") return { name: "attendance", month: null };
  const a = /^\/attendance\/(\d{4})-(\d{2})$/.exec(path);
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
  }
}
