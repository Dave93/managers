// Форматирование количеств и дат сверки. Ручное, без Intl: вывод одинаков на сервере и
// в браузере, и тесты не зависят от ICU. Разделитель тысяч — узкий неразрывный пробел.
const NNBSP = " ";
const MINUS = "−";

function group(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, NNBSP);
}

export function formatQty(v: string | number | null): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  const [i, f] = Math.abs(n).toFixed(3).replace(/\.?0+$/, "").split(".");
  return (n < 0 ? MINUS : "") + group(i) + (f ? `,${f}` : "");
}

/** Разница A − B со знаком: «+» — в админке больше, чем в iiko, «−» — меньше. */
export function formatDiff(v: string | number | null): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) < 0.00005) return "0";
  return (n > 0 ? "+" : "") + formatQty(n);
}

export function formatDateTime(iso: string | null, locale: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const intl = locale === "uz-Latn" ? "uz" : locale;
  try {
    return d.toLocaleString(intl, { timeZone: "Asia/Tashkent", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch {
    return d.toISOString().slice(0, 16).replace("T", " ");
  }
}
