"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@admin/utils/eden";
import {
  listTickets, getTicket, closeTicket, reopenTicket, cancelTicket,
  addComment, markSeen, listTypes, listTypesForManage,
  type ApiError, type TicketListQuery,
} from "@admin/lib/tickets-api";

export const ticketKeys = {
  list: (q: TicketListQuery) => ["tickets", "list", q] as const,
  card: (id: string) => ["tickets", "card", id] as const,
};

// Без повторов и с networkMode "always" намеренно. Повтор после сбоя ждёт
// фокуса вкладки и сети: в скрытой вкладке или офлайн запрос застревает «на
// паузе», без данных и без ошибки, и экран показал бы пустой список вместо
// ошибки. Без повторов сбой (403, 5xx, обрыв сети) сразу доходит до экрана, а
// «Повторить» и опрос раз в минуту лечат разовые сбои.
const FAIL_FAST = { retry: false, networkMode: "always" } as const;

export function useTicketList(q: TicketListQuery) {
  return useQuery({
    queryKey: ticketKeys.list(q),
    queryFn: () => listTickets(q),
    ...FAIL_FAST,
    // Экран отвечает на вопрос «что сейчас происходит», так что список и
    // счётчики сами обновляются, пока вкладка открыта.
    refetchInterval: 60_000,
  });
}

export function useTicketCard(id: string | null) {
  return useQuery({
    queryKey: ticketKeys.card(id ?? ""),
    queryFn: () => getTicket(id as string),
    enabled: Boolean(id),
    ...FAIL_FAST,
  });
}

// Справочник типов для фильтра. Права на него другие, чем на сам список:
// /ticket_types/manage требует tickets.types.manage, /ticket_types требует
// tickets.create, и офисная роль может не иметь ни того ни другого. Поэтому
// пробуем оба по очереди, а если отказали оба, экран прячет фильтр, а не
// рисует пустой Select. retry:false, чтобы отказ был виден сразу.
export function useTicketTypes() {
  return useQuery({
    queryKey: ["tickets", "types", "for-filter"],
    queryFn: async () => {
      try {
        return (await listTypesForManage()).data;
      } catch (e) {
        if ((e as ApiError).status !== 403) throw e;
        return (await listTypes()).data;
      }
    },
    retry: false,
    staleTime: 5 * 60_000,
  });
}

export type TicketTerminalOption = { id: string; name: string };

// Список филиалов для фильтра. Тот же маршрут, что у экрана «Стажировки», но
// свой хук: разделы админки не импортируют друг у друга. Имена филиалов в
// самой таблице приходят с сервера, так что при отказе (нет terminals.list)
// пропадает только фильтр.
export function useTicketTerminals() {
  return useQuery<TicketTerminalOption[], Error>({
    queryKey: ["tickets", "terminals"],
    queryFn: async () => {
      const res: any = await apiClient.api.terminals.cached.get();
      if (res?.error) throw new Error("Не удалось загрузить филиалы");
      const rows = (res?.data?.data ?? res?.data ?? []) as any[];
      return rows
        .map((t) => ({ id: String(t.id), name: String(t.name ?? t.id) }))
        .sort((a, b) => a.name.localeCompare(b.name, "ru"));
    },
    retry: false,
    staleTime: 10 * 60_000,
  });
}

export function useTicketActions(onDone?: () => void) {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["tickets"] });
    onDone?.();
  };
  return {
    close: useMutation({ mutationFn: (id: string) => closeTicket(id), onSuccess: invalidate }),
    reopen: useMutation({
      mutationFn: (v: { id: string; comment: string }) => reopenTicket(v.id, v.comment),
      onSuccess: invalidate,
    }),
    cancel: useMutation({
      mutationFn: (v: { id: string; comment?: string }) => cancelTicket(v.id, v.comment),
      onSuccess: invalidate,
    }),
    comment: useMutation({
      mutationFn: (v: { id: string; body: string }) => addComment(v.id, v.body),
      onSuccess: invalidate,
    }),
    seen: useMutation({ mutationFn: (id: string) => markSeen(id) }),
  };
}
