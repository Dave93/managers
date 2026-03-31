"use client";

import { apiClient } from "@admin/utils/eden";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useLocale } from "next-intl";
import Link from "next/link";
import { Button } from "@admin/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@admin/components/ui/select";
import { Badge } from "@admin/components/ui/badge";
import dayjs from "dayjs";

type SalesPlan = {
  id: string;
  terminal_id: string;
  terminal_name: string | null;
  year: number;
  month: number;
  items_count: number;
  total_planned: number;
  total_sold: number;
  progress_pct: number;
  created_at: string;
};

const MONTHS = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

function getProgressColor(pct: number) {
  if (pct >= 70) return "text-green-600";
  if (pct >= 40) return "text-orange-500";
  return "text-red-500";
}

function getProgressBg(pct: number) {
  if (pct >= 70) return "bg-green-500";
  if (pct >= 40) return "bg-orange-500";
  return "bg-red-500";
}

export function DataTable() {
  const locale = useLocale();
  const [pageIndex, setPageIndex] = useState(0);
  const pageSize = 20;
  const now = new Date();
  const [yearFilter, setYearFilter] = useState(String(now.getFullYear()));
  const [monthFilter, setMonthFilter] = useState(String(now.getMonth() + 1));

  const filters = useMemo(() => {
    const res: any[] = [];
    if (yearFilter) res.push({ field: "year", operator: "eq", value: Number(yearFilter) });
    if (monthFilter) res.push({ field: "month", operator: "eq", value: Number(monthFilter) });
    return res;
  }, [yearFilter, monthFilter]);

  const { data, isLoading } = useQuery({
    queryKey: ["sales_plans", { limit: pageSize, offset: pageIndex * pageSize, filters }],
    queryFn: async () => {
      const { data } = await apiClient.api.sales_plans.get({
        query: {
          limit: pageSize.toString(),
          offset: (pageIndex * pageSize).toString(),
          filters: JSON.stringify(filters),
        },
      });
      return data;
    },
  });

  const plans = (data?.data as SalesPlan[] | undefined) ?? [];
  const total = data?.total ? Number(data.total) : 0;
  const pageCount = Math.ceil(total / pageSize);
  const canPrev = pageIndex > 0;
  const canNext = pageIndex < pageCount - 1;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <Select value={yearFilter} onValueChange={(v) => { setYearFilter(v); setPageIndex(0); }}>
          <SelectTrigger className="w-[120px]">
            <SelectValue placeholder="Год" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="2025">2025</SelectItem>
            <SelectItem value="2026">2026</SelectItem>
            <SelectItem value="2027">2027</SelectItem>
          </SelectContent>
        </Select>

        <Select value={monthFilter} onValueChange={(v) => { setMonthFilter(v); setPageIndex(0); }}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Месяц" />
          </SelectTrigger>
          <SelectContent>
            {MONTHS.map((name, i) => (
              <SelectItem key={i + 1} value={String(i + 1)}>{name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="ml-auto">
          <Link href={`/${locale}/admin/sales-plans/create`}>
            <Button>Создать план</Button>
          </Link>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">Загрузка...</div>
      ) : plans.length === 0 ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">Нет планов</div>
      ) : (
        <div className="rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="p-3 text-left font-medium">Терминал</th>
                <th className="p-3 text-left font-medium">Период</th>
                <th className="p-3 text-center font-medium">Продуктов</th>
                <th className="p-3 text-center font-medium">Прогресс</th>
                <th className="p-3 text-right font-medium">Дата создания</th>
                <th className="p-3 text-right font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {plans.map((plan) => (
                <tr key={plan.id} className="border-b">
                  <td className="p-3">{plan.terminal_name || plan.terminal_id.substring(0, 8)}</td>
                  <td className="p-3">{MONTHS[plan.month - 1]} {plan.year}</td>
                  <td className="p-3 text-center">{plan.items_count}</td>
                  <td className="p-3">
                    <div className="flex items-center justify-center gap-2">
                      <div className="w-24 h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${getProgressBg(plan.progress_pct)}`}
                          style={{ width: `${Math.min(plan.progress_pct, 100)}%` }}
                        />
                      </div>
                      <span className={`text-sm font-semibold ${getProgressColor(plan.progress_pct)}`}>
                        {plan.progress_pct}%
                      </span>
                    </div>
                  </td>
                  <td className="p-3 text-right text-muted-foreground">
                    {dayjs(plan.created_at).format("DD.MM.YYYY")}
                  </td>
                  <td className="p-3 text-right">
                    <Link href={`/${locale}/admin/sales-plans/${plan.id}/edit`}>
                      <Button variant="outline" size="sm">Редактировать</Button>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total > 0 && (
        <div className="flex items-center justify-between pt-2">
          <span className="text-sm text-muted-foreground">
            {pageIndex * pageSize + 1}–{Math.min((pageIndex + 1) * pageSize, total)} из {total}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setPageIndex((p) => p - 1)} disabled={!canPrev}>Назад</Button>
            <Button variant="outline" size="sm" onClick={() => setPageIndex((p) => p + 1)} disabled={!canNext}>Вперёд</Button>
          </div>
        </div>
      )}
    </div>
  );
}
