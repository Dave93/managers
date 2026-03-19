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

  const filters = useMemo(() => {
    const res: any[] = [];
    if (statusFilter === "used") {
      res.push({ field: "is_used", operator: "eq", value: true });
    } else if (statusFilter === "active") {
      res.push({ field: "is_used", operator: "eq", value: false });
    }
    return res;
  }, [statusFilter]);

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
      <div className="flex items-center gap-4">
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPageIndex(0); }}>
          <SelectTrigger className="w-full">
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
        <div className="space-y-3">
          {tickets.map((ticket) => (
            <div
              key={ticket.id}
              className="rounded-xl border bg-card p-4 shadow-sm space-y-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  {dayjs(ticket.created_at).format("DD.MM.YYYY HH:mm")}
                </span>
                <Badge variant={ticket.is_used ? "destructive" : "default"}>
                  {ticket.is_used ? "Использован" : "Активен"}
                </Badge>
              </div>

              <div className="flex items-baseline justify-between">
                <span className="text-lg font-semibold">
                  Заказ #{ticket.order_number}
                </span>
                <span className="text-lg font-semibold">
                  {Intl.NumberFormat("ru-RU").format(ticket.order_amount)} сум
                </span>
              </div>

              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>Детей: {ticket.children_count}</span>
                {ticket.terminal_name && (
                  <span>{ticket.terminal_name}</span>
                )}
              </div>

              {ticket.is_used && ticket.used_at && (
                <div className="text-xs text-muted-foreground border-t pt-2">
                  Использован: {dayjs(ticket.used_at).format("DD.MM.YYYY HH:mm")}
                </div>
              )}
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
