"use client";

import { useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "@admin/utils/eden";
import { apiMessage, listTypes, type ApiError, type TicketRecord, type TicketTypeRow } from "@admin/lib/tickets-api";
import {
  branchesFromSession,
  buildCreateFormData,
  describeFailure,
  terminalIdsFromMe,
  type Branch,
  type CreateInput,
  type NoAnswerKind,
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

// Филиалы менеджера. Решение (сколько их и какой id слать) берётся из
// GET /users/me: это снимок терминалов сессии, по которому сервер и проверяет
// создание заявки, поэтому экран не пообещает филиал, который сервер откажет
// принять. Пустой снимок значит «не закреплён» (офисная роль). Имена идут из
// соединения users_terminals (база): оно нужно только для подписей, и если не
// ответило, филиалы остаются с короткой подписью по id, а не пропадают.
// /terminals/my_terminals для этого не годится: при пустом снимке он отдаёт все
// филиалы. Права users_terminals.list соединению всё ещё нужно, только для имён.
export function useMyBranches(enabled: boolean) {
  return useQuery<Branch[], ApiError>({
    queryKey: branchKeys.branches,
    queryFn: async () => {
      const [me, names] = await Promise.all([
        (apiClient.api as any).users.me.get() as Promise<any>,
        // Имена не решают ничего: сбой этого запроса не должен ронять экран.
        ((apiClient.api as any).users_terminals.my_terminals.get() as Promise<any>).catch(() => null),
      ]);
      if (me?.error) {
        const e = new Error(apiMessage(me.error)) as ApiError;
        e.status = me.error.status;
        throw e;
      }
      const ids = terminalIdsFromMe(me?.data);
      if (!ids) throw new Error("Сервер не вернул филиалы сессии") as ApiError;
      return branchesFromSession(ids, names?.error ? null : (names?.data?.data ?? names?.data));
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
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctl.abort();
  }, SEND_TIMEOUT_MS);
  const noAnswer = (kind: NoAnswerKind, message: string) =>
    Object.assign(new Error(message), { kind }) as ApiError & { kind: NoAnswerKind };
  let res: Response;
  try {
    res = await fetch("/api/tickets", { method: "POST", body, credentials: "include", signal: ctl.signal });
  } catch {
    // Ни статуса, ни тела: заявка могла дойти. describeFailure читает это как
    // «исход неизвестен».
    throw timedOut ? noAnswer("timeout", "Нет ответа от сервера") : noAnswer("network", "Нет связи с сервером");
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
    // Разобран ли ответ как JSON нашего бэкенда: по этому describeFailure
    // отличает его 500 («ничего не создано») от 500 прокси Next с плоским
    // текстом (исход неизвестен).
    (e as any).bodyParsed = typeof payload?.message === "string";
    throw e;
  }
  if (!payload || typeof payload.id !== "string") {
    // 200 без заявки в теле: считаем исход неизвестным, а не успехом.
    throw noAnswer("no_body", "Сервер ответил без данных заявки");
  }
  return payload;
}

// Создание заявки с защёлкой от двойной отправки. isPending мутации меняется
// только на следующем рендере, и два нажатия в одном тике запустили бы два
// запроса: защёлка ставится синхронно, до первого await. После успеха она
// остаётся поднятой, чтобы переход на другую страницу нельзя было прервать
// ещё одним нажатием. Сбой с известным исходом (отказ сервера) её снимает.
//
// Сбой с НЕизвестным исходом (обрыв, 502/503/504, ответ без тела) её НЕ
// снимает: заявка могла создаться, роута удаления нет, и вторая кнопка с той
// же надписью дала бы дубль с теми же фотографиями. Повтор тогда возможен
// только отдельным действием, `submit(..., { afterCheck: true })`, которое
// экран подписывает иначе («Я проверил список, создать ещё раз»).
export function useCreateTicket() {
  const qc = useQueryClient();
  const latch = useRef(false);
  // «Ждём проверки списка» как ref: повтор погашает его синхронно, и второе
  // нажатие в том же тике (до перерисовки) уже не проходит. Значение из
  // замыкания рендера для этого устарело бы.
  const awaitRef = useRef(false);
  const m = useMutation({
    mutationFn: async (input: CreateInput) => postTicket(buildCreateFormData(input)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tickets"] });
    },
    onError: (e) => {
      // Сырой текст сбоя человеку не показывается, но пропасть не должен.
      console.error("tickets: create failed", e);
      const unknown = describeFailure(e).outcomeUnknown;
      latch.current = unknown;
      awaitRef.current = unknown;
    },
  });
  const awaitingCheck = m.isError && describeFailure(m.error).outcomeUnknown;
  return {
    submit(
      input: CreateInput,
      done?: (t: TicketRecord & { number: string }) => void,
      opts?: { afterCheck?: boolean }
    ) {
      // Обычное нажатие при поднятой защёлке молчит; повтор после проверки
      // допустим только из состояния «ждём проверки».
      if (latch.current) {
        if (!(opts?.afterCheck && awaitRef.current)) return;
        awaitRef.current = false;
      }
      latch.current = true;
      m.mutate(input, { onSuccess: done });
    },
    // Сброс показанной ошибки при смене типа. Пока ждём проверки списка, его
    // не делаем: защёлка и ошибка остаются, иначе кнопка вернулась бы.
    dismissError() {
      if (!latch.current) m.reset();
    },
    isPending: m.isPending,
    isSuccess: m.isSuccess,
    awaitingCheck,
    created: m.data,
    error: m.error,
  };
}
