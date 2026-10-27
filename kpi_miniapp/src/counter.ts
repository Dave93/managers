// Счётчик причины в шторке спора (без DOM, чтобы его проверял тест; sheet.ts тесты не импортируют).
// Считает буквы и цифры, как сервер (commentOk): пробелы и знаки не в счёт.
import { type Lang, tIn } from "./i18n";
import { reasonCount } from "./util";

export interface ReasonCounter {
  text: string;
  ok: boolean; // минимум набран
}

/**
 * Пока букв и цифр меньше минимума — «ещё N» (сколько осталось). Набран минимум: без максимума
 * счётчик пуст (считать больше нечего), с максимумом — «длина / максимум». Прежний «5 / 5» показывал минимум.
 */
export function reasonCounter(reason: string, min: number, max: number | null, l: Lang): ReasonCounter {
  const n = reasonCount(reason);
  if (n < min) return { text: tIn(l, "sheet_left", { n: min - n }), ok: false };
  return { text: max === null ? "" : `${n} / ${max}`, ok: true };
}
