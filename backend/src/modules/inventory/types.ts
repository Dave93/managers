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
  /** null — «Все товары филиала» (без шаблона). */
  template_id: string | null;
  template_name: string;
  period: string;
  status: InventoryCountStatus;
  /** Строки построены как шаблон ∩ товары филиала из exord. */
  exord_filtered: boolean;
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

/** Шаблон в окне «Начать»: сколько позиций попадёт в пересчёт этого склада. */
export interface InventoryAvailableTemplate extends InventoryTemplateSummary {
  items_for_store: number;
  exord_filtered: boolean;
}

/** Ответ GET /inventory/templates/available. */
export interface InventoryStartOptions {
  /** «Все товары филиала»: доступно, только если у склада есть список exord. */
  branch: { available: boolean; items_for_store: number };
  templates: InventoryAvailableTemplate[];
}

export interface InventoryTemplateDetail extends InventoryTemplateSummary {
  product_ids: string[];
}

export interface InventoryProduct {
  id: string;
  name: string;
  unit_name: string | null;
  group_name: string;
  /** Поиск в инвентаризации с фильтром exord: товар филиала или нет. null — без фильтра. */
  in_branch: boolean | null;
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
  /** Есть связь склада с филиалом и список товаров филиала в exord. */
  exord: boolean;
  counts: InventoryCountSummary[];
}

export interface InventoryErrorBody {
  error: string;
  [k: string]: unknown;
}

export interface ExordStoreRow {
  exord_user_id: number;
  name: string;
  terminal_iiko_id: string | null;
  product_count: number;
  /** Куда магазин попал при последнем синке. */
  terminal_id: string | null;
  terminal_name: string | null;
  source: "iiko" | "override" | null;
  /** Сохранённое ручное сопоставление (применится при ближайшем синке). */
  override_terminal_id: string | null;
}

export interface ExordStoresResponse {
  synced_at: string | null;
  stores: ExordStoreRow[];
  terminals: { id: string; name: string }[];
}

