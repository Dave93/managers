import { useQuery } from "@tanstack/react-query";
import type { CashierDailyResponse, CashierKpiResponse } from "./types";

// Cash shift / cashier routes live on a widened (non-Eden) controller, so
// these hooks use same-origin fetch like CashShiftsByDay: Next.js proxies
// /api/* to the backend and the session cookie rides along.
async function getJson<T>(path: string, params: URLSearchParams): Promise<T> {
  const res = await fetch(`${path}?${params.toString()}`, { credentials: "include" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export function useCashierKpi(startDate: Date, endDate: Date, terminals?: string | null) {
  return useQuery<CashierKpiResponse>({
    queryKey: ["cashier_kpi", startDate, endDate, terminals],
    queryFn: () => {
      const p = new URLSearchParams({ startDate: startDate.toISOString(), endDate: endDate.toISOString() });
      if (terminals) p.set("terminals", terminals);
      return getJson("/api/cash_shifts/cashiers", p);
    },
  });
}

export function useCashierDaily(
  startDate: Date,
  endDate: Date,
  terminals?: string | null,
  cashierId?: string | null
) {
  return useQuery<CashierDailyResponse>({
    queryKey: ["cashier_kpi_daily", startDate, endDate, terminals, cashierId],
    queryFn: () => {
      const p = new URLSearchParams({ startDate: startDate.toISOString(), endDate: endDate.toISOString() });
      if (terminals) p.set("terminals", terminals);
      if (cashierId) p.set("cashierId", cashierId);
      return getJson("/api/cash_shifts/cashiers/daily", p);
    },
  });
}

// The API refuses periods over 92 days with 400, and rejects malformed
// dates / bad terminal ids with 422 — both need a human message instead of
// a raw "HTTP 400" / "HTTP 422" string.
export function cashierKpiErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message === "HTTP 400") {
    return "Период больше 92 дней. Выберите период короче.";
  }
  if (error instanceof Error && error.message === "HTTP 422") {
    return "Некорректные параметры запроса.";
  }
  return "Не удалось загрузить данные по кассирам.";
}
