// Клиентский слой KPI сотрудников.
//
// Роуты /api/kpi/* живут на kpiControllerImpl, экспортированном как
// `as unknown as Elysia` (TS2589, см. backend/src/app.ts), поэтому Eden их типы
// не выводит. Типы ответов берём из backend/src/modules/kpi/types.ts и rules.ts
// (`import type` — в бандл ничего не попадает). Один `as any` на весь модуль.
// Ошибки: тело `{ error: code }`; роуты за макросом permission отвечают
// `{ message }` на 401/403, поэтому код для них берётся из статуса (см. kpi/errors.ts).

import { apiClient } from "@admin/utils/eden";
import { normalizeDates } from "@admin/lib/inventory/normalize";
import { KpiApiError, toKpiError } from "@admin/lib/kpi/errors";
import type {
  Card,
  DisputeRow,
  EmployeeRow,
  KpiUserOption,
  MeResponse,
  PeriodSummary,
  RaiseRow,
  ReviewEvent,
  ReviewForm,
  ScopeRow,
  Tier,
  ViolationRow,
} from "@backend/modules/kpi/types";
import type { ItemSource, KpiSettings } from "@backend/modules/kpi/rules";

export type {
  Card,
  CardItem,
  Deadlines,
  DisputeRow,
  EmployeeRow,
  MeResponse,
  PeriodSummary,
  RaiseRow,
  ReviewEvent,
  ReviewForm,
  ReviewFormItem,
  ScopeRow,
  Tier,
  ViolationRow,
} from "@backend/modules/kpi/types";
export type { ItemSource, KpiSettings } from "@backend/modules/kpi/rules";
export type { KpiUserOption } from "@backend/modules/kpi/types";

export type KpiItemInput = { item_id: string; score: number | null; note: string | null };
export type RowStatusFilter = "none" | "draft" | "submitted" | "disputed";
export type EmployeesQuery = { period: string; terminal_id?: string; card_id?: string; status?: RowStatusFilter; search?: string; include_uncarded?: boolean };
export type ViolationsQuery = { period?: string; terminal_id?: string; employee_id?: string; status?: "active" | "cancelled" };
export type DisputesQuery = { status?: "open" | "accepted" | "rejected"; period?: string };
export type CardCreate = { code: string; title_ru: string; title_uz: string; staff_role_codes: string[]; sort?: number };
export type CardPatch = { title_ru?: string; title_uz?: string; staff_role_codes?: string[]; active?: boolean; sort?: number };
export type ItemCreate = {
  title_ru: string;
  title_uz: string;
  hint_ru?: string;
  hint_uz?: string;
  source: ItemSource;
  weight: number;
  group_key: "base" | "extra";
  sort?: number;
};
export type ItemPatch = Partial<ItemCreate> & { active?: boolean };
export type ScopeCreate = { user_id: string; card_id: string | null; terminal_id: string | null };
export type ResolveBody = { decision: "accepted" | "rejected"; comment: string; items?: KpiItemInput[] };
export type DecideBody = { status: "approved" | "rejected"; amount?: number; comment?: string };

// Eden не бросает на 4xx — он возвращает { data, error }. Без этой проверки
// react-query посчитал бы 409/422 успехом.
async function call<T>(p: Promise<any>): Promise<T> {
  let res: any;
  try {
    res = await p;
  } catch (e) {
    // treaty не ловит отказ fetch: офлайн приходит сырым TypeError.
    throw e instanceof KpiApiError ? e : new KpiApiError(0, "network", {});
  }
  if (res?.error) throw toKpiError(res.error.status ?? res.status ?? 0, res.error.value ?? res.error);
  // Eden превращает строки дат в Date — возвращаем их строками (см. inventory/normalize.ts).
  return normalizeDates(res?.data) as T;
}

/** Query без пустых значений: undefined, null, "" и false выбрасываются, true → "1". Порядок ключей сохраняется. */
function compact(obj: Record<string, string | number | boolean | null | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === "" || v === false) continue;
    out[k] = v === true ? "1" : String(v);
  }
  return out;
}

/** `{ query }` для Eden; пустой query не передаётся. */
function q(obj: Record<string, string | number | boolean | null | undefined>): { query: Record<string, string> } | undefined {
  const query = compact(obj);
  return Object.keys(query).length ? { query } : undefined;
}

export function createKpiApi(kpi: any) {
  return {
    me: () => call<MeResponse>(kpi.me.get()),
    settings: {
      get: () => call<KpiSettings>(kpi.settings.get()),
      save: (patch: Partial<KpiSettings>) => call<KpiSettings>(kpi.settings.put(patch)),
    },
    cards: {
      list: (includeInactive?: boolean) => call<Card[]>(kpi.cards.get(q({ include_inactive: includeInactive }))),
      create: (b: CardCreate) => call<unknown>(kpi.cards.post(b)),
      update: (id: string, b: CardPatch) => call<unknown>(kpi.cards({ id }).put(b)),
      addItem: (cardId: string, b: ItemCreate) => call<unknown>(kpi.cards({ id: cardId }).items.post(b)),
      updateItem: (itemId: string, b: ItemPatch) => call<unknown>(kpi.items({ id: itemId }).put(b)),
    },
    evaluators: {
      list: () => call<ScopeRow[]>(kpi.evaluators.get()),
      create: (b: ScopeCreate) => call<unknown>(kpi.evaluators.post(b)),
      remove: (id: string) => call<unknown>(kpi.evaluators({ id }).delete()),
    },
    users: (search: string) => call<KpiUserOption[]>(kpi.users.get({ query: { search } })),
    employees: {
      list: (query: EmployeesQuery) => call<EmployeeRow[]>(kpi.employees.get(q(query))),
      setCard: (id: string, cardId: string | null | "auto", comment?: string) =>
        call<unknown>(kpi.employees({ id }).card.put(comment && comment.trim() ? { card_id: cardId, comment } : { card_id: cardId })),
    },
    reviews: {
      form: (period: string, employeeId: string) =>
        call<ReviewForm>(kpi.reviews.form.get({ query: { period, employee_id: employeeId } })),
      saveDraft: (period: string, employeeId: string, items: KpiItemInput[]) =>
        call<ReviewForm>(kpi.reviews.draft.put({ period, employee_id: employeeId, items })),
      submit: (reviewId: string, items?: KpiItemInput[]) =>
        call<ReviewForm>(kpi.reviews({ id: reviewId }).submit.post(items ? { items } : {})),
      change: (reviewId: string, items: KpiItemInput[], comment: string) =>
        call<ReviewForm>(kpi.reviews({ id: reviewId }).put({ items, comment })),
      events: (reviewId: string) => call<ReviewEvent[]>(kpi.reviews({ id: reviewId }).events.get()),
    },
    violations: {
      list: (query: ViolationsQuery) => call<ViolationRow[]>(kpi.violations.get(q(query))),
      cancel: (id: string, reason: string) => call<ViolationRow>(kpi.violations({ id }).cancel.post({ reason })),
    },
    disputes: {
      list: (query: DisputesQuery) => call<DisputeRow[]>(kpi.disputes.get(q(query))),
      open: (b: { subject_type: "review" | "violation"; subject_id: string; reason: string }) =>
        call<DisputeRow>(kpi.disputes.post(b)),
      resolve: (id: string, b: ResolveBody) => call<DisputeRow>(kpi.disputes({ id }).resolve.post(b)),
    },
    periods: {
      get: (p: string) => call<PeriodSummary>(kpi.periods({ period: p }).get()),
      close: (p: string) => call<PeriodSummary>(kpi.periods({ period: p }).close.post({})),
      reopen: (p: string, comment: string) => call<PeriodSummary>(kpi.periods({ period: p }).reopen.post({ comment })),
    },
    raises: {
      list: (quarter: string) => call<RaiseRow[]>(kpi.raises.get({ query: { quarter } })),
      compute: (quarter: string) => call<RaiseRow[]>(kpi.raises.compute.post({ quarter })),
      decide: (id: string, b: DecideBody) => call<RaiseRow>(kpi.raises({ id }).decide.post(b)),
    },
    tiers: {
      get: () => call<Tier[]>(kpi["raise-tiers"].get()),
      save: (tiers: Tier[]) => call<Tier[]>(kpi["raise-tiers"].put({ tiers })),
    },
  };
}

export type KpiApi = ReturnType<typeof createKpiApi>;

export const kpiApi: KpiApi = createKpiApi((apiClient.api as any).kpi);

export function photoUrl(photoId: string): string {
  return `/api/kpi/violation-photos/${photoId}/file`;
}

const VIOLATION_TIMEOUT_MS = 120_000;

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

// Multipart идёт обычным fetch: Eden не умеет FormData с файлами надёжно, а код ошибки
// здесь читается из body.error (у tickets — из body.message).
export async function postViolation(body: FormData, fetcher: typeof fetch = fetch): Promise<ViolationRow> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), VIOLATION_TIMEOUT_MS);
  try {
    let res: Response;
    try {
      res = await fetcher("/api/kpi/violations", { method: "POST", body, credentials: "include", signal: ctrl.signal });
    } catch {
      throw new KpiApiError(0, "network", {});
    }
    const json = await readJson(res);
    if (ctrl.signal.aborted) throw new KpiApiError(0, "network", {});
    if (!res.ok) throw toKpiError(res.status, json);
    if (json === null) throw new KpiApiError(res.status, "server_error", {});
    return json as ViolationRow;
  } finally {
    clearTimeout(timer);
  }
}

export async function downloadRaisesCsv(quarter: string, fetcher: typeof fetch = fetch): Promise<Blob> {
  let res: Response;
  try {
    res = await fetcher(`/api/kpi/raises/export?quarter=${encodeURIComponent(quarter)}`, { method: "GET", credentials: "include" });
  } catch {
    throw new KpiApiError(0, "network", {});
  }
  if (!res.ok) throw toKpiError(res.status, await readJson(res));
  try {
    return await res.blob();
  } catch {
    throw new KpiApiError(0, "network", {});
  }
}
