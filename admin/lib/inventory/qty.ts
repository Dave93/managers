export const MAX_QTY = 1_000_000;
const SCALE = 10_000;

export type ParseQtyResult =
  | { ok: true; values: number[] }
  | { ok: false; error: "empty" | "invalid" | "too_many_decimals" | "too_big" };

// «2,5 + 3» → две записи [2.5, 3]. Каждое слагаемое — отдельная запись,
// чтобы параллельные участники не затирали друг друга.
export function parseQtyInput(raw: string): ParseQtyResult {
  const s = raw.replace(/\s+/g, "");
  if (!s) return { ok: false, error: "empty" };
  const values: number[] = [];
  for (const part of s.split("+")) {
    if (!/^\d+([.,]\d+)?$/.test(part)) return { ok: false, error: "invalid" };
    const normalized = part.replace(",", ".");
    const frac = normalized.split(".")[1] ?? "";
    if (frac.length > 4) return { ok: false, error: "too_many_decimals" };
    const v = Number(normalized);
    if (v > MAX_QTY) return { ok: false, error: "too_big" };
    values.push(v);
  }
  return { ok: true, values };
}

function trimZeros(s: string): string {
  return s.includes(".") ? s.replace(/\.?0+$/, "") || "0" : s;
}

// Сумма в целых десятитысячных: без хвостов вида 0.30000000000000004.
export function sumQty(values: (string | number)[]): string {
  let total = 0;
  for (const v of values) total += Math.round(Number(v) * SCALE);
  return trimZeros((total / SCALE).toFixed(4));
}

export function formatQty(v: string | null | undefined): string {
  if (v === null || v === undefined || v === "") return "";
  return trimZeros(Number(v).toFixed(4)).replace(".", ",");
}
