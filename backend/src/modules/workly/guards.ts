// Предохранители ночного прогона Workly. Чистая функция: ни базы, ни сети, ни env.
// Ручной «Применить» их не вызывает: человек видел план и сам решил его применить.
// Ночной прогон применяет план без человека, поэтому перед применением сверяет план
// с прошлым успешно применённым прогоном и при любом подозрении останавливается.

export type BlockReason =
  | "first_run"
  | "empty_crawl"
  | "crawl_short"
  | "too_many_deactivations"
  | "too_many_creations";

export interface GuardInput {
  /** Сколько сотрудников план деактивирует. */
  deactivations: number;
  /** Сколько новых сотрудников план создаёт. */
  creations: number;
  /** Сколько активных сотрудников сейчас в организации у нас. */
  orgActive: number;
  /** Сколько активных сотрудников вернул обход Workly в этом прогоне. */
  activeFetched: number;
  /** Прошлый успешно применённый прогон; null, если его ещё не было. */
  lastApplied: { activeFetched: number } | null;
}

export type GuardResult = { ok: true } | { ok: false; reason: BlockReason };

// Обход короче 90% от прошлого применённого считается неполным.
const CRAWL_SHORT_RATIO = 0.9;
// Деактиваций можно не больше 10% активных, но не меньше 10 штук (для маленьких организаций).
const DEACTIVATION_SHARE = 0.1;
const DEACTIVATION_FLOOR = 10;
// Новых сотрудников за один ночной прогон не больше 50.
const MAX_CREATIONS = 50;

// Порядок проверок важен: reason пишется в журнал прогона, и первой должна
// называться самая «грубая» причина. Все сравнения строгие, пороги не округляются.
export function checkGuards(i: GuardInput): GuardResult {
  // Без прошлого применённого прогона сравнивать не с чем: первый прогон применяет человек.
  if (!i.lastApplied) return { ok: false, reason: "first_run" };

  // Пустой обход: Workly не отдал ни одного активного. Скорее сбой, чем массовое увольнение.
  if (i.activeFetched === 0) return { ok: false, reason: "empty_crawl" };

  // Обход заметно короче прошлого: часть списка, скорее всего, не дочитана.
  if (i.activeFetched < CRAWL_SHORT_RATIO * i.lastApplied.activeFetched) {
    return { ok: false, reason: "crawl_short" };
  }

  if (i.deactivations > Math.max(DEACTIVATION_FLOOR, DEACTIVATION_SHARE * i.orgActive)) {
    return { ok: false, reason: "too_many_deactivations" };
  }

  if (i.creations > MAX_CREATIONS) return { ok: false, reason: "too_many_creations" };

  return { ok: true };
}
