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
