// Клиентский слой модуля инвентаризаций.
//
// Роуты /api/inventory/* живут на inventoryControllerImpl, экспортированном
// как `as unknown as Elysia` (TS2589, см. backend/src/app.ts), поэтому Eden
// их типы не выводит. Типы ответов берём из backend/src/modules/inventory/types.ts
// (`import type` — в бандл ничего не попадает). Один `as any` на весь модуль.

import { apiClient } from "@admin/utils/eden";
import type {
  InventoryStartOptions,
  InventoryCountDetail,
  InventoryCountSummary,
  InventoryFolders,
  InventoryOverviewRow,
  InventoryProduct,
  InventoryStore,
  InventorySuggestion,
  InventorySyncOp,
  InventorySyncResult,
  InventoryTemplateDetail,
  InventoryTemplateSummary,
} from "@backend/modules/inventory/types";
import { normalizeDates } from "@admin/lib/inventory/normalize";

export class InventoryApiError extends Error {
  constructor(public status: number, public body: any) {
    super(typeof body?.error === "string" ? body.error : typeof body === "string" ? body : `HTTP ${status}`);
  }
}

// Eden не бросает на 4xx — он возвращает { data, error }. Без этой проверки
// react-query посчитал бы 409/422 успехом.
async function call<T>(p: Promise<any>): Promise<T> {
  const res = await p;
  if (res?.error) throw new InventoryApiError(res.error.status ?? res.status ?? 0, res.error.value ?? res.error);
  // Eden превращает строки дат в Date — возвращаем их строками (см. normalize.ts).
  return normalizeDates(res?.data) as T;
}

const inv = (apiClient.api as any).inventory;

export const inventoryApi = {
  stores: () => call<InventoryStore[]>(inv.stores.get()),
  periods: () => call<{ periods: string[] }>(inv.periods.get()),
  availableTemplates: (storeId: string) =>
    call<InventoryStartOptions>(inv.templates.available.get({ query: { store_id: storeId } })),
  listCounts: (storeId: string) => call<InventoryCountSummary[]>(inv.counts.get({ query: { store_id: storeId } })),
  /** Без template_id — «Все товары филиала». */
  createCount: (body: { store_id: string; template_id?: string; period: string }) =>
    call<{ id: string; existing: boolean }>(inv.counts.post(body)),
  getCount: (id: string) => call<InventoryCountDetail>(inv.counts({ id }).get()),
  sync: (id: string, ops: InventorySyncOp[]) => call<InventorySyncResult>(inv.counts({ id }).entries.sync.post({ ops })),
  addLine: (id: string, productId: string) =>
    call<{ line_id: string; created: boolean }>(inv.counts({ id }).lines.post({ product_id: productId })),
  setSkipped: (id: string, lineId: string, skipped: boolean) =>
    call<{ ok: true }>(inv.counts({ id }).lines({ lineId }).patch({ skipped })),
  submit: (id: string, skipIncomplete: boolean) =>
    call<{ ok: true }>(inv.counts({ id }).submit.post({ skip_incomplete: skipIncomplete })),
  reopen: (id: string) => call<{ ok: true }>(inv.counts({ id }).reopen.post({})),
  cancel: (id: string) => call<{ ok: true }>(inv.counts({ id }).cancel.post({})),
  products: (q: string, countId?: string) =>
    call<InventoryProduct[]>(
      inv.products.get({ query: countId ? { q, limit: "20", count_id: countId } : { q, limit: "20" } })
    ),
  overview: (period: string, organizationId?: string) =>
    call<InventoryOverviewRow[]>(
      inv.overview.get({ query: organizationId ? { period, organization_id: organizationId } : { period } })
    ),
  organizations: () => call<{ id: string; name: string }[]>(inv.organizations.get()),
  folders: () => call<InventoryFolders>(inv.folders.get()),
  templates: {
    list: (organizationId?: string) =>
      call<InventoryTemplateSummary[]>(
        inv.templates.get({ query: organizationId ? { organization_id: organizationId } : {} })
      ),
    get: (id: string) => call<InventoryTemplateDetail>(inv.templates({ id }).get()),
    create: (input: { organization_id: string; name: string }) => call<{ id: string }>(inv.templates.post(input)),
    update: (id: string, patch: { name?: string; active?: boolean; sort?: number }) =>
      call<{ ok: true }>(inv.templates({ id }).patch(patch)),
    remove: (id: string) => call<{ ok: true }>(inv.templates({ id }).delete()),
    setItems: (id: string, productIds: string[]) =>
      call<{ items_count: number }>(inv.templates({ id }).items.put({ product_ids: productIds })),
    suggestions: (id: string) => call<InventorySuggestion[]>(inv.templates({ id }).suggestions.get()),
  },
};
