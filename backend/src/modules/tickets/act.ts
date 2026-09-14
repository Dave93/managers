export type WorkItemInput = {
  title?: unknown;
  qty?: unknown;
  unit?: unknown;
  amount?: unknown;
};

export type NormalizedWorkItem = {
  position: number;
  title: string;
  qty: string;
  unit: string | null;
  amount: string;
};

export type ActResult =
  | { ok: true; items: NormalizedWorkItem[]; total: string }
  | { ok: false; errors: string[] };

const MAX_ITEMS = 50;
const MAX_TITLE = 200;
const DECIMAL_RE = /^\d+(\.\d{1,2})?$/;

// Суммы живут в тийинах (целых сотых) до самого форматирования: сложение
// денег в double даёт 0.1 + 0.2 = 0.30000000000000004, и акт на миллион
// расходится с итогом на копейку, которую потом ищут руками.
function toMinor(raw: unknown): number | null {
  const s = typeof raw === "number" ? raw.toString() : typeof raw === "string" ? raw.trim() : "";
  if (!DECIMAL_RE.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  const minor = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return Number.isSafeInteger(minor) ? minor : null;
}

const fromMinor = (minor: number): string => `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, "0")}`;

export function normalizeWorkItems(raw: unknown): ActResult {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, errors: ["в акте должна быть хотя бы одна позиция"] };
  }
  if (raw.length > MAX_ITEMS) {
    return { ok: false, errors: [`позиций больше ${MAX_ITEMS}`] };
  }

  const errors: string[] = [];
  const items: NormalizedWorkItem[] = [];
  let totalMinor = 0;

  raw.forEach((entry: WorkItemInput, i) => {
    const where = `позиция #${i + 1}`;
    const title = typeof entry?.title === "string" ? entry.title.trim() : "";
    if (!title) {
      errors.push(`${where}: пустое наименование`);
      return;
    }
    if (title.length > MAX_TITLE) {
      errors.push(`${where}: наименование длиннее ${MAX_TITLE} символов`);
      return;
    }

    const amountMinor = toMinor(entry?.amount);
    if (amountMinor === null) {
      errors.push(`${where}: сумма должна быть числом с двумя знаками после точки`);
      return;
    }
    if (amountMinor <= 0) {
      errors.push(`${where}: сумма должна быть больше нуля`);
      return;
    }

    const qtyMinor = entry?.qty === undefined || entry?.qty === null ? 100 : toMinor(entry.qty);
    if (qtyMinor === null || qtyMinor <= 0) {
      errors.push(`${where}: количество должно быть больше нуля`);
      return;
    }

    const unit = typeof entry?.unit === "string" && entry.unit.trim() ? entry.unit.trim().slice(0, 20) : null;

    totalMinor += amountMinor;
    items.push({
      position: items.length + 1,
      title,
      qty: fromMinor(qtyMinor),
      unit,
      amount: fromMinor(amountMinor),
    });
  });

  return errors.length ? { ok: false, errors } : { ok: true, items, total: fromMinor(totalMinor) };
}
