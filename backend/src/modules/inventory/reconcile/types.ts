// Типы ответов сверки инвентаризаций с iiko. Без импортов: admin подключает файл
// через `import type` из @backend/modules/inventory/reconcile/types, а контроллер
// инвентаризаций экспортирован как `as unknown as Elysia` — Eden эти типы не выведет.
// numeric приходит строкой.

export type ReconStatus = "waiting_iiko" | "needs_choice" | "ready" | "in_review" | "accepted";
export type ReconAdminState = "submitted" | "draft" | "none";
export type ReconLineAdminState = "counted" | "skipped" | "absent";
export type ReconDocState = "posted" | "unposted_after_fetch";

export interface ReconCandidate {
  id: string;
  num: string;
  comment: string | null;
  date: string;
  shortage_sum: number;
  surplus_sum: number;
}

export interface ReconTotals {
  lines_total: number;
  mismatch_ab_count: number;
  diff_ab_sum: string | null;
  diff_ac_sum: string | null;
  diff_bc_sum: string | null;
}

export interface ReconOverviewRow extends ReconTotals {
  id: string;
  store_id: string;
  store_name: string;
  organization_id: string | null;
  period: string;
  status: ReconStatus;
  /** Живое состояние пересчётов админки за период (не снимок). */
  admin_state: ReconAdminState;
  /** Срок ввода периода, ISO UTC — для «не сдано». */
  deadline: string;
  iiko_document_num: string | null;
  iiko_document_comment: string | null;
  iiko_doc_state: ReconDocState | null;
  changed_after_accept: boolean;
  fetched_at: string | null;
  calculated_at: string | null;
}

export interface ReconLine {
  product_id: string;
  product_name: string;
  unit_name: string | null;
  group_name: string;
  admin_state: ReconLineAdminState;
  admin_qty: string | null;
  admin_counts_n: number;
  book_qty: string;
  iiko_correction_qty: string;
  iiko_correction_sum: string;
  iiko_fact_qty: string | null;
  unit_cost: string | null;
  cost_source: "correction" | "balance" | null;
  diff_ab_qty: string | null;
  diff_ab_sum: string | null;
  diff_ac_sum: string | null;
}

export interface ReconEvent {
  id: string;
  type: string;
  user_name: string | null;
  payload: any;
  created_at: string;
}

export type ReconBranchEditKind = "entry_added" | "entry_deleted" | "reopened" | "unlocked";

export interface ReconBranchEdit {
  at: string;
  kind: ReconBranchEditKind;
  user_name: string;
  count_id: string;
  product_name: string | null;
  qty: string | null;
}

export interface ReconCountRef {
  id: string;
  template_name: string;
  status: string;
  unlocked_until: string | null;
  input_open: boolean;
}

export interface ReconDetail extends ReconOverviewRow {
  iiko_document_id: string | null;
  iiko_document_at: string | null;
  book_at: string | null;
  iiko_candidates: ReconCandidate[] | null;
  review_comment: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  accepted_totals: ReconTotals | null;
  counts: ReconCountRef[];
  lines: ReconLine[];
  events: ReconEvent[];
  branch_edits: ReconBranchEdit[];
}

export type ReconFetchState = "idle" | "queued" | "stage1" | "stage2" | "done" | "failed";

export interface ReconFetchStatus {
  period: string;
  store_id: string | null;
  state: ReconFetchState;
  started_at: string | null;
  stage1_done_at: string | null;
  finished_at: string | null;
  received: { store_id: string; store_name: string; num: string }[];
  missing: { store_id: string; store_name: string }[];
  error: string | null;
}
