"use client";

// Фирмы и исполнители: слева фирмы, справа люди выбранной фирмы. Здесь же
// выдаётся ссылка-приглашение в Telegram-бота (в панели исполнителя).
//
// Право одно, tickets.contractors.manage: все маршруты этого экрана
// (/ticket_contractors, /ticket_executors) проверяют только его, и читать
// список заявок для них не нужно. Если права в сессии нет, вместо экрана
// панель с названием права, и ни один запрос не уходит.
//
// У каждого из двух списков те же четыре состояния, что у таблицы заявок
// (tickets/data-table.tsx): скелет, пусто, 403 с названием права, ошибка сети
// с «Повторить». Если строки уже загружены, а очередной опрос упал, строки
// остаются, а сбой виден полосой над ними.

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Inbox, Plus, RotateCw, ShieldAlert, SquarePen, TriangleAlert } from "lucide-react";

import { apiClient } from "@admin/utils/eden";
import { cn } from "@admin/lib/utils";
import { Button } from "@components/ui/buttonOrigin";
import { Skeleton } from "@components/ui/skeleton";
import { apiMessage, type ApiError, type ContractorRow, type ExecutorRow } from "@admin/lib/tickets-api";

import { ContractorSheet, type ContractorTarget } from "./_components/contractor-sheet";
import { BindingChip, ExecutorSheet, langOf, type ExecutorTarget } from "./_components/executor-sheet";
import {
  CONTRACTORS_RIGHT,
  contractorKeys,
  useContractors,
  useExecutors,
} from "./_components/use-contractors";

const NO_FIRMS: ContractorRow[] = [];
const NO_EXECUTORS: ExecutorRow[] = [];

function AccessPanel() {
  return (
    <div role="alert" className="rounded-lg border bg-card">
      <ForbiddenBody
        title="Нет доступа к фирмам и исполнителям"
        prefix="Экрану нужно право"
        suffix="Попросите администратора добавить его вашей роли в форме роли, затем перезагрузите страницу."
      />
    </div>
  );
}

function ForbiddenBody({
  title,
  prefix,
  suffix,
}: {
  title: string;
  prefix: string;
  suffix: string;
}) {
  return (
    <div className="flex items-start gap-3 px-5 py-6">
      <ShieldAlert className="mt-0.5 size-5 shrink-0 text-destructive" />
      <div className="min-w-0 space-y-2.5">
        <p className="text-[14px] font-semibold leading-tight">{title}</p>
        <p className="max-w-xl text-[12.5px] leading-snug text-muted-foreground">{prefix}:</p>
        <code className="inline-block rounded bg-muted px-1.5 py-0.5 font-mono text-[12px]">
          {CONTRACTORS_RIGHT}
        </code>
        <p className="max-w-xl text-[12px] leading-snug text-muted-foreground">{suffix}</p>
      </div>
    </div>
  );
}

type QueryState = {
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  error: unknown;
  dataUpdatedAt: number;
  hasData: boolean;
};

// Рамка списка: выбирает между скелетом, отказом, ошибкой, «пусто» и строками.
// Скелет держится ровно пока нет ни данных, ни ошибки; запросы без повторов,
// поэтому зависнуть ему не на чем.
function ListFrame({
  q,
  what,
  isEmpty,
  empty,
  onRetry,
  skeletonRows,
  children,
}: {
  q: QueryState;
  what: string;
  isEmpty: boolean;
  empty: React.ReactNode;
  onRetry: () => void;
  skeletonRows: number;
  children: React.ReactNode;
}) {
  const apiError = q.error as ApiError | null;
  if (q.isError && !q.hasData) {
    if (apiError?.status === 403) {
      return (
        <div role="alert">
          <ForbiddenBody
            title={`Нет доступа к списку ${what}`}
            prefix="Сервер ответил отказом (403). Нужно право"
            suffix="Попросите администратора добавить его вашей роли, затем перезагрузите страницу."
          />
        </div>
      );
    }
    const network = apiError?.status === undefined;
    return (
      <div role="alert" className="flex items-start gap-3 px-5 py-6">
        <TriangleAlert className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="min-w-0 space-y-2.5">
          <p className="text-[14px] font-semibold leading-tight">
            {network ? "Нет связи с сервером" : `Не удалось загрузить список ${what}`}
          </p>
          <p className="max-w-xl break-words text-[12.5px] leading-snug text-muted-foreground">
            {network
              ? "Запрос не дошёл до сервера. Проверьте соединение и повторите."
              : apiMessage(apiError)}
          </p>
          {network && (
            <p className="break-words font-mono text-[11px] text-muted-foreground">
              {apiMessage(apiError)}
            </p>
          )}
          <Button variant="outline" size="sm" onClick={onRetry} disabled={q.isFetching}>
            <RotateCw className={q.isFetching ? "size-3.5 animate-spin" : "size-3.5"} />
            {q.isFetching ? "Повторяем…" : "Повторить"}
          </Button>
        </div>
      </div>
    );
  }
  if (q.isPending && !q.hasData) {
    return (
      <div className="space-y-3 px-4 py-4" aria-busy="true">
        {Array.from({ length: skeletonRows }, (_, i) => (
          <div key={i} className="space-y-1.5">
            <Skeleton className={cn("h-4", i % 2 ? "w-36" : "w-52")} />
            <Skeleton className="h-3 w-24" />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div>
      {q.isError && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-[12px] text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200"
        >
          <TriangleAlert className="size-3.5 shrink-0" />
          <span>
            {apiError?.status === 403 ? "Доступ пропал." : "Не удалось обновить список."} Показаны
            данные на{" "}
            {new Date(q.dataUpdatedAt).toLocaleTimeString("ru-RU", {
              hour: "2-digit",
              minute: "2-digit",
            })}
            .
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-6 px-2 text-[12px]"
            onClick={onRetry}
            disabled={q.isFetching}
          >
            {q.isFetching ? "Повторяем…" : "Повторить"}
          </Button>
        </div>
      )}
      {isEmpty ? (
        <div className="px-5 py-10 text-center">
          <Inbox className="mx-auto mb-2 size-5 text-muted-foreground" />
          {empty}
        </div>
      ) : (
        children
      )}
    </div>
  );
}

const blank = (v: string | null | undefined) => (v && v.trim() !== "" ? v : null);

function FirmRow({
  firm,
  selected,
  onSelect,
  onEdit,
}: {
  firm: ContractorRow;
  selected: boolean;
  onSelect: () => void;
  onEdit: () => void;
}) {
  return (
    <li className={cn("flex items-stretch border-b last:border-b-0", selected && "bg-muted/60")}>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        className="min-w-0 flex-1 px-4 py-2.5 text-left outline-none hover:bg-muted/40 focus-visible:bg-muted/60"
      >
        <span className="flex items-center gap-2">
          <span
            className={cn(
              "truncate text-[13.5px] font-medium",
              !firm.is_active && "text-muted-foreground"
            )}
          >
            {firm.name}
          </span>
          {!firm.is_active && (
            <span className="shrink-0 rounded-full bg-zinc-200 px-2 py-0.5 text-[11px] font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
              Выключена
            </span>
          )}
        </span>
        <span className="block truncate text-[12px] text-muted-foreground">
          {blank(firm.phone) ?? "телефон не указан"}
        </span>
      </button>
      <Button
        variant="ghost"
        size="sm"
        className="my-auto mr-2 h-8 w-8 shrink-0 p-0"
        aria-label={`Изменить фирму ${firm.name}`}
        onClick={onEdit}
      >
        <SquarePen className="size-4" />
      </Button>
    </li>
  );
}

function ExecutorRowView({ ex, onOpen }: { ex: ExecutorRow; onOpen: () => void }) {
  return (
    <li className="border-b last:border-b-0">
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5 text-left outline-none hover:bg-muted/40 focus-visible:bg-muted/60"
      >
        <span className="min-w-0 flex-1 basis-48">
          <span
            className={cn(
              "block truncate text-[13.5px] font-medium",
              !ex.is_active && "text-muted-foreground"
            )}
          >
            {ex.full_name}
          </span>
          <span className="block truncate text-[12px] text-muted-foreground">
            {blank(ex.phone) ?? "телефон не указан"} · {langOf(ex.lang) === "uz" ? "Oʻzbekcha" : "Русский"}
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          <BindingChip row={ex} />
          {!ex.is_active && (
            <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-[11px] font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
              Выключен
            </span>
          )}
        </span>
      </button>
    </li>
  );
}

export default function ContractorsPage() {
  // Тот же ключ, что у CanAccess и layout: один запрос на всё приложение.
  const perms = useQuery({
    queryKey: ["my_permissions"],
    queryFn: async () => (await apiClient.api.users.my_permissions.get()).data,
    retry: false,
  });
  const granted = (perms.data as { permissions?: string[] } | null | undefined)?.permissions;
  const permsKnown = Array.isArray(granted);
  const missing = permsKnown && !granted.includes(CONTRACTORS_RIGHT);
  // Eden не бросает на не-2xx, а отдаёт {data: null, error}: на истёкшей
  // сессии запрос прав «успешен» со значением null. Любое завершение запроса
  // прав, кроме рабочего списка без нужного права, передаёт решение серверу
  // (403 покажет рамка списка, 401 и 5xx её панель ошибки). Иначе страница
  // осталась бы скелетом навсегда. Пока запрос в полёте, списки выключены и
  // скелет честный.
  const listsEnabled = !missing && (permsKnown || perms.isError || perms.isSuccess);

  const qc = useQueryClient();
  const firmsQ = useContractors(listsEnabled);
  const firms = firmsQ.data ?? NO_FIRMS;

  const [pickedId, setPickedId] = useState<string | null>(null);
  // Выбор выводится, а не копируется в эффект: если выбранной фирмы в списке
  // нет (ещё не загружен, пропала), берём первую.
  const selected = firms.find((f) => f.id === pickedId) ?? firms[0] ?? null;

  const executorsQ = useExecutors(selected?.id ?? null, listsEnabled);
  const executors = executorsQ.data ?? NO_EXECUTORS;

  const [firmTarget, setFirmTarget] = useState<ContractorTarget | null>(null);
  const [personTarget, setPersonTarget] = useState<ExecutorTarget | null>(null);

  const retryFirms = () => qc.invalidateQueries({ queryKey: contractorKeys.firms });
  const retryExecutors = () => qc.invalidateQueries({ queryKey: contractorKeys.executorsAll });

  return (
    <div className="space-y-4 pb-10">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Фирмы и исполнители</h1>
        <p className="text-[12px] text-muted-foreground">
          Подрядчики, которым уходят заявки, и их люди. Здесь же человека приглашают в Telegram-бота:
          он получает заявки, пока привязан и активен.
        </p>
      </div>

      {missing ? (
        <AccessPanel />
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
          <section aria-label="Фирмы" className="rounded-lg border bg-card">
            <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
              <h2 className="text-[13px] font-semibold">Фирмы</h2>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setFirmTarget({ kind: "create" })}
                disabled={!listsEnabled}
              >
                <Plus className="size-3.5" />
                Добавить
              </Button>
            </div>
            <ListFrame
              q={{
                isPending: firmsQ.isPending,
                isError: firmsQ.isError,
                isFetching: firmsQ.isFetching,
                error: firmsQ.error,
                dataUpdatedAt: firmsQ.dataUpdatedAt,
                hasData: firmsQ.data !== undefined,
              }}
              what="фирм"
              isEmpty={firms.length === 0}
              empty={
                <>
                  <p className="text-[13px] font-medium">Фирм пока нет</p>
                  <p className="mx-auto mt-1 max-w-xs text-[12px] leading-snug text-muted-foreground">
                    Добавьте первую фирму, затем её людей.
                  </p>
                </>
              }
              onRetry={retryFirms}
              skeletonRows={4}
            >
              <ul>
                {firms.map((f) => (
                  <FirmRow
                    key={f.id}
                    firm={f}
                    selected={f.id === selected?.id}
                    onSelect={() => setPickedId(f.id)}
                    onEdit={() => setFirmTarget({ kind: "edit", id: f.id })}
                  />
                ))}
              </ul>
            </ListFrame>
          </section>

          <section aria-label="Исполнители" className="rounded-lg border bg-card">
            <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
              <h2 className="min-w-0 truncate text-[13px] font-semibold">
                {selected ? `Исполнители: ${selected.name}` : "Исполнители"}
              </h2>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setPersonTarget({ kind: "create" })}
                disabled={!selected}
              >
                <Plus className="size-3.5" />
                Добавить
              </Button>
            </div>
            {selected === null ? (
              <p className="px-5 py-10 text-center text-[12.5px] text-muted-foreground">
                {firmsQ.isError || firmsQ.isPending
                  ? "Исполнители появятся, когда загрузится список фирм."
                  : "Сначала добавьте фирму."}
              </p>
            ) : (
              <ListFrame
                q={{
                  isPending: executorsQ.isPending,
                  isError: executorsQ.isError,
                  isFetching: executorsQ.isFetching,
                  error: executorsQ.error,
                  dataUpdatedAt: executorsQ.dataUpdatedAt,
                  hasData: executorsQ.data !== undefined,
                }}
                what="исполнителей"
                isEmpty={executors.length === 0}
                empty={
                  <>
                    <p className="text-[13px] font-medium">В этой фирме пока никого нет</p>
                    <p className="mx-auto mt-1 max-w-sm text-[12px] leading-snug text-muted-foreground">
                      Добавьте человека, затем откройте его и выдайте ссылку-приглашение в бот.
                    </p>
                  </>
                }
                onRetry={retryExecutors}
                skeletonRows={3}
              >
                {!selected.is_active && (
                  <p className="border-b px-4 py-2 text-[12px] text-muted-foreground">
                    Фирма выключена. Её люди остаются в справочнике.
                  </p>
                )}
                <ul>
                  {executors.map((x) => (
                    <ExecutorRowView
                      key={x.id}
                      ex={x}
                      onOpen={() => setPersonTarget({ kind: "edit", id: x.id })}
                    />
                  ))}
                </ul>
              </ListFrame>
            )}
          </section>
        </div>
      )}

      <ContractorSheet
        target={firmTarget}
        firms={firms}
        onClose={() => setFirmTarget(null)}
        onSaved={(row) => setPickedId(row.id)}
      />
      <ExecutorSheet
        target={personTarget}
        contractor={selected}
        executors={executors}
        onClose={() => setPersonTarget(null)}
      />
    </div>
  );
}
