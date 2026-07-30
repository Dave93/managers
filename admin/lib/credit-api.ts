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
