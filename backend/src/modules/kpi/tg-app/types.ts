// Ответы API мини-приложения «Мой KPI» (/api/kpi/tg/*). Файл без импортов:
// kpi_miniapp берёт его через import type и проверяет своим tsc.
// Периоды — "YYYY-MM-01", время — ISO 8601 UTC, проценты и суммы — числа.

export type TgLang = "ru" | "uz";
export type TgRole = "employee" | "evaluator";
export type TgItemSource = "manual" | "attendance" | "cooking_speed" | "sales_plan" | "food_cost";

export type TgErrorCode =
  | "not_configured" | "bad_init_data" | "not_bound" | "inactive" | "unauthorized"
  | "not_employee" | "bad_period" | "bad_lang" | "not_found" | "bad_subject_type"
  | "comment_required" | "dispute_window_closed" | "dispute_exists" | "period_closed" | "already_cancelled";
export interface TgError { error: TgErrorCode; min?: number }

// POST /api/kpi/tg/auth
export interface TgAuthRequest { init_data: string }
export interface TgAuthResponse { token: string; roles: TgRole[]; lang: TgLang }

// PUT /api/kpi/tg/lang
export interface TgLangRequest { lang: TgLang }
export interface TgLangResponse { lang: TgLang }

export type TgReviewStatus = "ready" | "dispute_open" | "dispute_resolved" | "changed";
export type TgDisputeState = "can" | "open" | "window_closed" | "period_closed" | "cancelled";
export interface TgDisputeInfo {
  state: TgDisputeState;
  deadline: string;          // конец окна спора
  opened_at: string | null;  // только при state = "open"
  last_resolved: { decision: "accepted" | "rejected"; comment: string | null; resolved_at: string } | null;
}

export type TgMonthState = "scored" | "pending" | "upcoming" | "not_rated";
export interface TgMonth { period: string; state: TgMonthState; score_pct: number | null; opens_at: string }

export interface TgTier { min_pct: number; amount: number } // по возрастанию min_pct
export type TgNextTier =
  | { amount: number; reachable: true; need_pct: number; periods: string[] }
  | { amount: number; reachable: false };
export type TgRaiseHint =
  | { kind: "decided"; amount: number }       // 0 — «Без прибавки»
  | { kind: "waiting_hr"; amount: number }
  | { kind: "none" }
  | { kind: "too_few"; scored: number; min_months: number; keep_periods: string[]; amount: number; next: TgNextTier | null }
  | { kind: "running"; amount: number; keep: { need_pct: number; periods: string[] } | null; next: TgNextTier | null };
export interface TgRaiseCard { quarter_start: string; tiers: TgTier[]; avg_pct: number | null; months: TgMonth[]; hint: TgRaiseHint }

export interface TgLostItem { item_id: string; title_ru: string; title_uz: string; score: number }
export interface TgMonthCard { period: string; review_id: string; score_pct: number | null; status: TgReviewStatus; dispute: TgDisputeInfo; lost: TgLostItem[] }
export interface TgPendingMonth { period: string; submit_opens_at: string; review_deadline: string; violations: number }
export interface TgEvaluatorCard { period: string; pending: number; review_deadline: string; admin_url: string | null }

export interface TgEmployeeHome {
  first_name: string;
  last_name: string;
  position_ru: string | null;
  position_uz: string | null;
  terminal_name: string | null;
  has_card: boolean;
  pending: TgPendingMonth | null;   // отчётный месяц ещё не оценён
  month: TgMonthCard | null;        // главный оценённый месяц
  raise: TgRaiseCard | null;        // null без карты
  violations: { period: string; count: number };
  has_history: boolean;
}

// GET /api/kpi/tg/home
export interface TgHome { lang: TgLang; roles: TgRole[]; evaluator: TgEvaluatorCard | null; employee: TgEmployeeHome | null }

// GET /api/kpi/tg/review?period=YYYY-MM-01
export interface TgReviewItem { item_id: string; title_ru: string; title_uz: string; group_key: "base" | "extra"; score: number | null; source: TgItemSource; note: string | null }
export interface TgReviewChange { at: string; old_score_pct: number | null; new_score_pct: number | null; comment: string | null }
export interface TgReview {
  period: string; review_id: string; score_pct: number | null; status: TgReviewStatus; submitted_at: string;
  items: TgReviewItem[];      // сначала base, потом extra; внутри по sort карты
  changes: TgReviewChange[];  // события changed и hr_adjusted по времени
  dispute: TgDisputeInfo;
  reason_min: number;         // change_comment_min
}

// GET /api/kpi/tg/violations?period=YYYY-MM-01
export interface TgViolation {
  id: string; item_title_ru: string | null; item_title_uz: string | null; occurred_at: string; comment: string;
  status: "active" | "cancelled"; cancel_reason: string | null; photo_ids: string[]; dispute: TgDisputeInfo;
}
export interface TgViolations { period: string; items: TgViolation[]; reason_min: number } // новые сверху

// GET /api/kpi/tg/history
export type TgQuarterResult = { kind: "running" } | { kind: "waiting_hr" } | { kind: "decided"; amount: number };
export interface TgHistoryQuarter { quarter_start: string; months: TgMonth[]; avg_pct: number | null; result: TgQuarterResult }
export interface TgHistory { quarters: TgHistoryQuarter[] } // новые сверху, не больше 4

// POST /api/kpi/tg/disputes
export interface TgDisputeRequest { subject_type: "review" | "violation"; subject_id: string; reason: string }
export interface TgDisputeCreated { id: string; subject_type: "review" | "violation"; subject_id: string; created_at: string }

// GET /api/kpi/tg/violation-photos/:id/file — тело: файл image/jpeg или image/png
