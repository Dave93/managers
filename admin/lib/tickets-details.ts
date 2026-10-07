// Чтение значения поля заявки из details по ключу схемы.
//
// Ключ схемы подчиняется только правилу snake_case, поэтому им может оказаться
// «constructor», «toString» или «__proto__». details[key] для такого ключа
// вернул бы функцию из Object.prototype, и карточка напечатала бы текст
// нативной функции вместо «—». Значения заявки лежат собственными свойствами,
// их и читаем.
export function detailValue(details: Record<string, unknown> | null | undefined, key: string): unknown {
  if (!details || typeof details !== "object") return undefined;
  return Object.prototype.hasOwnProperty.call(details, key) ? details[key] : undefined;
}
