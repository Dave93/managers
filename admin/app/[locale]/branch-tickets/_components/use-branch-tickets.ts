"use client";

import { useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "@admin/utils/eden";
import { apiMessage, listTypes, type ApiError, type TicketRecord, type TicketTypeRow } from "@admin/lib/tickets-api";
import {
  branchesFromRows,
  buildCreateFormData,
  type Branch,
  type CreateInput,
} from "@admin/lib/tickets-create";

// Те же настройки, что у lib/use-tickets.ts: без повторов и networkMode
// "always", чтобы отказ (403, 5xx, обрыв сети) сразу доходил до экрана, а не
// висел «на паузе» в скрытой вкладке. Константа там не экспортируется.
const FAIL_FAST = { retry: false, networkMode: "always" } as const;

export const branchKeys = {
  // Не под префиксом "tickets": создание заявки инвалидирует ["tickets"], и
  // справочникам планшета незачем перезапрашиваться вместе со списком.
  types: ["branch-tickets", "types"] as const,
  branches: ["branch-tickets", "my-branches"] as const,
};

// Закреплённые за пользователем филиалы: строки users_terminals с именами из
// соединения. Это не то же самое, что /terminals/my_terminals: тот при пустом
// списке сессии отдаёт ВСЕ филиалы, то есть не отличает офисную роль от
// менеджера с филиалами. Здесь пустой ответ значит ровно «не закреплён».
// Цена: читается база, а сервер при создании сверяется со снимком сессии,
// снятым при входе. Если филиал переназначили после входа, они расходятся до
// следующего входа; сервер тогда ответит 403 «Филиал недоступен».
export function useMyBranches(enabled: boolean) {
  return useQuery<Branch[], ApiError>({
    queryKey: branchKeys.branches,
    queryFn: async () => {
      const res: any = await (apiClient.api as any).users_terminals.my_terminals.get();
      if (res?.error) {
        const e = new Error(apiMessage(res.error)) as ApiError;
        e.status = res.error.status;
        throw e;
      }
      return branchesFromRows(res?.data?.data ?? res?.data);
    },
    enabled,
    ...FAIL_FAST,
  });
}

// Только активные типы (GET /ticket_types). useTicketTypes из lib здесь не
// годится: он сначала идёт в /manage?include_inactive=true, и плитки показали
// бы выключенные типы.
export function useCreatableTypes(enabled: boolean) {
  return useQuery<TicketTypeRow[], ApiError>({
    queryKey: branchKeys.types,
    queryFn: async () => (await listTypes()).data,
    enabled,
    ...FAIL_FAST,
    staleTime: 30_000,
  });
}

const SEND_TIMEOUT_MS = 180_000;

// multipart уходит обычным fetch: Eden для него не используется. Путь
// относительный, как у attachmentUrl: Next.js проксирует /api/* на бэкенд.
export async function postTicket(body: FormData): Promise<TicketRecord & { number: string }> {
  // Без предела запрос на плохой связи висел бы вечно, а кнопка «Отправляем…»
  // не отпускала бы менеджера. По истечении запрос отменяется, и это читается
  // как «исход неизвестен», как и обрыв сети.
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), SEND_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch("/api/tickets", { method: "POST", body, credentials: "include", signal: ctl.signal });
  } catch {
    // Ни статуса, ни тела: заявка могла дойти. describeFailure читает это как
    // «исход неизвестен».
    throw new Error("Нет связи с сервером") as ApiError;
  } finally {
    clearTimeout(timer);
  }
  let payload: any = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }
  if (!res.ok) {
    const e = new Error(apiMessage({ value: payload })) as ApiError & { errors?: unknown };
    e.status = res.status;
    e.value = payload;
    e.errors = payload?.errors;
    throw e;
  }
  if (!payload || typeof payload.id !== "string") {
    // 200 без заявки в теле: считаем исход неизвестным, а не успехом.
    throw new Error("Сервер ответил без данных заявки") as ApiError;
  }
  return payload;
}

// Создание заявки с защёлкой от двойной отправки. isPending мутации меняется
// только на следующем рендере, и два нажатия в одном тике запустили бы два
// запроса: защёлка ставится синхронно, до первого await. После успеха она
// остаётся поднятой, чтобы переход на другую страницу нельзя было прервать
// ещё одним нажатием. Сбой её снимает.
export function useCreateTicket() {
  const qc = useQueryClient();
  const latch = useRef(false);
  const m = useMutation({
    mutationFn: async (input: CreateInput) => postTicket(buildCreateFormData(input)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tickets"] });
    },
    onError: () => {
      latch.current = false;
    },
  });
  return {
    submit(input: CreateInput, done?: (t: TicketRecord & { number: string }) => void) {
      if (latch.current) return;
      latch.current = true;
      m.mutate(input, { onSuccess: done });
    },
    isPending: m.isPending,
    isSuccess: m.isSuccess,
    created: m.data,
    error: m.error,
    reset: m.reset,
  };
}
