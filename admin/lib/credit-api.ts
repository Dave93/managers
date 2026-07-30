// creditAdminController is registered on the app root (backend/src/app.ts)
// with a widened `as unknown as Elysia` export, to stay under TypeScript's
// instantiation-depth limit (TS2589) — it was the 45th controller in
// apiController's .use() chain, which was already at the limit with 44 (see
// commit 6202a0c, the iiko_sync precedent this follows). That widening means
// Eden's `treaty<App>()` can no longer infer `.credit.*` route types from
// `apiClient` — the routes are still real, live HTTP endpoints under
// `/api/credit/...`, just untyped from Eden's side.
//
// This file is a hand-typed wrapper: the underlying calls go through the same
// Eden proxy instance (so cookies/base URL/fetch config are unchanged), with
// one `as any` cast centralized here instead of scattered across every call
// site in the credit-companies UI.

import { apiClient } from "@admin/utils/eden";

const creditApi = (apiClient.api as any).credit;

export type CreditCompanyStatus = "active" | "suspended" | "pending_verification";

// Matches GET /credit/companies' explicit select() — a left join against
// credit_accounts, so posted/reserved are nullable (no account row yet).
// NOT the same shape as the credit_companies table row (see CreditCompanyDetail).
export interface CreditCompanyRow {
  id: string;
  name: string;
  inn: string | null;
  phone: string | null;
  status: CreditCompanyStatus;
  overdue: boolean;
  limit_total: number;
  limit_daily: number;
  limit_monthly: number;
  verified_at: string | null;
  posted: number | null;
  reserved: number | null;
}

export interface CreditCompanyListResponse {
  // node-postgres's count(*) arrives as a string, not a number — callers must
  // coerce with Number(total) before doing arithmetic on it.
  total: number | string;
  data: CreditCompanyRow[];
}

export interface CreditAccountSummary {
  posted: number;
  reserved: number;
}

// The full credit_companies row, as returned inside GET /credit/companies/:id.
export interface CreditCompanyDetail {
  id: string;
  name: string;
  inn: string | null;
  phone: string | null;
  status: CreditCompanyStatus;
  limit_total: number;
  limit_daily: number;
  limit_monthly: number;
  overdue: boolean;
  verified_by: string | null;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreditCompanyPhone {
  id: string;
  company_id: string;
  phone: string;
  employee_name: string | null;
  active: boolean;
  created_at: string;
}

// GET /credit/companies/:id's actual shape — NOT a bare company row.
export interface CreditCompanyDetailResponse {
  company: CreditCompanyDetail;
  account: CreditAccountSummary;
  phones: CreditCompanyPhone[];
}

export interface CreditCompanyCreateInput {
  name: string;
  inn?: string;
  phone?: string;
  status: CreditCompanyStatus;
  limit_total: number;
  limit_daily: number;
  limit_monthly: number;
}

export interface CreditCompanyUpdateInput {
  name?: string;
  inn?: string;
  phone?: string;
  status?: CreditCompanyStatus;
  limit_total?: number;
  limit_daily?: number;
  limit_monthly?: number;
  verified?: boolean;
}

export interface CreditSummaryDebtor {
  id: string;
  name: string;
  posted: number;
}

export interface CreditSummaryOverLimit {
  id: string;
  name: string;
  month_spent: number;
  limit_monthly: number;
}

export interface CreditSummaryResponse {
  total_debt: number;
  top_debtors: CreditSummaryDebtor[];
  companies_over_80_monthly: CreditSummaryOverLimit[];
}

export interface CreditPhoneInput {
  phone: string;
  employee_name?: string;
}

export interface CreditPhoneUpdateInput {
  employee_name?: string;
  active?: boolean;
}

export type CreditDocumentType = "contract" | "inn_cert" | "guarantee_letter" | "other";

// Matches GET /credit/companies/:id/documents' explicit column list — the
// route deliberately omits file_path (an absolute server path); downloads go
// through documentDownloadUrl()/the /credit/documents/:id/download route.
export interface CreditCompanyDocument {
  id: string;
  type: CreditDocumentType;
  doc_number: string | null;
  doc_date: string | null;
  uploaded_by: string | null;
  created_at: string;
}

export interface CreditDocumentListResponse {
  data: CreditCompanyDocument[];
}

export interface CreditDocumentUploadInput {
  file: File;
  type: CreditDocumentType;
  doc_number?: string;
  doc_date?: string;
}

// Matches the Eden treaty response envelope every generated call returns —
// keeps call sites' `const { data } = await listCompanies(...)` destructuring
// identical to what they'd get from a typed Eden call.
type EdenResult<T> = Promise<{ data: T | null; error: any }>;

export function listCompanies(query: { limit: string; offset: string }): EdenResult<CreditCompanyListResponse> {
  return creditApi.companies.get({ query });
}

export function getCompany(id: string): EdenResult<CreditCompanyDetailResponse> {
  return creditApi.companies({ id }).get({});
}

export function createCompany(data: CreditCompanyCreateInput): EdenResult<CreditCompanyDetail> {
  return creditApi.companies.post({ data });
}

export function updateCompany(id: string, data: CreditCompanyUpdateInput): EdenResult<CreditCompanyDetail> {
  return creditApi.companies({ id }).put({ data });
}

export function getSummary(): EdenResult<CreditSummaryResponse> {
  return creditApi.summary.get();
}

export function addPhone(companyId: string, data: CreditPhoneInput): EdenResult<CreditCompanyPhone> {
  return creditApi.companies({ id: companyId }).phones.post({ data });
}

export function updatePhone(id: string, data: CreditPhoneUpdateInput): EdenResult<CreditCompanyPhone> {
  return creditApi.phones({ id }).put({ data });
}

export function listDocuments(companyId: string): EdenResult<CreditDocumentListResponse> {
  return creditApi.companies({ id: companyId }).documents.get({});
}

// The route's body schema is flat (`t.Object({file, type, doc_number,
// doc_date})`, no `data` wrapper like the JSON routes above) — Eden treaty
// auto-switches this call to multipart/FormData because `file` is a File
// instance (see @elysiajs/eden/dist/treaty2.js: it detects any File/Blob
// value in the body object and builds a FormData from Object.entries
// instead of JSON.stringify-ing). That FormData build does NOT skip
// undefined values — `FormData.append(k, undefined)` stringifies to the
// literal `"undefined"`, which would fail the route's
// `t.Optional(t.String({format:"date"}))` check on doc_date. Omit optional
// keys entirely here instead of passing them as `undefined`, so this is the
// one place that has to know that, not every call site.
export function uploadDocument(companyId: string, input: CreditDocumentUploadInput): EdenResult<CreditCompanyDocument> {
  const body: Record<string, unknown> = { file: input.file, type: input.type };
  if (input.doc_number) body.doc_number = input.doc_number;
  if (input.doc_date) body.doc_date = input.doc_date;
  return creditApi.companies({ id: companyId }).documents.post(body);
}

export function deleteDocument(id: string): EdenResult<{ ok: boolean }> {
  return creditApi.documents({ id }).delete();
}

export function documentDownloadUrl(id: string): string {
  return `/api/credit/documents/${id}/download`;
}

// Matches GET /credit/companies/:id/payments' explicit column list.
export interface CreditPayment {
  id: string;
  company_id: string;
  amount: number;
  doc_number: string | null;
  doc_date: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

export interface CreditPaymentListResponse {
  data: CreditPayment[];
}

export interface CreditPaymentInput {
  amount: number; // tiyins, > 0
  doc_number: string; // idempotency key — required
  doc_date?: string;
  note?: string;
}

export interface CreditAdjustmentInput {
  amount: number; // tiyins, signed, != 0 — positive reduces debt
  reason: string;
}

// The route returns this verbatim (see backend/src/modules/credit/service.ts
// applyPayment/applyAdjustment) — {ok:true, reason:"duplicate_doc"} is a
// successful replay, not an error, and must be surfaced as its own toast
// rather than folded into the generic error path.
export interface CreditOpResult {
  ok: boolean;
  state?: string;
  reason?: string;
}

export type CreditEntryType = "authorize" | "capture" | "void" | "refund" | "amend" | "payment" | "adjustment";

export interface CreditStatementSummary {
  posted: number;
  reserved: number;
  available: number;
  day_spent: number;
  month_spent: number;
  limit_total: number;
  limit_daily: number;
  limit_monthly: number;
}

// Matches GET /credit/companies/:id/statement's explicit column list — all
// amounts are raw tiyins (÷100 happens in the UI only, same rule as
// formatSum in ../columns).
export interface CreditStatementEntry {
  id: string;
  company_id: string;
  hold_id: string | null;
  brand: string | null;
  order_id: string | null;
  order_number: string | null;
  entry_type: CreditEntryType;
  amount: number;
  balance_after: number;
  period_day_key: string | null;
  period_month_key: string | null;
  meta: unknown;
  created_by: string | null;
  created_at: string;
}

export interface CreditStatementResponse {
  summary: CreditStatementSummary;
  total: number;
  data: CreditStatementEntry[];
}

export interface CreditStatementQuery {
  from?: string;
  to?: string;
  brand?: string;
  limit?: string;
  offset?: string;
}

export function listPayments(companyId: string): EdenResult<CreditPaymentListResponse> {
  return creditApi.companies({ id: companyId }).payments.get({});
}

export function payCompany(companyId: string, data: CreditPaymentInput): EdenResult<CreditOpResult> {
  return creditApi.companies({ id: companyId }).payments.post({ data });
}

export function adjustCompany(companyId: string, data: CreditAdjustmentInput): EdenResult<CreditOpResult> {
  return creditApi.companies({ id: companyId }).adjustments.post({ data });
}

export function getStatement(companyId: string, query: CreditStatementQuery): EdenResult<CreditStatementResponse> {
  return creditApi.companies({ id: companyId }).statement.get({ query });
}

// Not an Eden call — the export route streams an xlsx binary, which the app
// opens directly in a new tab/download rather than fetching through the
// treaty client. Same query params as getStatement (minus limit/offset: the
// backend caps the export at STATEMENT_EXPORT_CAP rows itself).
export function statementExportUrl(companyId: string, query: { from?: string; to?: string; brand?: string }): string {
  const params = new URLSearchParams();
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  if (query.brand) params.set("brand", query.brand);
  const qs = params.toString();
  return `/api/credit/companies/${companyId}/statement/export${qs ? `?${qs}` : ""}`;
}
