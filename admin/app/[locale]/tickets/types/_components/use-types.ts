"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  apiMessage,
  createType,
  listContractors,
  listTickets,
  listTypesForManage,
  updateType,
  type ApiError,
  type TicketTypeCreateInput,
  type TicketTypeUpdateInput,
} from "@admin/lib/tickets-api";

// Право экрана. Оба маршрута типов (GET /ticket_types/manage, POST и PUT
// /ticket_types) проверяют только его, а на чтение списка заявок и фирм нужны
// ещё права, без которых экран работает с оговорками (см. ниже).
export const TYPES_RIGHT = "tickets.types.manage";
export const CONTRACTORS_RIGHT = "tickets.contractors.manage";
export const LIST_RIGHT = "tickets.list";

// Ключи лежат под ["tickets", ...]: так любое действие над заявками (их
// сбрасывают все мутации модуля) заодно обновляет счётчик заявок типа, а
// сохранение типа сбрасывает и фильтр типов в списке офиса
// (["tickets","types","for-filter"] из lib/use-tickets.ts).
export const typeKeys = {
  list: ["tickets", "types", "manage"] as const,
  firms: ["ticket_contractors"] as const,
  count: (typeId: string) => ["tickets", "types", "count", typeId] as const,
  filterPrefix: ["tickets", "types"] as const,
};

// Без повторов и с networkMode "always": отказ и обрыв сети сразу доходят до
// экрана, а не висят «на паузе» в скрытой вкладке (то же, что FAIL_FAST в
// lib/use-tickets.ts, откуда он не экспортируется).
const FAIL_FAST = { retry: false, networkMode: "always" } as const;

export function useManagedTypes(enabled: boolean) {
  return useQuery({
    queryKey: typeKeys.list,
    queryFn: async () => (await listTypesForManage()).data,
    enabled,
    ...FAIL_FAST,
  });
}

// Фирмы нужны, чтобы по contractor_id написать название и чтобы выбрать фирму.
// Маршрут требует tickets.contractors.manage, которого у роли, управляющей
// типами, может не быть: тогда 403 не ломает экран, а отключает выбор фирмы.
// Ключ тот же, что у экрана фирм: один кэш на оба экрана.
export function useFirms(enabled: boolean) {
  return useQuery({
    queryKey: typeKeys.firms,
    queryFn: async () => (await listContractors()).data,
    enabled,
    ...FAIL_FAST,
  });
}

// Сколько заявок у типа. Нужен только для формулировки подтверждения («заявок
// этого типа: N» или «число неизвестно»); решать он ничего не должен.
// Ходит лишь пока открыта панель этого типа (typeId null выключает запрос) и
// читает `total` у limit=1. Маршрут требует tickets.list и считает заявки в
// пределах филиалов сессии, так что 0 значит «в ваших филиалах нет», а не
// «нигде нет».
export function useTypeTicketCount(typeId: string | null) {
  return useQuery({
    queryKey: typeKeys.count(typeId ?? ""),
    queryFn: async () =>
      (
        await listTickets({
          limit: 1,
          offset: 0,
          filters: [{ field: "type_id", operator: "eq", value: typeId }],
        })
      ).total,
    enabled: typeId !== null,
    // Данные нужны свежими именно на момент сохранения.
    staleTime: 0,
    ...FAIL_FAST,
  });
}

export function useTypeActions() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: typeKeys.filterPrefix });
  };
  return {
    create: useMutation({
      mutationFn: (body: TicketTypeCreateInput) => createType(body),
      onSuccess: invalidate,
      networkMode: "always",
    }),
    update: useMutation({
      mutationFn: (v: { id: string; body: TicketTypeUpdateInput }) => updateType(v.id, v.body),
      onSuccess: invalidate,
      networkMode: "always",
    }),
  };
}

export type ServerProblem = {
  // Заголовок: что случилось в целом.
  headline: string;
  // Построчный список ошибок сервера (422 по схеме), если он пришёл.
  items: string[];
};

// Текст сбоя записи. 422 по схеме приходит как {message, errors: string[]}, а
// apiMessage вернул бы только первую строку списка, поэтому весь список
// берётся из error.value и показывается целиком.
export function serverProblem(error: unknown): ServerProblem {
  const e = error as ApiError | null;
  const status = e?.status;
  if (status === 403) {
    return {
      headline: `Нет права ${TYPES_RIGHT}. Попросите администратора добавить его вашей роли.`,
      items: [],
    };
  }
  if (status === undefined) {
    return {
      headline: `Нет связи с сервером: ${apiMessage(error)}. Неизвестно, дошёл ли запрос; обновите список и проверьте.`,
      items: [],
    };
  }
  const value = e?.value as { type?: unknown; message?: unknown; errors?: unknown } | undefined;
  // Ошибку валидации Elysia (422 до обработчика) отдаёт JSON-строкой в message
  // и объектами в errors: ни то ни другое человеку показывать нельзя, а
  // apiMessage это уже умеет сводить к одной фразе.
  if (value?.type === "validation") return { headline: apiMessage(error), items: [] };
  const items = Array.isArray(value?.errors)
    ? value.errors.filter((x): x is string => typeof x === "string")
    : [];
  return {
    headline: typeof value?.message === "string" ? value.message : apiMessage(error),
    items,
  };
}
