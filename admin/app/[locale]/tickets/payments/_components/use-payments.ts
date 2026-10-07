"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  approvePayments,
  listTickets,
  rejectPayments,
  type TicketListQuery,
} from "@admin/lib/tickets-api";

type Filters = NonNullable<TicketListQuery["filters"]>;

// Очередь = то, что POST /tickets/payment/approve|reject реально способен
// обработать: closed + pending + непустая сумма акта (applyPaymentDecision
// отбрасывает остальное). Третий фильтр нужен потому, что колонку
// work_total_amount пока никто не пишет: без него сюда попали бы все закрытые
// заявки с прочерком вместо суммы, а утверждение вернуло бы «пропущено» по
// каждой. У parseFilterFields нет оператора IS NOT NULL, зато gt по числу
// исключает NULL, а сумма акта всегда больше нуля (act.ts).
const PENDING_FILTERS: Filters = [
  { field: "status", operator: "eq", value: "closed" },
  { field: "payment_status", operator: "eq", value: "pending" },
  { field: "work_total_amount", operator: "gt", value: "0" },
];

// Ключ лежит под префиксом ["tickets"], который сбрасывает каждая мутация
// модуля: так утверждение и отклонение сами обновляют этот экран.
//
// retry:false и networkMode:"always" — как FAIL_FAST в lib/use-tickets.ts
// (там константа не экспортируется). Без них QueryClient по умолчанию три раза
// повторяет запрос с нарастающей паузой, и 403 сидит за скелетом секунд семь, а
// в скрытой вкладке запрос вовсе встаёт на паузу без данных и без ошибки.
export function usePaymentQueue(limit = 100, offset = 0, enabled = true) {
  return useQuery({
    queryKey: ["tickets", "payments", limit, offset],
    queryFn: () => listTickets({ limit, offset, filters: PENDING_FILTERS }),
    enabled,
    retry: false,
    networkMode: "always",
    // Очередь делят несколько человек: строки, которые уже решил кто-то
    // другой, должны исчезать сами.
    refetchInterval: 60_000,
  });
}

// networkMode:"always" и у мутаций: по умолчанию мутация без сети встаёт на
// паузу, и кнопки остаются заблокированными без единого сообщения.
export function usePaymentActions() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["tickets"] });
  return {
    approve: useMutation({
      mutationFn: (ids: string[]) => approvePayments(ids),
      onSuccess: invalidate,
      networkMode: "always",
    }),
    reject: useMutation({
      mutationFn: (v: { ids: string[]; comment: string }) => rejectPayments(v.ids, v.comment),
      onSuccess: invalidate,
      networkMode: "always",
    }),
  };
}
