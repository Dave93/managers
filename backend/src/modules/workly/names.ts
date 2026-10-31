// Ключ имени для сверки сотрудников с Workly.
//
// Имена в Workly латиницей, у нас в основном тоже, но написаны они вручную:
// «To'lqin» и «TOLQIN», «O’RINBOYEV» и «Orinboyev» — один человек.
// Поэтому сравниваются не строки, а ключи: набор слов без регистра и апострофов.
// Транслитерации нет: кириллица остаётся кириллицей, и «Иван» с «Ivan» не совпадут.

// Все виды апострофа, которыми пишут узбекские имена. Удаляются, а не заменяются
// пробелом: «O'ktam» должно стать «OKTAM», а не «O KTAM».
const APOSTROPHES = /[’‘ʻʼ`´']/g;

// Любой символ вне латиницы, цифр и кириллицы разделяет слова.
const NOT_NAME_CHAR = /[^A-Z0-9А-ЯЁ]+/g;

/**
 * Ключ имени: слова в верхнем регистре, без повторов, по алфавиту, через пробел.
 * Пустые и пропущенные части игнорируются; имя без букв даёт пустую строку.
 */
export function nameKey(...parts: (string | null | undefined)[]): string {
  const text = parts
    .filter((p): p is string => !!p)
    .join(" ")
    .toUpperCase()
    .replace(APOSTROPHES, "")
    .replace(NOT_NAME_CHAR, " ");
  const tokens = new Set(text.split(" ").filter(Boolean));
  return [...tokens].sort().join(" ");
}

/**
 * Ключи записи Workly: имя+фамилия и имя+фамилия+отчество. Наши сотрудники хранят
 * только имя и фамилию, но отчество иногда оказывается внутри одного из них, поэтому
 * совпадение с любым из двух ключей считается совпадением. Без отчества ключ один.
 */
export function worklyNameKeys(e: {
  first_name: string;
  last_name: string;
  patronymic?: string | null;
}): string[] {
  const short = nameKey(e.first_name, e.last_name);
  const full = nameKey(e.first_name, e.last_name, e.patronymic);
  return short === full ? [short] : [short, full];
}
