import type { KpiSettings } from "./rules";

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
