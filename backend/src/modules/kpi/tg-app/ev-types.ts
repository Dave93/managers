// Ответы API оценщика в мини-приложении (/api/kpi/tg/ev/*). Файл без импортов:
// kpi_miniapp берёт его через import type и проверяет своим tsc.
// Периоды — "YYYY-MM-01", время — ISO 8601 UTC.
export type EvItemSource = "manual" | "attendance" | "cooking_speed" | "sales_plan" | "food_cost";
export type EvStatus = "none" | "draft" | "submitted" | "disputed";
// Причина выходного дня (выдаёт оценщик в мини-приложении).
export type DayOffReason = "sick" | "family" | "time_off" | "vacation" | "schedule" | "other";

export type EvErrorCode =
  | "not_evaluator" | "forbidden" | "out_of_scope" | "not_found" | "bad_id" | "bad_period" | "bad_status" | "no_card" | "no_items"
  | "period_closed" | "already_submitted" | "too_early" | "missing_items" | "note_required" | "bad_score" | "unknown_item"
  | "comment_required" | "photo_required" | "bad_photo_type" | "photo_too_large" | "too_many_photos"
  | "open_dispute" | "already_cancelled" | "dispute_closed" | "items_required" | "no_changes" | "bad_decision"
  | "bad_dates" | "bad_reason" | "reason_text_required";
export interface EvError { error: EvErrorCode; min?: number; opens_at?: string; item_id?: string; items?: string[] }

// GET /kpi/tg/ev/employees?period=YYYY-MM-01 (без period — отчётный месяц)
export interface EvEmployee {
  id: string; first_name: string; last_name: string; terminal_id: string; terminal_name: string | null;
  position: string | null; card_id: string | null; card_title: string | null;
  review_status: "none" | "draft" | "submitted";
  score_pct: number | null;   // только у отправленной
  late: boolean; open_dispute: boolean; can_evaluate: boolean;
}
export interface EvEmployees {
  period: string; period_status: "open" | "closed"; submit_opens_at: string; review_deadline: string;
  terminals: { id: string; name: string }[]; cards: { id: string; title: string }[];
  items: EvEmployee[];
}

// GET /kpi/tg/ev/form?period&employee_id; PUT /kpi/tg/ev/draft; POST /kpi/tg/ev/reviews/:id/submit
export interface EvFormViolation { id: string; occurred_at: string; comment: string }
export interface EvFormItem {
  item_id: string; title_ru: string; title_uz: string; hint_ru: string | null; weight: number; source: EvItemSource;
  group_key: "base" | "extra"; score: number | null; note: string | null;
  suggestion: { score: number; basis: string } | null;
  violations: EvFormViolation[]; violation_hint: number | null;
}
export interface EvReviewForm {
  period: string; period_status: "open" | "closed";
  employee: { id: string; first_name: string; last_name: string; terminal_name: string | null };
  card_title: string;
  review: { id: string; status: "draft" | "submitted"; score_pct: number | null; version: number; submitted_at: string | null; late: boolean } | null;
  items: EvFormItem[];
  other_violations: EvFormViolation[];
  can_edit: boolean;          // false у отправленной оценки: в приложении она только читается
  open_dispute: boolean; dispute_rejected: boolean;
  submit_opens_at: string; review_deadline: string;
}

// GET /kpi/tg/ev/violation-form?employee_id
export interface EvViolationForm {
  employee: { id: string; first_name: string; last_name: string; terminal_name: string | null };
  card_title: string | null;
  items: { id: string; title_ru: string; title_uz: string }[];   // активные пункты карты по sort
  photo_required: boolean; max_photos: number; max_photo_bytes: number; comment_min: number;
}
// POST /kpi/tg/ev/violations (multipart), GET /kpi/tg/ev/violations?period=, POST /kpi/tg/ev/violations/:id/cancel
export interface EvViolation {
  id: string; employee_id: string; employee_name: string; terminal_name: string | null;
  card_item_id: string | null; item_title_ru: string | null; period: string; occurred_at: string; comment: string;
  status: "active" | "cancelled"; cancel_reason: string | null; photo_ids: string[]; open_dispute: boolean;
  can_cancel: boolean;
}
export interface EvViolations { period: string; period_status: "open" | "closed"; items: EvViolation[] }

// GET /kpi/tg/ev/disputes?status=, GET /kpi/tg/ev/disputes/:id, POST /kpi/tg/ev/disputes/:id/resolve
export type EvDisputeSubject =
  | { kind: "review"; score_pct: number | null }
  | { kind: "violation"; item_title_ru: string | null; comment: string; photo_ids: string[] };
export interface EvDispute {
  id: string; subject_type: "review" | "violation"; subject_id: string;
  employee_id: string | null; employee_name: string | null; terminal_name: string | null; period: string;
  reason: string; status: "open" | "accepted" | "rejected"; resolution_comment: string | null;
  resolved_at: string | null; created_at: string; can_resolve: boolean;
  subject: EvDisputeSubject | null;
}
export interface EvDisputes { items: EvDispute[] }
export interface EvDisputeDetail { dispute: EvDispute; comment_min: number; form: EvReviewForm | null } // form — только у спора по оценке

// Выходные дни. POST /kpi/tg/ev/days-off, GET /kpi/tg/ev/days-off?period=, POST /kpi/tg/ev/days-off/:id/cancel,
// GET /kpi/tg/ev/day-off-form?employee_id. Причину сотрудник у себя не видит: эти типы только у оценщика.
export interface EvDayOff {
  id: string; employee_id: string; employee_name: string; terminal_name: string | null;
  day: string;                       // "YYYY-MM-DD"
  reason_code: DayOffReason; reason_text: string | null;   // текст только у "other"
  status: "active" | "cancelled"; can_cancel: boolean;
}
export interface EvDayOffForm {
  employee: { id: string; first_name: string; last_name: string; terminal_name: string | null };
  reasons: DayOffReason[];
  window: { min: string; max: string };   // выбираемые дни, включительно; закрытый месяц сервер всё равно отклонит
  max_range_days: number;
  month_limit: number;                    // мягкий лимит выходных сотрудника в месяц: превышение только предупреждает
  existing: string[];                     // дни сотрудника с активным выходным внутри окна
  submitted_months: string[];             // месяцы окна «YYYY-MM-01», где оценка сотрудника уже отправлена: её снимок выходной не пересчитает
}
// GET /kpi/tg/ev/days-off/employees: сотрудники филиалов оценщика для выдачи выходного (карта не важна)
export interface EvDayOffEmployee { id: string; first_name: string; last_name: string; terminal_id: string; terminal_name: string | null; position: string | null }
export interface EvDayOffEmployees { terminals: { id: string; name: string }[]; items: EvDayOffEmployee[] }
export interface EvDaysOffCreated { created: EvDayOff[]; skipped: string[] }   // skipped — дни, где выходной уже был
export interface EvDaysOff { period: string; period_status: "open" | "closed"; items: EvDayOff[] }

// GET /kpi/tg/ev/employees/:id/card?period=YYYY-MM-01 (без period — текущий месяц по Ташкенту).
// Справка об одном сотруднике из назначений оценщика: посещаемость, оценка, нарушения, история. Сумм прибавки
// и служебных признаков (Workly, Telegram) здесь нет: сервер их не отдаёт, а не прячет на экране.
export type EvCardDayStatus = "ontime" | "late" | "absent" | "dayoff";
// day "YYYY-MM-DD"; время HH:MM по Ташкенту; у прогула и выходного отметок и опоздания нет
export interface EvCardDay { day: string; status: EvCardDayStatus; late_minutes: number; check_in: string | null; check_out: string | null }
export interface EvCardMonth { period: string; state: "scored" | "pending" | "upcoming" | "not_rated"; score_pct: number | null }
export interface EvCard {
  employee: { id: string; first_name: string; last_name: string; position: string | null; terminal_name: string | null; tab_number: string | null; active: boolean; has_card: boolean };
  period: string;
  // prev и next — ближайшие месяцы «YYYY-MM-01» со строками посещаемости (текущий месяц достижим всегда); null — дальше нет
  months: { prev: string | null; next: string | null };
  days: EvCardDay[];
  review: {
    score_pct: number | null; status: "ready" | "dispute_open" | "dispute_resolved" | "changed";
    items: { title_ru: string; title_uz: string; score: number | null; note: string | null }[];
  } | null;
  violations: { id: string; item_title_ru: string | null; item_title_uz: string | null; occurred_at: string; comment: string; status: "active" | "cancelled" }[];
  history: { quarter_start: string; avg_pct: number | null; months: EvCardMonth[] }[];
}
