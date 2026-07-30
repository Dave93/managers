"use client";

import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { DataTable } from "./data-table";
import { creditCompaniesColumns, formatSum } from "./columns";
import { Button } from "@admin/components/ui/buttonOrigin";
import { Card, CardHeader, CardTitle, CardDescription } from "@admin/components/ui/card";
import CreditCompaniesFormSheet from "@admin/components/forms/credit_companies/sheet";
import { getSummary } from "@admin/lib/credit-api";

export default function CreditCompaniesListPage() {
  const { data: summary } = useQuery({
    queryKey: ["credit_summary"],
    queryFn: async () => {
      const { data } = await getSummary();
      return data;
    },
  });

  const topDebtors = summary?.top_debtors ?? [];
  const overLimit = summary?.companies_over_80_monthly ?? [];

  return (
    <div>
      <div className="flex justify-between">
        <h2 className="text-3xl font-bold tracking-tight">Кредитные компании</h2>
        <div className="flex items-center space-x-2">
          <CreditCompaniesFormSheet>
            <Button>
              <Plus className="mr-2 h-4 w-4" /> Добавить компанию
            </Button>
          </CreditCompaniesFormSheet>
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Общий долг</CardDescription>
            <CardTitle className="text-2xl">{formatSum(summary?.total_debt)}</CardTitle>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>Топ должников</CardDescription>
            {topDebtors.length ? (
              <ul className="mt-1 space-y-1 text-sm">
                {topDebtors.map((d) => (
                  <li key={d.id} className="flex justify-between gap-4">
                    <span className="truncate">{d.name}</span>
                    <span className="font-medium whitespace-nowrap">{formatSum(d.posted)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <CardTitle className="text-base text-muted-foreground">нет</CardTitle>
            )}
          </CardHeader>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>&gt;80% месячного лимита</CardDescription>
            {overLimit.length ? (
              <ul className="mt-1 space-y-1 text-sm">
                {overLimit.map((c) => (
                  <li key={c.id} className="flex justify-between gap-4 text-amber-600">
                    <span className="truncate">{c.name}</span>
                    <span className="font-medium whitespace-nowrap">
                      {formatSum(c.month_spent)} / {formatSum(c.limit_monthly)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <CardTitle className="text-base text-muted-foreground">нет</CardTitle>
            )}
          </CardHeader>
        </Card>
      </div>

      <div className="py-10">
        <DataTable columns={creditCompaniesColumns} />
      </div>
    </div>
  );
}
