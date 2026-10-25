// Ошибки API KPI: код из тела ответа (`{ error: code }`) или из статуса, русские тексты.
// Роуты за макросом permission отвечают 401/403 телом `{ message }` — для них код берём из статуса.

export class KpiApiError extends Error {
  constructor(public status: number, public code: string, public body: Record<string, unknown>) {
    super(code);
    this.name = "KpiApiError";
  }
}

function asBody(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function toKpiError(status: number, value: unknown): KpiApiError {
  const body = asBody(value);
  let code: string;
  if (typeof body.error === "string" && body.error) code = body.error;
  else if (status === 401) code = "unauthorized";
  else if (status === 403) code = "forbidden";
  else if (status === 404) code = "not_found";
  else if (status === 422) code = "invalid_input";
  else if (status >= 500) code = "server_error";
  else code = `http_${status}`;
  return new KpiApiError(status, code, body);
}

export const KPI_ERROR_TEXT: Record<string, string> = {
  unauthorized: "Сессия истекла. Войдите заново",
  forbidden: "Нет прав на это действие",
  not_found: "Не найдено: запись удалена или недоступна вам",
  invalid_input: "Сервер не принял данные: проверьте поля формы",
  server_error: "Ошибка сервера. Повторите позже",
  network: "Нет связи с сервером. Проверьте интернет и повторите",
  bad_period: "Неверный месяц",
  unknown_setting: "Неизвестная настройка",
  bad_day: "День срока — целое число от 1 до 28",
  bad_value: "Значение настройки вне допустимого диапазона",
  dispute_before_review: "Срок споров не может быть раньше срока оценок",
  code_taken: "Карта с таким кодом уже есть",
  bad_weight: "Вес пункта — целое число от 1 до 100",
  bad_source: "Неизвестный источник пункта",
  scope_exists: "Такое назначение уже есть",
  out_of_scope: "Этот сотрудник не в ваших назначениях",
  no_card: "У сотрудника нет карты оценки",
  period_closed: "Месяц закрыт. Изменить может только HR",
  already_submitted: "Оценка уже отправлена. Обновите форму",
  too_early: "Отправка оценок за месяц открывается 20 числа",
  missing_items: "Не все обязательные пункты оценены",
  comment_required: "Нужен комментарий",
  no_changes: "Баллы не изменились",
  note_required: "Балл отличается от предложения: нужна заметка к пункту",
  bad_score: "Балл — целое число от 0 до 100",
  unknown_item: "Пункт не из карты сотрудника. Обновите форму",
  photo_required: "Нужна хотя бы одна фотография",
  bad_photo_type: "Фото только JPEG или PNG",
  photo_too_large: "Фото больше 10 МБ",
  too_many_photos: "Не больше 3 фотографий",
  bad_occurred_at: "Неверное время нарушения",
  already_cancelled: "Нарушение уже отменено",
  not_submitted: "Оспорить можно только отправленную оценку",
  dispute_window_closed: "Срок споров за этот месяц прошёл",
  dispute_exists: "По этой записи уже открыт спор",
  dispute_closed: "Спор уже разобран",
  dispute_window_open: "Окно споров ещё не закончилось, закрыть месяц пока нельзя",
  open_disputes: "Есть неразобранные споры за месяц",
  already_closed: "Месяц уже закрыт",
  bad_quarter: "Неверный квартал",
  periods_open: "Не все месяцы квартала закрыты",
  bad_amount: "Сумма вне допустимого диапазона",
  tier_pct_range: "Порог ступени — от 0 до 100 %",
  tier_amount_range: "Сумма ступени не может быть отрицательной",
  tier_amount_over_cap: "Сумма ступени больше потолка повышения",
  tier_pct_duplicate: "Пороги ступеней не должны повторяться",
  stale: "Оценки за квартал менялись после расчёта. Нажмите «Пересчитать»",
  open_dispute: "По записи открыт спор: изменить можно только через разбор спора",
  cap_below_tiers: "Потолок ниже суммы одной из ступеней. Сначала поправьте шкалу",
  no_items: "В карте нет активных пунктов",
  not_closed: "Месяц уже открыт",
  bad_code: "Код карты: латиница, цифры и _, до 40 символов",
  bad_title: "Название обязательно (до 300 символов)",
  bad_hint: "Подсказка слишком длинная",
  items_required: "Чтобы принять спор, измените баллы",
  unknown_card: "Карта не найдена или отключена",
  bad_id: "Неверный идентификатор",
  bad_comment: "Неверный комментарий",
};

export function codeText(code: string): string {
  return KPI_ERROR_TEXT[code] ?? `Ошибка сервера (${code})`;
}

export function kpiErrorText(e: unknown): string {
  if (e instanceof KpiApiError) {
    const base = codeText(e.code);
    if (e.code === "missing_items" && Array.isArray(e.body.items)) return `${base} (не хватает: ${e.body.items.length})`;
    if (e.code === "open_disputes" && Array.isArray(e.body.ids)) return `${base} (${e.body.ids.length})`;
    return base;
  }
  if (e instanceof Error) return e.message;
  return KPI_ERROR_TEXT.server_error;
}

/** Исход известен, если сервер ответил отказом 4xx. Сеть, таймаут и 5xx — неизвестен: действие могло пройти. */
export function outcomeKnown(e: unknown): boolean {
  return e instanceof KpiApiError && e.status >= 400 && e.status < 500;
}

export function shouldRetry(failureCount: number, e: unknown): boolean {
  if (e instanceof KpiApiError && e.status >= 400 && e.status < 500) return false;
  return failureCount < 2;
}
