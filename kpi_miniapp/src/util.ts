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
