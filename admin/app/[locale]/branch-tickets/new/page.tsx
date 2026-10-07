"use client";

// Планшет филиала: создание заявки в два шага. Шаг 1 — крупные плитки типов,
// шаг 2 — поля выбранного типа, срочность и фотографии. Филиал и автор не
// спрашиваются на ходу: автор берётся из сессии на сервере, филиал — из
// закреплённых за пользователем (один подставляется, из нескольких менеджер
// выбирает сам).
//
// Два пункта Review Focus живут здесь и в плитках:
//  - сессия без закреплённого филиала (офисная роль) получает отказ с
//    объяснением, а не форму; типы для неё даже не запрашиваются, шага 2
//    без филиала не существует;
//  - тип без подрядной фирмы виден и нажимаем, но не пускает дальше.
//
// Право на экран: tickets.create (POST и GET /ticket_types) и
// users_terminals.list (список закреплённых филиалов). Образец проверки прав —
// tickets/payments/page.tsx: Eden не бросает на не-2xx, а отдаёт {data: null,
// error}, поэтому запрос прав, завершившийся чем угодно, кроме рабочего ответа,
// передаёт решение серверу, а не оставляет экран скелетом навсегда.
//
// После успеха уходим в список филиала с ?created=<id> (страница списка и
// подсветка — следующая задача плана). Если права на список нет, остаёмся на
// месте с подтверждением.

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "@admin/utils/eden";
import { useRouter } from "@admin/i18n/routing";
import { Skeleton } from "@components/ui/skeleton";

import { CREATE_RIGHTS, LoadFailedPanel, NoAccessPanel, UnassignedPanel } from "../_components/gate-panels";
import { CreateFlow } from "../_components/create-flow";
import { branchKeys, useCreatableTypes, useMyBranches } from "../_components/use-branch-tickets";

const REQUIRED: string[] = [CREATE_RIGHTS.create, CREATE_RIGHTS.terminals];
const LIST_RIGHT = "tickets.list";

function Loading() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Загрузка">
      <Skeleton className="h-8 w-64" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
      </div>
    </div>
  );
}

export default function NewBranchTicketPage() {
  // Тот же ключ, что у CanAccess и layout: один запрос на всё приложение.
  const perms = useQuery({
    queryKey: ["my_permissions"],
    queryFn: async () => (await apiClient.api.users.my_permissions.get()).data,
    retry: false,
  });
  const granted = (perms.data as { permissions?: string[] } | null | undefined)?.permissions;
  const permsKnown = Array.isArray(granted);
  const missing = permsKnown ? REQUIRED.filter((p) => !granted.includes(p)) : [];
  // Справочники не запрашиваем, пока права не выяснены. Завершившись чем угодно,
  // кроме рабочего списка, запрос прав отдаёт решение серверу (403 покажет
  // панель ниже), иначе экран остался бы скелетом.
  const dataEnabled = missing.length === 0 && (permsKnown || perms.isError || perms.isSuccess);
  const canOpenList = !permsKnown || granted.includes(LIST_RIGHT);

  const branches = useMyBranches(dataEnabled);
  const hasBranch = (branches.data?.length ?? 0) > 0;
  // Типы запрашиваются только для менеджера с филиалом: отказ для сессии без
  // привязки не должен зависеть от справочника.
  const types = useCreatableTypes(dataEnabled && hasBranch);

  const qc = useQueryClient();
  const router = useRouter();
  const [round, setRound] = useState(0);

  const header = (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Новая заявка</h1>
      <p className="text-base text-muted-foreground">
        Опишите, что сломалось, и приложите фотографии: заявка сразу уйдёт исполнителю.
      </p>
    </div>
  );

  let body: React.ReactNode;
  if (missing.length > 0) {
    body = <NoAccessPanel missing={missing} />;
  } else if (!dataEnabled || (!branches.data && branches.isPending)) {
    body = <Loading />;
  } else if (!branches.data) {
    // Данные в кэше важнее ошибки обновления: при сбое фонового запроса
    // заполненную форму не заменяем панелью, поэтому ветка ошибки идёт после.
    body =
      branches.error?.status === 403 ? (
        <NoAccessPanel missing={[CREATE_RIGHTS.terminals]} serverDenied />
      ) : (
        <LoadFailedPanel
          title="Не удалось определить ваш филиал"
          detail={branches.error?.message}
          onRetry={() => branches.refetch()}
          retrying={branches.isFetching}
        />
      );
  } else if (branches.data.length === 0) {
    body = <UnassignedPanel />;
  } else if (!types.data && types.isPending) {
    body = <Loading />;
  } else if (!types.data) {
    body =
      types.error?.status === 403 ? (
        <NoAccessPanel missing={[CREATE_RIGHTS.create]} serverDenied />
      ) : (
        <LoadFailedPanel
          title="Не удалось загрузить типы заявок"
          detail={types.error?.message}
          onRetry={() => types.refetch()}
          retrying={types.isFetching}
        />
      );
  } else {
    body = (
      <CreateFlow
        key={round}
        types={types.data}
        branches={branches.data}
        onCreated={(t) => {
          if (canOpenList) router.push(`/branch-tickets?created=${encodeURIComponent(t.id)}`);
        }}
        onTypesStale={() => qc.invalidateQueries({ queryKey: branchKeys.types })}
        onAnother={() => setRound((r) => r + 1)}
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 px-1 pb-28">
      {header}
      {body}
    </div>
  );
}
