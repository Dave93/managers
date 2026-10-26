// Адрес мини-приложения «Мой KPI» и маршруты экранов для кнопок «Открыть». Чистые функции, воркер их импортирует.
// ES2021: без .at(), Object.hasOwn и прочего новее.

// Telegram отвергает web_app не по https, и каждое уведомление стало бы failed навсегда:
// поэтому http:// и адрес без схемы считаются незаданным, кнопок тогда просто нет.
export function miniAppUrl(): string | null {
  const v = (process.env.KPI_MINIAPP_URL ?? "").trim();
  if (!/^https:\/\/\S+$/.test(v)) return null;
  return v.endsWith("/") ? v : `${v}/`;
}

const MONTH_RE = /^(\d{4}-\d{2})-01$/;

function ym(period: unknown): string | null {
  const r = typeof period === "string" ? MONTH_RE.exec(period) : null;
  if (!r) return null;
  const m = Number(r[1].slice(5));
  return m >= 1 && m <= 12 ? r[1] : null;
}

// Экран мини-приложения для уведомления; null — кнопки нет (оценщику, кривой срок, прочие виды).
export function appRoute(kind: string, payload: Record<string, unknown>): string | null {
  const p = typeof payload === "object" && payload !== null ? payload : {};
  switch (kind) {
    case "review_submitted":
    case "review_changed": {
      const m = ym(p.period);
      return m ? `/review/${m}` : null;
    }
    case "violation_recorded": {
      const m = ym(p.period);
      return m ? `/violations/${m}` : null;
    }
    case "dispute_resolved": {
      const m = ym(p.period);
      if (!m) return null;
      if (p.subject_type === "violation") return `/violations/${m}`;
      if (p.subject_type === "review") return `/review/${m}`;
      return null;
    }
    case "raise_approved":
      return "/history";
    default:
      return null;
  }
}
