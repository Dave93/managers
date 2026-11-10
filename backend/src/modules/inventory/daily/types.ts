// «Дневные остатки»: какие склады филиалов вбивают пересчёт за каждый день месяца (офис).
// Даты в ответе — номерами дней: Eden превращает строки-даты в Date, а здесь они не нужны.

export type DailyBrand = "les" | "chopar";

export interface DailyCell {
  count_id: string;
  status: "submitted" | "draft";
  /** Месячный пересчёт (в последний день месяца), а не промежуточный. */
  monthly: boolean;
}

export interface DailyGridRow {
  store_id: string;
  store_name: string;
  /** cells[i] — день i + 1; null — пересчёта нет. */
  cells: (DailyCell | null)[];
  /** Сколько из полных дней (1..complete_days) отправлено. */
  submitted: number;
}

export interface DailyGridGroup {
  brand: DailyBrand;
  rows: DailyGridRow[];
  /** totals[i] — сколько складов группы отправили пересчёт за день i + 1. */
  totals: number[];
}

export interface DailyGrid {
  period: string;
  /** Сколько дней показываем: весь прошедший месяц или текущий по вчера. */
  days: number;
  /** День, за который пересчёт вбивают сегодня (вчера по Ташкенту), если он в этом месяце. */
  entering_day: number | null;
  /** Полные дни — 1..complete_days; по ним считается «из N». */
  complete_days: number;
  groups: DailyGridGroup[];
}
