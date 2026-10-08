// Книжное количество iiko с разбивкой (spec 2026-10-08, §3–4). Без БД и сети.
import { round4, type BookRow } from "../reconcile/pure";

/** Движение по товару и типу проводки OLAP TRANSACTIONS (Amount.In / Amount.Out). */
export type Movement = { product_id: string; type: string; in: number; out: number };

export type BookLine = {
  product_id: string;
  book_qty: number;
  start_qty: number;
  in_invoice: number;
  out_sales: number;
  transfer_in: number;
  transfer_out: number;
  out_writeoff: number;
  other_net: number;
  /** начало + движение = книжное (иначе в периоде было что-то, чего нет в движении). */
  consistent: boolean;
};

const EPS = 0.0005;

/**
 * Строки: товары пересчёта ∪ ненулевой остаток на начало/конец ∪ товары с движением.
 * INVOICE.in — приход, SESSION_WRITEOFF.out — реализация, TRANSFER — перемещения,
 * WRITEOFF.out — списания; всё остальное (и неожиданное направление) — «прочее» со знаком.
 */
export function buildBook(input: { productIds: string[]; start: BookRow[]; end: BookRow[]; movements: Movement[] }): BookLine[] {
  const start = new Map(input.start.map((b) => [b.product_id, b.amount]));
  const end = new Map(input.end.map((b) => [b.product_id, b.amount]));
  const ids = new Set<string>(input.productIds);
  for (const [id, q] of start) if (Math.abs(q) > EPS) ids.add(id);
  for (const [id, q] of end) if (Math.abs(q) > EPS) ids.add(id);
  for (const m of input.movements) ids.add(m.product_id);

  const acc = new Map<string, Omit<BookLine, "product_id" | "book_qty" | "start_qty" | "consistent">>();
  const zero = () => ({ in_invoice: 0, out_sales: 0, transfer_in: 0, transfer_out: 0, out_writeoff: 0, other_net: 0 });
  for (const m of input.movements) {
    const a = acc.get(m.product_id) ?? zero();
    const inQ = m.in || 0;
    const outQ = m.out || 0;
    switch (m.type) {
      case "INVOICE":
        a.in_invoice += inQ;
        a.other_net -= outQ;
        break;
      case "SESSION_WRITEOFF":
        a.out_sales += outQ;
        a.other_net += inQ;
        break;
      case "TRANSFER":
        a.transfer_in += inQ;
        a.transfer_out += outQ;
        break;
      case "WRITEOFF":
        a.out_writeoff += outQ;
        a.other_net += inQ;
        break;
      default:
        a.other_net += inQ - outQ;
    }
    acc.set(m.product_id, a);
  }

  const out: BookLine[] = [];
  for (const id of ids) {
    const a = acc.get(id) ?? zero();
    const s = round4(start.get(id) ?? 0);
    const b = round4(end.get(id) ?? 0);
    const line = {
      product_id: id,
      book_qty: b,
      start_qty: s,
      in_invoice: round4(a.in_invoice),
      out_sales: round4(a.out_sales),
      transfer_in: round4(a.transfer_in),
      transfer_out: round4(a.transfer_out),
      out_writeoff: round4(a.out_writeoff),
      other_net: round4(a.other_net),
    };
    const calc = s + line.in_invoice - line.out_sales + line.transfer_in - line.transfer_out - line.out_writeoff + line.other_net;
    out.push({ ...line, consistent: Math.abs(calc - b) <= EPS });
  }
  return out;
}

const TASHKENT_OFFSET_MS = 5 * 3600_000;
const SETTLE_MS = 10 * 60_000;

/** Задержка снимка: момент книжного (местное время iiko) ещё не наступил — ждём до него плюс 10 минут. */
export function bookDelayMs(bookAtLocal: string, now: Date): number {
  const at = Date.parse(`${bookAtLocal}Z`) - TASHKENT_OFFSET_MS;
  const delay = at - now.getTime();
  return delay > 0 ? delay + SETTLE_MS : 0;
}

