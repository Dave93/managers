// Общие типы ответов модуля inventory. Без импортов: admin подключает файл
// через `import type` из @backend/modules/inventory/types, а контроллер
// экспортирован как `as unknown as Elysia`, так что Eden эти типы не выведет.

export type InventoryCountStatus = "draft" | "submitted" | "cancelled";
export type InventoryAccess = "write" | "read";

export interface InventoryStore {
  id: string;
  name: string;
  organization_id: string | null;
}

export interface InventoryEntry {
  id: string;
  line_id: string;
  qty: string;
  created_by: string;
  created_by_name: string;
  client_created_at: string;
}

export interface InventoryLine {
  id: string;
  product_id: string;
  product_name: string;
  unit_name: string | null;
  group_id: string | null;
  group_name: string;
  source: "template" | "added";
  skipped: boolean;
  fact_qty: string | null;
  /** Сумма живых записей, строкой numeric ("0" если записей нет). */
  total: string;
  entries: InventoryEntry[];
}

export interface InventoryCountSummary {
  id: string;
  store_id: string;
  store_name: string;
  template_id: string;
  template_name: string;
  period: string;
  status: InventoryCountStatus;
  created_at: string;
  submitted_at: string | null;
  submitted_by_name: string | null;
  lines_total: number;
  lines_done: number;
  participants: string[];
}

export interface InventoryCountDetail extends InventoryCountSummary {
  /** Текущий пользователь: фронт помечает «мои» записи и фильтр «Мои». */
  viewer_id: string;
  access: InventoryAccess;
  can_manage: boolean;
  can_reopen: boolean;
  lines: InventoryLine[];
}

export type InventorySyncOp =
  | { op: "add"; id: string; line_id: string; qty: number; client_created_at: string }
  | { op: "delete"; id: string };

export type InventorySyncRejectReason = "not_found_line" | "forbidden" | "invalid_qty" | "invalid_id";

export interface InventorySyncResult {
  applied: string[];
  rejected: { id: string; reason: InventorySyncRejectReason }[];
}

export interface InventoryTemplateSummary {
  id: string;
  organization_id: string;
  organization_name: string | null;
  name: string;
  active: boolean;
  sort: number;
  items_count: number;
}

export interface InventoryTemplateDetail extends InventoryTemplateSummary {
  product_ids: string[];
}

export interface InventoryProduct {
  id: string;
  name: string;
  unit_name: string | null;
  group_name: string;
}

export interface InventoryFolders {
  groups: { id: string; name: string; parent_id: string | null }[];
  products: { id: string; name: string; unit_name: string | null; parent_id: string | null }[];
}

export interface InventorySuggestion {
  product_id: string;
  product_name: string;
  times: number;
}

export interface InventoryOverviewRow {
  store_id: string;
  store_name: string;
  organization_id: string | null;
  counts: InventoryCountSummary[];
}

export interface InventoryErrorBody {
  error: string;
  [k: string]: unknown;
}
