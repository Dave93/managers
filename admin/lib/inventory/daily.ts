// «Дневные остатки»: короткое имя склада для таблицы — «21002 Новые сергили».
// Бренд и так виден по группе, а «Склад» повторяется в каждой строке.
const PREFIX_RE = /^(\d+)\s*-\s*Склад\s+(?:(?:Les|Chopar)\s+(?!Ailes\b))?/;

export function shortStoreName(name: string): string {
  return name.replace(PREFIX_RE, "$1 ");
}
