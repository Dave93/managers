import type { ItemSource, KpiSettings } from "./rules";

export type KpiPerm = "kpi_layout" | "kpi.evaluate" | "kpi.view" | "kpi.manage" | "kpi.approve";
export const KPI_PERMS: KpiPerm[] = ["kpi_layout", "kpi.evaluate", "kpi.view", "kpi.manage", "kpi.approve"];

export interface Deadlines {
  period: string;
  submit_opens_at: string;
  review_deadline: string;
  dispute_deadline: string;
}

export interface ScopeRow {
  id: string;
  user_id: string;
  user_name: string;
  card_id: string | null;
  card_title: string | null;
  terminal_id: string | null;
  terminal_name: string | null;
  created_at: string;
}

// Строка выбора пользователя (назначение оценщиков).
export interface KpiUserOption {
  id: string;
  name: string;
  login: string;
}

// Филиал в списке выбора экранов KPI.
export interface KpiTerminal {
  id: string;
  name: string;
}

export interface MeResponse {
  user_id: string;
  perms: KpiPerm[];
  is_hq: boolean;
  scopes: ScopeRow[];
  settings: KpiSettings;
  current_period: string;
  deadlines: Deadlines;
}

export interface CardItem {
  id: string;
  card_id: string;
  sort: number;
  title_ru: string;
  title_uz: string;
  hint_ru: string | null;
  hint_uz: string | null;
  source: ItemSource;
  weight: number;
  group_key: "base" | "extra";
  active: boolean;
}

export interface Card {
  id: string;
  code: string;
  title_ru: string;
  title_uz: string;
  staff_role_codes: string[];
  active: boolean;
  sort: number;
  items: CardItem[];
}

export interface EmployeeRow {
  id: string;
  first_name: string;
  last_name: string;
  terminal_id: string;
  terminal_name: string | null;
  staff_role_code: string | null;
  staff_role_name: string | null;
  active: boolean;
  external_id: string | null;
  card: { id: string; code: string; title_ru: string } | null;
  card_source: "override" | "role" | null;
  review: {
    id: string;
    status: "draft" | "submitted";
    score_pct: number | null;
    submitted_at: string | null;
    late: boolean;
  } | null;
  open_dispute: boolean;
  can_evaluate: boolean;
}

export interface ViolationRow {
  id: string;
  terminal_id: string;
  terminal_name: string | null;
  employee_id: string;
  employee_name: string;
  card_item_id: string | null;
  item_title_ru: string | null;
  period: string;
  occurred_at: string;
  comment: string;
  recorded_by: string;
  recorded_by_name: string | null;
  status: "active" | "cancelled";
  cancel_reason: string | null;
  photos: { id: string }[];
  open_dispute: boolean;
  // По нарушению уже отклонили спор: повторный нельзя (план 8).
  dispute_rejected: boolean;
  created_at: string;
}

export interface ReviewFormItem {
  item_id: string;
  title_ru: string;
  title_uz: string;
  hint_ru: string | null;
  weight: number;
  source: ItemSource;
  group_key: "base" | "extra";
  score: number | null;
  note: string | null;
  suggestion: { score: number; basis: string } | null;
  violations: ViolationRow[];
  violation_hint: number | null;
}

export interface ReviewForm {
  period: string;
  period_status: "open" | "closed";
  employee: { id: string; first_name: string; last_name: string; terminal_id: string; terminal_name: string | null };
  card: { id: string; code: string; title_ru: string };
  review: {
    id: string;
    status: "draft" | "submitted";
    score_pct: number | null;
    version: number;
    submitted_at: string | null;
    evaluator_user_id: string;
    late: boolean;
  } | null;
  items: ReviewFormItem[];
  other_violations: ViolationRow[];
  can_edit: boolean;
  needs_comment: boolean;
  // Есть открытый спор по этой оценке.
  open_dispute: boolean;
  // По оценке уже отклонили спор: повторный нельзя (план 8).
  dispute_rejected: boolean;
  deadlines: Deadlines;
}

export interface ReviewEvent {
  id: string;
  kind: string;
  actor_kind: string;
  actor_name: string | null;
  changes: { item_id: string; title_ru: string; old: number | null; new: number | null }[];
  old_score_pct: number | null;
  new_score_pct: number | null;
  comment: string | null;
  created_at: string;
}

export interface DisputeRow {
  id: string;
  subject_type: "review" | "violation";
  subject_id: string;
  employee_id: string | null;
  employee_name: string | null;
  terminal_name: string | null;
  period: string;
  opened_via: "admin" | "telegram" | "miniapp";
  reason: string;
  status: "open" | "accepted" | "rejected";
  resolution_comment: string | null;
  resolved_by_name: string | null;
  resolved_at: string | null;
  created_at: string;
  can_resolve: boolean;
}

export interface PeriodSummary {
  period: string;
  status: "open" | "closed";
  closed_at: string | null;
  closed_by_name: string | null;
  deadlines: Deadlines;
  counts: { employees: number; submitted: number; drafts: number; none: number; late: number; open_disputes: number };
  lagging: { user_id: string; user_name: string; pending: number }[];
  // Без отправленной оценки и без оценщика; только для approve/manage, иначе 0.
  unassigned: number;
  can_close: boolean;
  close_blockers: string[];
}

export type { Tier } from "./rules";

export interface RaiseRow {
  id: string;
  quarter_start: string;
  employee_id: string;
  employee_name: string;
  terminal_name: string | null;
  card_title: string | null;
  months: { period: string; score_pct: number | null }[];
  months_scored: number;
  avg_pct: number | null;
  suggested_amount: number;
  status: "proposed" | "insufficient" | "approved" | "rejected";
  approved_amount: number | null;
  decided_by_name: string | null;
  decided_at: string | null;
  comment: string | null;
  periods_closed: boolean;
  // Отправленную оценку квартала меняли после расчёта: нерешённую строку решить нельзя
  // (409 stale) до пересчёта; у решённой это только предупреждение.
  stale: boolean;
}

// Импорт посещаемости Workly (разбор файла: attendance-parse.ts)
export type AttendanceField = "external_id" | "date" | "check_in" | "check_out" | "late_minutes" | "absent";
export type AttendanceMapping = { external_id: number; date: number; check_in?: number; check_out?: number; late_minutes?: number; absent?: number };
export type UnmatchedReason =
  | "no_external_id"
  | "bad_date"
  | "outside_period"
  | "bad_time"
  | "bad_late"
  | "unknown_external_id"
  | "ambiguous_external_id"
  | "duplicate_day"
  | "not_working_day"
  | "no_marks";
export interface UnmatchedRow { row: number; external_id: string | null; reason: UnmatchedReason }
export interface AttendanceSheetPreview { name: string; header_row: number; headers: string[]; rows: string[][]; total_rows: number }
// Итоги по сопоставленным дням: присутствие, из них с опозданием, прогулы
export interface AttendanceTotals { days_present: number; days_late: number; days_absent: number }

export interface AttendanceParseResponse { token: string; file_name: string; expires_at: string; sheets: AttendanceSheetPreview[] }
export interface AttendanceImportRow extends AttendanceTotals {
  id: string; period: string; file_name: string; uploaded_by: string; uploaded_by_name: string | null;
  sheet: string; header_row: number; mapping: AttendanceMapping;
  rows_total: number; rows_matched: number; rows_unmatched: number; unmatched: UnmatchedRow[];
  status: "committed" | "replaced"; created_at: string;
}

// Telegram: приглашения и привязки
export interface KpiInvite { token: string; link: string; expires_at: string }
export interface TgBindingRow { id: string; employee_id: string | null; user_id: string | null; lang: "ru" | "uz"; active: boolean; created_at: string }

// Балл филиала (фаза 5)
export type BranchIndicatorCode = "sales" | "food_cost" | "service" | "sanitary" | "discipline";
export type BranchDirection = "higher_better" | "lower_better";
export type NoDataReason =
  | "not_computed"
  | "no_iiko_link"
  | "no_plan"
  | "no_orders"
  | "no_store"
  | "no_reconciliation"
  | "not_accepted"
  | "no_iiko_document"
  | "no_cooking_rows"
  | "no_checks"
  | "no_attendance";
export interface BranchIndicator { code: BranchIndicatorCode; title_ru: string; weight: number; floor: number; target: number; max: number; direction: BranchDirection; active: boolean; sort: number }
export interface BranchSettings { service_norm_hall_min: number; service_norm_delivery_min: number; sanitary_items: string[] }
export interface BranchConfig { indicators: BranchIndicator[]; settings: BranchSettings }
export interface SanitaryItem { title: string; ok: boolean }
export interface SanitaryTemplate { items: string[] }
export interface SanitaryCheckRow { id: string; terminal_id: string; terminal_name: string | null; period: string; checked_at: string; inspector_user_id: string; inspector_name: string | null; items: SanitaryItem[]; pct: number; comment: string | null; created_at: string }
export interface RevenuePlanRow { terminal_id: string; terminal_name: string | null; amount: number | null; has_iiko: boolean; updated_at: string | null }
export interface RevenueSuggestRow { terminal_id: string; base_period: string; base_revenue: number | null; suggested: number | null }
export interface BranchCell { fact: number | null; points: number | null; weight: number; data_status: "ok" | "no_data" }
export interface BranchScoreRow { terminal_id: string; terminal_name: string | null; score: number; tier_pct: number; cells: Partial<Record<BranchIndicatorCode, BranchCell>> }
// preliminary: версия посчитана до конца месяца. columns: коды показателей версии в порядке текущего sort
export interface BranchNetwork { period: string; version: number | null; computed_at: string | null; preliminary: boolean; indicators: BranchIndicator[]; columns: BranchIndicatorCode[]; rows: BranchScoreRow[] }
export interface BranchIndicatorResult { code: BranchIndicatorCode; title_ru: string; direction: BranchDirection; weight: number; floor: number; target: number; max: number; fact: number | null; points: number | null; weighted: number | null; data_status: "ok" | "no_data"; reason: NoDataReason | null; details: Record<string, number | null> }
export interface BranchBreakdown { period: string; terminal_id: string; terminal_name: string | null; version: number | null; computed_at: string | null; preliminary: boolean; score: number | null; tier_pct: number | null; next_tier: { tier_pct: number; points_needed: number } | null; indicators: BranchIndicatorResult[]; sanitary_checks: SanitaryCheckRow[] }
export interface BranchComputeResult { period: string; version: number | null; terminals: number; computed_at: string }
