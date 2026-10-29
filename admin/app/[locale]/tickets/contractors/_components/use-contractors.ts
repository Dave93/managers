"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createContractor,
  createExecutor,
  issueInvite,
  listContractors,
  listExecutors,
  updateContractor,
  updateExecutor,
  type ContractorCreateInput,
  type ContractorUpdateInput,
  apiMessage,
  type ApiError,
  type ExecutorUpdateInput,
} from "@admin/lib/tickets-api";

// Единственное право всего экрана: оба набора маршрутов (фирмы и исполнители)
// проверяют только его. Название стоит дословно, его копируют в форму роли.
export const CONTRACTORS_RIGHT = "tickets.contractors.manage";

// Текст сбоя записи. У 403 и обрыва связи свои слова: «Не удалось выполнить
// запрос» не говорит ни где чинить, ни сохранилось ли что-нибудь.
export function useMutationErrorText(): (error: unknown) => string {
  const t = useTranslations("ticketsUi.contractors.mutation");
  const tl = useTranslations("ticketsLib");
  return (error) => {
    const status = (error as ApiError | null)?.status;
    if (status === 403) return t("forbidden", { right: CONTRACTORS_RIGHT });
    if (status === undefined) return t("noConnection", { message: apiMessage(error, tl) });
    return apiMessage(error, tl);
  };
}

// Ключи из плана: фирмы одним списком, исполнители по фирме. Инвалидация идёт
// по префиксу ["ticket_executors"]: правка человека из другой фирмы не должна
// оставить кэш этой устаревшим, а списки крошечные.
export const contractorKeys = {
  firms: ["ticket_contractors"] as const,
  executorsAll: ["ticket_executors"] as const,
  executors: (contractorId: string) => ["ticket_executors", contractorId] as const,
};

// Те же два параметра, что у FAIL_FAST в lib/use-tickets.ts (там он не
// экспортируется, поэтому повторены здесь): без повторов отказ и обрыв сети
// сразу доходят до экрана, а networkMode "always" не даёт запросу молча
// зависнуть «на паузе» в скрытой вкладке.
const FAIL_FAST = { retry: false, networkMode: "always" } as const;

export function useContractors(enabled: boolean) {
  return useQuery({
    queryKey: contractorKeys.firms,
    queryFn: async () => (await listContractors()).data,
    enabled,
    ...FAIL_FAST,
  });
}

// Человек привязывается к боту сам, открыв ссылку в Telegram, а владелец при
// этом смотрит на экран. Раз в 20 секунд список подтягивает «Привязан».
export function useExecutors(contractorId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: contractorKeys.executors(contractorId ?? ""),
    queryFn: async () => (await listExecutors(contractorId as string)).data,
    enabled: enabled && contractorId !== null,
    refetchInterval: 20_000,
    ...FAIL_FAST,
  });
}

export function useContractorActions() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: contractorKeys.firms });
  return {
    create: useMutation({
      mutationFn: (body: ContractorCreateInput) => createContractor(body),
      onSuccess: invalidate,
      networkMode: "always",
    }),
    update: useMutation({
      mutationFn: (v: { id: string; body: ContractorUpdateInput }) => updateContractor(v.id, v.body),
      onSuccess: invalidate,
      networkMode: "always",
    }),
  };
}

// Этот экран ведёт только внешних людей фирмы. Вход создания намеренно не
// содержит ни kind, ни user_id: kind зашит ниже, а у external user_id
// запрещён (ограничение ticket_executors_kind_target), так что собрать из
// формы сотрудника невозможно.
export type NewExecutorInput = {
  contractorId: string;
  full_name: string;
  phone?: string;
  lang: "ru" | "uz";
};

export function useExecutorActions() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: contractorKeys.executorsAll });
  return {
    create: useMutation({
      mutationFn: (v: NewExecutorInput) =>
        createExecutor({
          kind: "external",
          contractor_id: v.contractorId,
          full_name: v.full_name,
          ...(v.phone ? { phone: v.phone } : {}),
          lang: v.lang,
        }),
      onSuccess: invalidate,
      networkMode: "always",
    }),
    update: useMutation({
      mutationFn: (v: { id: string; body: ExecutorUpdateInput }) => updateExecutor(v.id, v.body),
      onSuccess: invalidate,
      networkMode: "always",
    }),
  };
}

// Выдача ссылки: gcTime 0, чтобы одноразовая ссылка не лежала в кэше мутаций
// после закрытия панели, а жила только в компоненте, который её показывает.
// Список обновляется и при провале (onSettled): при обрыве связи неизвестно,
// дошёл ли запрос, а сервер на каждый успешный сбрасывает invite_used_at.
export function useIssueInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => issueInvite(id),
    onSettled: () => qc.invalidateQueries({ queryKey: contractorKeys.executorsAll }),
    gcTime: 0,
    retry: false,
    networkMode: "always",
  });
}

// Панель закрывается за 300 мс, и Radix всё это время рисует уходящий
// контент. Пока target уже null, показываем последний. «Эпоха» растёт при
// каждом новом открытии и служит ключом: повторное открытие того же человека
// не приносит ни старый черновик, ни старую ошибку, ни старую ссылку.
// Тот же приём, что useSheetSession в карточке заявки.
export function useSheetSession<T>(target: T | null) {
  const [s, setS] = useState<{ prev: T | null; shown: T | null; epoch: number }>({
    prev: target,
    shown: target,
    epoch: 0,
  });
  if (target !== s.prev) {
    setS({
      prev: target,
      shown: target ?? s.shown,
      epoch: target !== null && s.prev === null ? s.epoch + 1 : s.epoch,
    });
  }
  return { shown: s.shown, epoch: s.epoch };
}
