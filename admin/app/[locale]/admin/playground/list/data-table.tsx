"use client";

import { apiClient } from "@admin/utils/eden";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
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
import { DateRangeFilter } from "@admin/components/filters/date-range-filter/date-range-filter";
import { useDateRangeState } from "@admin/components/filters/date-range-filter/date-range-state.hook";

type PlaygroundTicket = {
  id: string;
  terminal_name: string | null;
  order_number: string;
  order_amount: number;
  children_count: number;
  is_used: boolean;
  used_at: string | null;
  created_at: string;
};

export function DataTable() {
  const [pageIndex, setPageIndex] = useState(0);
  const pageSize = 20;
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const { dateRange } = useDateRangeState();

  const filters = useMemo(() => {
    const res: any[] = [];
    if (statusFilter === "used") {
      res.push({ field: "is_used", operator: "eq", value: true });
    } else if (statusFilter === "active") {
      res.push({ field: "is_used", operator: "eq", value: false });
    }
    if (dateRange?.from) {
      res.push({
        field: "created_at",
        operator: "gte",
        value: dayjs(dateRange.from).startOf("day").toISOString(),
      });
    }
    if (dateRange?.to) {
      res.push({
        field: "created_at",
        operator: "lte",
        value: dayjs(dateRange.to).endOf("day").toISOString(),
      });
    }
    return res;
  }, [statusFilter, dateRange]);

  const { data, isLoading } = useQuery({
    queryKey: [
      "playground_tickets",
      { limit: pageSize, offset: pageIndex * pageSize, filters },
    ],
    queryFn: async () => {
      const { data } = await apiClient.api.playground_tickets.get({
        query: {
          limit: pageSize.toString(),
          offset: (pageIndex * pageSize).toString(),
          filters: JSON.stringify(filters),
        },
      });
      return data;
    },
  });

  const tickets = (data?.data as PlaygroundTicket[] | undefined) ?? [];
  const total = data?.total ? Number(data.total) : 0;
  const pageCount = Math.ceil(total / pageSize);
  const canPrev = pageIndex > 0;
  const canNext = pageIndex < pageCount - 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <DateRangeFilter />
        <Select
          value={statusFilter}
          onValueChange={(v) => {
            setStatusFilter(v);
            setPageIndex(0);
          }}
        >
          <SelectTrigger className="sm:w-[200px]">
            <SelectValue placeholder="Статус" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все</SelectItem>
            <SelectItem value="active">Активные</SelectItem>
            <SelectItem value="used">Использованные</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          Загрузка...
        </div>
      ) : tickets.length === 0 ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          Нет данных
        </div>
      ) : (
        <div className="divide-y rounded-xl border bg-card">
          {tickets.map((ticket) => (
            <div
              key={ticket.id}
              className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-accent/30 transition-colors"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-3">
                <div className="flex items-center gap-2 sm:w-52 sm:shrink-0">
                  <span className="font-semibold shrink-0">
                    #{ticket.order_number}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {dayjs(ticket.created_at).format("DD.MM.YY HH:mm")}
                  </span>
                </div>
                <div className="flex items-center gap-2 min-w-0 sm:gap-3 sm:flex-1">
                  <span className="font-semibold tabular-nums shrink-0 sm:w-32 sm:text-right">
                    {Intl.NumberFormat("ru-RU").format(ticket.order_amount)} сум
                  </span>
                  <span className="text-xs text-muted-foreground shrink-0">
                    Детей: {ticket.children_count}
                  </span>
                  <span className="text-xs text-muted-foreground truncate min-w-0 hidden md:inline md:flex-1">
                    {ticket.terminal_name ?? ""}
                  </span>
                  {ticket.is_used && ticket.used_at && (
                    <span className="text-xs text-muted-foreground whitespace-nowrap hidden lg:inline">
                      исп. {dayjs(ticket.used_at).format("DD.MM HH:mm")}
                    </span>
                  )}
                </div>
              </div>
              <Badge
                variant={ticket.is_used ? "destructive" : "default"}
                className="shrink-0"
              >
                {ticket.is_used ? "Использован" : "Активен"}
              </Badge>
            </div>
          ))}
        </div>
      )}

      {total > 0 && (
        <div className="flex items-center justify-between pt-2">
          <span className="text-sm text-muted-foreground">
            {pageIndex * pageSize + 1}–
            {Math.min((pageIndex + 1) * pageSize, total)} из {total}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPageIndex((p) => p - 1)}
              disabled={!canPrev}
            >
              Назад
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPageIndex((p) => p + 1)}
              disabled={!canNext}
            >
              Вперёд
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
