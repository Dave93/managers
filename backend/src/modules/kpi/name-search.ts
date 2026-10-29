// Поиск сотрудника по ФИО: все слова запроса в любом порядке, без учёта регистра, «ё» = «е».
// Ищем в JS: ilike в базе с локалью C не сворачивает регистр кириллицы.

const fold = (s: string): string => s.toLowerCase().replace(/ё/g, "е");

export function searchWords(query: string): string[] {
  return fold(query).split(/\s+/).filter(Boolean);
}

/** Каждое слово — часть имени или фамилии. Слово без пробелов не склеится из конца имени и начала фамилии. */
export function matchesName(words: readonly string[], r: { first_name: string; last_name: string }): boolean {
  if (words.length === 0) return true;
  const hay = fold(`${r.first_name} ${r.last_name}`);
  return words.every((w) => hay.includes(w));
}
