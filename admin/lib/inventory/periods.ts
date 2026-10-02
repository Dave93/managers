// Asia/Tashkent — UTC+5 круглый год (то же правило, что backend/src/modules/inventory/rules.ts).
const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1000;
const pad = (n: number) => String(n).padStart(2, "0");

function lastDay(y: number, m: number): string {
  return `${y}-${pad(m)}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;
}

/** Последние n месячных периодов (последний день месяца), текущий первым. */
export function recentPeriods(now: Date, n: number): string[] {
  const t = new Date(now.getTime() + TASHKENT_OFFSET_MS);
  let y = t.getUTCFullYear();
  let m = t.getUTCMonth() + 1;
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    out.push(lastDay(y, m));
    if (m === 1) {
      y -= 1;
      m = 12;
    } else {
      m -= 1;
    }
  }
  return out;
}

export function periodLabel(period: string, locale: string): string {
  const [y, m] = period.split("-").map(Number);
  const intlLocale = locale === "uz-Latn" ? "uz" : locale === "uz-Cyrl" ? "uz-Cyrl" : locale;
  const d = new Date(Date.UTC(y, m - 1, 15));
  try {
    return d.toLocaleDateString(intlLocale, { month: "long", year: "numeric", timeZone: "UTC" });
  } catch {
    return `${pad(m)}.${y}`;
  }
}
