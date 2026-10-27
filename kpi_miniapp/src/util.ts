// Мелкие чистые помощники без DOM.

/** Защёлка от двойного нажатия: take() true только для первого вызова. */
export function latch(): { take(): boolean; release(): void } {
  let held = false;
  return {
    take() {
      if (held) return false;
      held = true;
      return true;
    },
    release() {
      held = false;
    },
  };
}

/** Первая буква заглавная («noyabrdagi» → «Noyabrdagi»). */
export function capFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Число букв и цифр — так же причину считает сервер. */
export function reasonCount(s: string): number {
  return (s.match(/[\p{L}\p{N}]/gu) ?? []).length;
}

/**
 * Последнее слово не остаётся одно на строке: пробел перед ним становится неразрывным
 * («…22:40 —» / «нет связи», а не «… — нет» / «связи»). Слово — всё после последнего
 * обычного пробела, вместе с U+00A0 внутри («95,0 %.», «500 000 сум.»): \S в JS U+00A0
 * не берёт, поэтому такие концы прежде оставались без защиты.
 */
export function noWidow(s: string): string {
  return s.replace(/ ([^ ]+)$/, "\u00a0$1");
}
