// Деньги экрана «К оплате». numeric(14,2) приходит строкой («12000.00») и
// остаётся строкой до самого вывода: через Number её пропускать нельзя, сумма
// пачки из 100–200 заявок складывается в целых тийинах, как в
// backend/src/modules/tickets/act.ts. Там тийины лежат в Number и проверяются
// на isSafeInteger; здесь BigInt, потому что одна сумма может доходить до 1e14
// тийинов, и пачка легко переваливает за 2^53.
//
// formatCurrency из lib/format-currency.ts здесь не подходит: он округляет до
// целых и молча срезал бы тийины на экране, где человек утверждает оплату.

const DECIMAL_RE = /^\d+(\.\d{1,2})?$/;
const HUNDRED = BigInt(100);
const ZERO = BigInt(0);

export function toMinor(raw: string | null | undefined): bigint | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!DECIMAL_RE.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  return BigInt(whole) * HUNDRED + BigInt(frac.padEnd(2, "0"));
}

// null, если хотя бы одно значение не разобралось: неполная сумма на кнопке
// утверждения хуже, чем её отсутствие.
export function sumMinor(values: Array<string | null | undefined>): bigint | null {
  let total = ZERO;
  for (const v of values) {
    const m = toMinor(v);
    if (m === null) return null;
    total += m;
  }
  return total;
}

// «1 234 500» или «1 234 500,50»: тийины видны, только когда они есть.
export function formatMinor(minor: bigint): string {
  const whole = (minor / HUNDRED).toString();
  const frac = Number(minor % HUNDRED);
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return frac === 0 ? grouped : `${grouped},${String(frac).padStart(2, "0")}`;
}

// Нечисловое значение показываем как пришло, а не «NaN сум»: человек должен
// увидеть, что с суммой что-то не так.
export function formatAmount(raw: string | null | undefined): string {
  if (raw === null || raw === undefined) return "—";
  const m = toMinor(raw);
  return m === null ? raw : `${formatMinor(m)} сум`;
}
