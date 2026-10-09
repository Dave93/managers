// Типы ответов «Сравнение с учётом» и «Остатки склада». Без импортов: admin берёт через `import type`.
// Количества — строкой без хвостовых нулей.

export interface BookBreakdown {
  start_qty: string;
  in_invoice: string;
  out_sales: string;
  transfer_in: string;
  transfer_out: string;
  out_writeoff: string;
  other_net: string;
  /** начало + движение = книжное; иначе разбивка неполная. */
  consistent: boolean;
}

export interface BookLineView extends BookBreakdown {
  product_id: string;
  code: string | null;
  product_name: string;
  unit_name: string | null;
  group_name: string;
  /** Товар есть в пересчёте (иначе — только в учёте iiko). */
  in_count: boolean;
  /** Факт пересчёта; null — «не считали» или товара нет в пересчёте. */
  fact_qty: string | null;
  book_qty: string;
  /** факт − книжное; null, если факта нет. */
  diff_qty: string | null;
}

export interface BookView {
  /** Когда загружен снимок; null — ещё загружается. */
  fetched_at: string | null;
  lines: BookLineView[];
}

export interface StockLine {
  product_id: string;
  code: string | null;
  name: string;
  unit_name: string | null;
  group_name: string;
  qty: string;
}

export interface StockView {
  /** Филиалу остатки скрыты, пока у склада есть пересчёт, который он ещё может менять. */
  hidden: boolean;
  at: string | null;
  lines: StockLine[];
}

export interface StockMovement extends BookBreakdown {
  product_id: string;
  from: string;
  at: string;
  book_qty: string;
}

/** Сверка по дням: строка списка промежуточных пересчётов. */
export interface InterimReconRow {
  count_id: string;
  store_id: string;
  store_name: string;
  count_date: string;
  template_name: string;
  status: string;
  book_fetched_at: string | null;
  /** Товаров, по которым филиал ввёл количество. */
  lines_counted: number;
  /** Из них A ≠ книжного iiko. */
  mismatch_count: number;
  /** Отмечено «проверено» среди расхождений. */
  checked_count: number;
}

export interface InterimReconLine extends BookBreakdown {
  product_id: string;
  code: string | null;
  product_name: string;
  unit_name: string | null;
  group_name: string;
  admin_qty: string;
  /** Книжное iiko на конец дня; null — снимка ещё нет. */
  iiko_qty: string | null;
  diff_qty: string | null;
  checked: boolean;
  checked_by_name: string | null;
  checked_at: string | null;
}

export interface InterimReconDetail extends InterimReconRow {
  lines: InterimReconLine[];
}
