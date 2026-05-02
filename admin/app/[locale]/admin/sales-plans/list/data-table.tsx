"use client";

import { apiClient } from "@admin/utils/eden";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useLocale } from "next-intl";
import { MoreVertical } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@admin/components/ui/dropdown-menu";
import { useRouter } from "next/navigation";
// import { CopyPlanDialog } from "./copy-plan-dialog"; // will be enabled in Task 3
import { Button } from "@admin/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@admin/components/ui/select";
import dayjs from "dayjs";
import { useAuth } from "@admin/components/useAuth";

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

function getProgressTrack(pct: number) {
  if (pct >= 70) return "bg-green-100";
  if (pct >= 40) return "bg-orange-100";
  return "bg-red-100";
}

export function DataTable() {
  const locale = useLocale();
  const [pageIndex, setPageIndex] = useState(0);
  const pageSize = 20;
  const now = new Date();
  const [yearFilter, setYearFilter] = useState(String(now.getFullYear()));
  const [monthFilter, setMonthFilter] = useState(String(now.getMonth() + 1));
  const router = useRouter();
  const [copyDialogOpen, setCopyDialogOpen] = useState(false);
  const [copySourceIds, setCopySourceIds] = useState<string[]>([]);
  const [copySourceLabel, setCopySourceLabel] = useState("");
  const [copySourceYear, setCopySourceYear] = useState(now.getFullYear());
  const [copySourceMonth, setCopySourceMonth] = useState(now.getMonth() + 1);
  const { user } = useAuth();
  const userOrganizationId = (user as any)?.user?.organization_id;

  const filters = useMemo(() => {
    const res: any[] = [];
    if (yearFilter) res.push({ field: "year", operator: "eq", value: Number(yearFilter) });
    if (monthFilter) res.push({ field: "month", operator: "eq", value: Number(monthFilter) });
    if (userOrganizationId) res.push({ field: "organization_id", operator: "eq", value: userOrganizationId });
    return res;
  }, [yearFilter, monthFilter, userOrganizationId]);

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

  const openSingleCopy = (plan: SalesPlan) => {
    setCopySourceIds([plan.id]);
    setCopySourceLabel(
      `${plan.terminal_name || plan.terminal_id.substring(0, 8)} · ${MONTHS[plan.month - 1]} ${plan.year}`
    );
    setCopySourceYear(plan.year);
    setCopySourceMonth(plan.month);
    setCopyDialogOpen(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Select value={yearFilter} onValueChange={(v) => { setYearFilter(v); setPageIndex(0); }}>
          <SelectTrigger className="flex-1">
            <SelectValue placeholder="Год" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="2025">2025</SelectItem>
            <SelectItem value="2026">2026</SelectItem>
            <SelectItem value="2027">2027</SelectItem>
          </SelectContent>
        </Select>

        <Select value={monthFilter} onValueChange={(v) => { setMonthFilter(v); setPageIndex(0); }}>
          <SelectTrigger className="flex-1">
            <SelectValue placeholder="Месяц" />
          </SelectTrigger>
          <SelectContent>
            {MONTHS.map((name, i) => (
              <SelectItem key={i + 1} value={String(i + 1)}>{name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">Загрузка...</div>
      ) : plans.length === 0 ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">Нет планов</div>
      ) : (
        <div className="space-y-3">
          {plans.map((plan) => (
            <div
              key={plan.id}
              role="button"
              tabIndex={0}
              onClick={() => router.push(`/${locale}/admin/sales-plans/${plan.id}/edit`)}
              onKeyDown={(e) => {
                if (e.key === "Enter") router.push(`/${locale}/admin/sales-plans/${plan.id}/edit`);
              }}
              className="rounded-xl border bg-card p-4 shadow-sm space-y-3 active:bg-muted/50 transition-colors cursor-pointer"
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold">
                  {plan.terminal_name || plan.terminal_id.substring(0, 8)}
                </span>
                <div className="flex items-center gap-2">
                  <span className={`text-xl font-bold ${getProgressColor(plan.progress_pct)}`}>
                    {plan.progress_pct}%
                  </span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                      <button className="p-1 rounded hover:bg-muted" aria-label="Действия">
                        <MoreVertical className="size-4 text-muted-foreground" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenuItem
                        onSelect={() => router.push(`/${locale}/admin/sales-plans/${plan.id}/edit`)}
                      >
                        Редактировать
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => openSingleCopy(plan)}>
                        Копировать
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              <div className={`rounded-full h-2 ${getProgressTrack(plan.progress_pct)}`}>
                <div
                  className={`h-full rounded-full ${getProgressBg(plan.progress_pct)}`}
                  style={{ width: `${Math.min(plan.progress_pct, 100)}%` }}
                />
              </div>

              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>{MONTHS[plan.month - 1]} {plan.year}</span>
                <span>{plan.items_count} продуктов</span>
              </div>

              <div className="text-xs text-muted-foreground">
                Создан: {dayjs(plan.created_at).format("DD.MM.YYYY")}
              </div>
            </div>
          ))}
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
