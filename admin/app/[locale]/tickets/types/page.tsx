"use client";

// Типы заявок: справочник того, что можно завести на планшете филиала, и поля,
// которые для этого заполняют. Создание и правка идут в боковой панели.
//
// Право одно, tickets.types.manage: на нём стоят чтение списка
// (GET /ticket_types/manage), создание и правка. Если права в сессии нет,
// вместо экрана панель с названием права, и ни один запрос не уходит.
//
// Два соседних права экрану не нужны, но от них зависят подписи: названия фирм
// читаются с tickets.contractors.manage, число заявок типа (для предупреждения
// о переименовании ключа) — с tickets.list. Без них экран работает, а
// недостающее описывает словами там, где оно понадобилось.
//
// У списка те же четыре состояния, что у остальных экранов раздела: скелет,
// пусто, 403 с названием права, ошибка сети с «Повторить». Если строки уже
// загружены, а очередной запрос упал, строки остаются, а сбой виден полосой.

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Inbox, Plus, RotateCw, ShieldAlert, SquarePen, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";

import { apiClient } from "@admin/utils/eden";
import { cn } from "@admin/lib/utils";
import { Button } from "@components/ui/buttonOrigin";
import { Skeleton } from "@components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@components/ui/table";
import { apiMessage, type ApiError, type TicketTypeRow } from "@admin/lib/tickets-api";

import { TypeSheet, type FirmsState, type TypeTarget } from "./_components/type-sheet";
import { TYPES_RIGHT, typeKeys, useFirms, useManagedTypes } from "./_components/use-types";

const NO_ROWS: TicketTypeRow[] = [];

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
          {TYPES_RIGHT}
        </code>
        <p className="max-w-xl text-[12px] leading-snug text-muted-foreground">{suffix}</p>
      </div>
    </div>
  );
}

function AccessPanel() {
  const t = useTranslations("ticketsUi.types");
  return (
    <div role="alert" className="rounded-lg border bg-card">
      <ForbiddenBody
        title={t("accessTitle")}
        prefix={t("accessPrefix")}
        suffix={t("accessSuffix")}
      />
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
// Скелет держится ровно пока нет ни данных, ни ошибки; запрос без повторов,
// поэтому зависнуть ему не на чем.
function ListFrame({
  q,
  isEmpty,
  empty,
  onRetry,
  children,
}: {
  q: QueryState;
  isEmpty: boolean;
  empty: React.ReactNode;
  onRetry: () => void;
  children: React.ReactNode;
}) {
  const t = useTranslations("ticketsUi.types");
  const tt = useTranslations("ticketsUi.table");
  const tl = useTranslations("ticketsLib");
  const apiError = q.error as ApiError | null;
  if (q.isError && !q.hasData) {
    if (apiError?.status === 403) {
      return (
        <div role="alert">
          <ForbiddenBody
            title={t("listForbiddenTitle")}
            prefix={t("listForbiddenPrefix")}
            suffix={t("listForbiddenSuffix")}
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
            {network ? tt("noConnection") : t("listLoadFailed")}
          </p>
          <p className="max-w-xl break-words text-[12.5px] leading-snug text-muted-foreground">
            {network
              ? tt("noConnectionBody")
              : apiMessage(apiError, tl)}
          </p>
          {network && (
            <p className="break-words font-mono text-[11px] text-muted-foreground">
              {apiMessage(apiError, tl)}
            </p>
          )}
          <Button variant="outline" size="sm" onClick={onRetry} disabled={q.isFetching}>
            <RotateCw className={q.isFetching ? "size-3.5 animate-spin" : "size-3.5"} />
            {q.isFetching ? tt("retrying") : tt("retry")}
          </Button>
        </div>
      </div>
    );
  }
  if (q.isPending && !q.hasData) {
    return (
      <div className="space-y-3 px-4 py-4" aria-busy="true">
        {Array.from({ length: 4 }, (_, i) => (
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
            {apiError?.status === 403 ? t("staleForbidden") : tt("staleFailed")}{" "}
            {tt("staleShown", {
              time: new Date(q.dataUpdatedAt).toLocaleTimeString("ru-RU", {
                hour: "2-digit",
                minute: "2-digit",
              }),
            })}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-6 px-2 text-[12px]"
            onClick={onRetry}
            disabled={q.isFetching}
          >
            {q.isFetching ? tt("retrying") : tt("retry")}
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

function Chip({ tone, children }: { tone: "off" | "on"; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-block rounded-full px-2 py-0.5 text-[11px] font-medium",
        tone === "on"
          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
          : "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
      )}
    >
      {children}
    </span>
  );
}

// Колонка «Исполнитель»: фирма с названием, сотрудник или предупреждение.
// external без фирмы — законное состояние «фирму ещё не выбрали», но заявку на
// такой тип не завести, и это написано прямо в строке, а не спрятано.
function ExecutorCell({ row, firms }: { row: TicketTypeRow; firms: FirmsState }) {
  const t = useTranslations("ticketsUi.types");
  if (row.executor_kind === "staff") {
    return <span className="text-muted-foreground">{t("kindStaff")}</span>;
  }
  if (!row.contractor_id) {
    return (
      <span className="flex items-start gap-1.5 text-amber-800 dark:text-amber-300">
        <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
        <span className="max-w-[16rem] text-[12.5px] leading-snug">
          {t("firmNotChosen")}
        </span>
      </span>
    );
  }
  if (firms.status === "ready") {
    const firm = firms.list.find((f) => f.id === row.contractor_id);
    if (!firm) return <span className="text-muted-foreground">{t("firmNotFound")}</span>;
    return (
      <span>
        {firm.name}
        {!firm.is_active && <span className="ml-1.5 text-muted-foreground">{t("firmDisabledParen")}</span>}
      </span>
    );
  }
  return (
    <span className="text-muted-foreground">
      {firms.status === "loading"
        ? "…"
        : firms.status === "denied"
          ? t("firmChosenDenied")
          : t("firmChosenError")}
    </span>
  );
}

const fieldCount = (row: TicketTypeRow) =>
  Array.isArray(row.fields_schema) ? row.fields_schema.length : 0;

export default function TicketTypesPage() {
  const t = useTranslations("ticketsUi.types");
  const tl = useTranslations("ticketsLib");
  // Тот же ключ, что у CanAccess и layout: один запрос на всё приложение.
  const perms = useQuery({
    queryKey: ["my_permissions"],
    queryFn: async () => (await apiClient.api.users.my_permissions.get()).data,
    retry: false,
  });
  const granted = (perms.data as { permissions?: string[] } | null | undefined)?.permissions;
  const permsKnown = Array.isArray(granted);
  const missing = permsKnown && !granted.includes(TYPES_RIGHT);
  // Eden не бросает на не-2xx, а отдаёт {data: null, error}: на истёкшей
  // сессии запрос прав «успешен» со значением null. Любое завершение запроса
  // прав, кроме рабочего списка без нужного права, передаёт решение серверу
  // (403 покажет рамка списка, 401 и 5xx её панель ошибки). Иначе страница
  // осталась бы скелетом навсегда. Пока запрос в полёте, список выключен и
  // скелет честный.
  const enabled = !missing && (permsKnown || perms.isError || perms.isSuccess);

  const qc = useQueryClient();
  const typesQ = useManagedTypes(enabled);
  const rows = typesQ.data ?? NO_ROWS;
  const firmsQ = useFirms(enabled);

  const firms: FirmsState = firmsQ.data
    ? { status: "ready", list: firmsQ.data }
    : firmsQ.isError
      ? (firmsQ.error as ApiError | null)?.status === 403
        ? { status: "denied" }
        : { status: "error", message: apiMessage(firmsQ.error, tl) }
      : { status: "loading" };

  const [target, setTarget] = useState<TypeTarget | null>(null);

  const retryTypes = () => qc.invalidateQueries({ queryKey: typeKeys.list });
  const retryFirms = () => qc.invalidateQueries({ queryKey: typeKeys.firms });

  return (
    <div className="space-y-4 pb-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">{t("title")}</h1>
          <p className="max-w-2xl text-[12px] text-muted-foreground">
            {t("subtitle")}
          </p>
        </div>
        {!missing && (
          <Button size="sm" onClick={() => setTarget({ kind: "create" })} disabled={!enabled}>
            <Plus className="size-3.5" />
            {t("addType")}
          </Button>
        )}
      </div>

      {missing ? (
        <AccessPanel />
      ) : (
        <section aria-label={t("title")} className="rounded-lg border bg-card">
          <ListFrame
            q={{
              isPending: typesQ.isPending,
              isError: typesQ.isError,
              isFetching: typesQ.isFetching,
              error: typesQ.error,
              dataUpdatedAt: typesQ.dataUpdatedAt,
              hasData: typesQ.data !== undefined,
            }}
            isEmpty={rows.length === 0}
            empty={
              <>
                <p className="text-[13px] font-medium">{t("emptyTitle")}</p>
                <p className="mx-auto mt-1 max-w-xs text-[12px] leading-snug text-muted-foreground">
                  {t("emptyBody")}
                </p>
              </>
            }
            onRetry={retryTypes}
          >
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("colName")}</TableHead>
                    <TableHead>{t("colCode")}</TableHead>
                    <TableHead>{t("colPrefix")}</TableHead>
                    <TableHead>{t("colExecutor")}</TableHead>
                    <TableHead className="text-right">{t("colFields")}</TableHead>
                    <TableHead>{t("colStatus")}</TableHead>
                    <TableHead className="w-10">
                      <span className="sr-only">{t("edit")}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id} className={cn(!r.active && "text-muted-foreground")}>
                      <TableCell>
                        <button
                          type="button"
                          onClick={() => setTarget({ kind: "edit", id: r.id })}
                          className="block max-w-[16rem] text-left outline-none hover:underline focus-visible:underline"
                        >
                          <span className="block truncate text-[13.5px] font-medium">
                            {r.name_ru}
                          </span>
                          <span className="block truncate text-[12px] text-muted-foreground">
                            {r.name_uz}
                          </span>
                        </button>
                      </TableCell>
                      <TableCell className="font-mono text-[12.5px]">{r.code}</TableCell>
                      <TableCell className="font-mono text-[12.5px]">{r.number_prefix}</TableCell>
                      <TableCell className="whitespace-normal text-[13px]">
                        <ExecutorCell row={r} firms={firms} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{fieldCount(r)}</TableCell>
                      <TableCell>
                        <Chip tone={r.active ? "on" : "off"}>{r.active ? t("active") : t("disabled")}</Chip>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          aria-label={t("editTypeAria", { name: r.name_ru })}
                          onClick={() => setTarget({ kind: "edit", id: r.id })}
                        >
                          <SquarePen className="size-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </ListFrame>
        </section>
      )}

      <TypeSheet
        target={target}
        rows={rows}
        firms={firms}
        onRetryFirms={retryFirms}
        onClose={() => setTarget(null)}
      />
    </div>
  );
}
