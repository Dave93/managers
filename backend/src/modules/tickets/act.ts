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
const MAX_UNIT = 20;
const MAX_AMOUNT_MINOR = 99_999_999_999_999; // numeric(14,2) max: 999999999999.99
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
    const position = i + 1;
    const where = `позиция #${position}`;
    
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
    if (amountMinor > MAX_AMOUNT_MINOR) {
      errors.push(`${where}: сумма больше максимально допустимой`);
      return;
    }

    // qty: undefined/absent → 100 (1.00), but null or wrong shape → error
    let qtyMinor: number | null;
    if (entry?.qty === undefined) {
      qtyMinor = 100;
    } else {
      qtyMinor = toMinor(entry.qty);
    }
    if (qtyMinor === null || qtyMinor <= 0) {
      errors.push(`${where}: количество должно быть больше нуля`);
      return;
    }

    // unit: absent (undefined) → null, present and string → use it (max 20 chars), otherwise → error
    let unit: string | null;
    if (entry?.unit === undefined) {
      unit = null;
    } else if (typeof entry.unit === "string") {
      const trimmed = entry.unit.trim();
      if (trimmed.length === 0) {
        unit = null;
      } else if (trimmed.length > MAX_UNIT) {
        errors.push(`${where}: единица длиннее ${MAX_UNIT} символов`);
        return;
      } else {
        unit = trimmed;
      }
    } else {
      errors.push(`${where}: единица должна быть строкой`);
      return;
    }

    // Check if adding this amount would overflow the total
    const newTotal = totalMinor + amountMinor;
    if (newTotal > MAX_AMOUNT_MINOR) {
      errors.push(`${where}: сумма позиции превышает итоговый лимит`);
      return;
    }

    totalMinor = newTotal;
    items.push({
      position,
      title,
      qty: fromMinor(qtyMinor),
      unit,
      amount: fromMinor(amountMinor),
    });
  });

  return errors.length ? { ok: false, errors } : { ok: true, items, total: fromMinor(totalMinor) };
}
