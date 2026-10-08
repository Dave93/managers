"use client";

// Планшет филиала: список заявок и приёмка работы. Карточками, а не таблицей: у
// филиала единицы заявок, а не сотни. Порядок групп задан тем, что требует
// действия: «Ждут вашего подтверждения», «В работе», «Новые»; закрытые и
// отменённые за вкладкой.
//
// Что здесь сделано нарочно:
//  * Права и филиалы те же, что у экрана создания (new/page.tsx): запрос прав
//    с тем же ключом, филиалы из того же хука useMyBranches (снимок сессии из
//    /users/me). Третьего способа определить филиалы нет. Eden не бросает на
//    не-2xx, а отдаёт {data: null, error}, поэтому запрос прав, завершившийся
//    чем угодно, кроме рабочего ответа, передаёт решение серверу, а не оставляет
//    экран скелетом навсегда.
//  * Список запрашивается по филиалам сессии явным фильтром: у роли с
//    tickets.list_all сервер скоуп не накладывает, а планшет отвечает за свои
//    филиалы (и markSeen на чужих отвечал бы 404). Активные заявки и закрытые
//    идут разными запросами: общий список «новые сверху» с пределом 200 рано или
//    поздно вытеснил бы зависшую заявку закрытыми. Все ключи лежат под
//    ["tickets"], потому что создание заявки и действия инвалидируют именно его.
//  * Свежая заявка в статусе new не прячется никакими фильтрами: активные
//    статусы входят в запрос целиком.
//  * ?created=<id> приходит с экрана создания (там только id). Заявка ищется в
//    списке, чтобы показать номер и подсветить карточку; если её там нет,
//    номер берётся из карточки. Эта ссылка ничего не открывает и не отмечает
//    прочитанным.
//  * «Филиал посмотрел» (markSeen) ставит только открытая панель приёмки.

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Plus, RotateCw, ShieldAlert, Store, X } from "lucide-react";

import { apiClient } from "@admin/utils/eden";
import { Link, useRouter } from "@admin/i18n/routing";
import { Button } from "@components/ui/buttonOrigin";
import { Skeleton } from "@components/ui/skeleton";
import { cn } from "@admin/lib/utils";
import { type ApiError, type TicketRow, type TicketTypeRow } from "@admin/lib/tickets-api";
import {
  ACTIVE_STATUSES,
  FINISHED_STATUSES,
  branchFilters,
  countGroups,
  createdIdFrom,
  groupTickets,
} from "@admin/lib/tickets-branch";
import { useTicketCard, useTicketList } from "@admin/lib/use-tickets";

import { symptomOf } from "../tickets/columns";
import { LoadFailedPanel } from "./_components/gate-panels";
import { useCreatableTypes, useMyBranches } from "./_components/use-branch-tickets";
import { AcceptPanel } from "./_components/accept-panel";
import { BranchTicketCard } from "./_components/ticket-card";

const LIST_RIGHT = "tickets.list";
const CREATE_RIGHT = "tickets.create";
const CLOSE_RIGHT = "tickets.close";
// Планшет живёт под tickets.create (по нему же пункт меню), а чтение заявок
// требует ещё и tickets.list: без любого из двух экран не открывается.
const REQUIRED: string[] = [CREATE_RIGHT, LIST_RIGHT];
const ACTIVE_LIMIT = 200;
const FINISHED_LIMIT = 50;

function Loading() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Загрузка">
      <Skeleton className="h-8 w-64" />
      <div className="grid gap-3 md:grid-cols-2">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
    </div>
  );
}

function NoListAccess({ missing, serverDenied }: { missing: string[]; serverDenied?: boolean }) {
  return (
    <div role="alert" className="rounded-lg border bg-card">
      <div className="flex items-start gap-3 px-5 py-6">
        <ShieldAlert className="mt-0.5 size-6 shrink-0 text-destructive" />
        <div className="min-w-0 space-y-2.5">
          <p className="text-base font-semibold leading-tight">Нет доступа к заявкам филиала</p>
          <p className="max-w-xl text-sm leading-snug text-muted-foreground">
            {serverDenied ? "Сервер ответил отказом (403). " : ""}
            Экрану нужны два права:{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[13px]">{CREATE_RIGHT}</code> (планшет
            филиала) и <code className="rounded bg-muted px-1 py-0.5 font-mono text-[13px]">{LIST_RIGHT}</code>{" "}
            (смотреть заявки своего филиала). У вашей роли не хватает:
          </p>
          <ul className="space-y-1">
            {missing.map((p) => (
              <li key={p}>
                <code className="inline-block rounded bg-muted px-1.5 py-0.5 font-mono text-[13px]">{p}</code>
              </li>
            ))}
          </ul>
          <p className="max-w-xl text-sm leading-snug text-muted-foreground">
            Попросите администратора добавить их роли, затем перезагрузите страницу.
          </p>
        </div>
      </div>
    </div>
  );
}

// Не то же, что UnassignedPanel экрана создания: тот объясняет, почему нельзя
// СОЗДАТЬ заявку, а сюда приходят смотреть и принимать.
function NoBranchPanel() {
  return (
    <div role="alert" className="rounded-lg border bg-card">
      <div className="flex items-start gap-3 px-5 py-6">
        <Store className="mt-0.5 size-6 shrink-0 text-muted-foreground" />
        <div className="min-w-0 space-y-2">
          <p className="text-base font-semibold leading-tight">У вашей роли нет привязки к филиалу</p>
          <p className="max-w-xl text-sm leading-snug text-muted-foreground">
            Заявки показываются по филиалу сотрудника, а за вашей ролью филиал не закреплён, поэтому показывать
            нечего. Если вы менеджер, попросите администратора закрепить за вами филиал и войдите заново.
          </p>
        </div>
      </div>
    </div>
  );
}

function Group({
  title,
  rows,
  render,
}: {
  title: string;
  rows: TicketRow[];
  render: (row: TicketRow) => React.ReactNode;
}) {
  if (rows.length === 0) return null;
  return (
    <section className="space-y-3" aria-label={title}>
      <h2 className="flex items-baseline gap-2 text-lg font-semibold">
        {title}
        <span className="text-base font-normal tabular-nums text-muted-foreground">{rows.length}</span>
      </h2>
      <div className="grid gap-3 md:grid-cols-2">{rows.map(render)}</div>
    </section>
  );
}

type ListState = ReturnType<typeof useTicketList>;

// Состояния списка различимы и ни одно не вечное: загрузка, отказ (403),
// ошибка сети/сервера с «Повторить». Данные в кэше важнее ошибки обновления:
// при сбое фонового запроса показанный список остаётся с короткой пометкой.
function ListStatus({ q, what }: { q: ListState; what: string }) {
  if (q.data) {
    return q.isError ? (
      <p role="alert" className="flex flex-wrap items-center gap-3 text-sm text-amber-700 dark:text-amber-400">
        Не удалось обновить {what}: показаны прошлые данные.
        <Button variant="outline" className="h-11 px-4 text-base" onClick={() => q.refetch()} disabled={q.isFetching}>
          <RotateCw className={q.isFetching ? "size-4 animate-spin" : "size-4"} />
          Повторить
        </Button>
      </p>
    ) : null;
  }
  if (q.isPending) return <Loading />;
  if ((q.error as ApiError | null)?.status === 403) return <NoListAccess missing={[LIST_RIGHT]} serverDenied />;
  return (
    <LoadFailedPanel
      title={`Не удалось загрузить ${what}`}
      detail={q.error?.message}
      onRetry={() => q.refetch()}
      retrying={q.isFetching}
    />
  );
}

function CreatedBanner({
  createdId,
  rows,
  listSettled,
  onDismiss,
}: {
  createdId: string;
  rows: TicketRow[] | undefined;
  listSettled: boolean;
  onDismiss: () => void;
}) {
  const inList = rows?.find((r) => r.id === createdId);
  // Номер берётся из списка; карточка нужна, только когда список уже
  // перечитан, а заявки в нём нет (не туда ушла, закрыта, чужой филиал).
  const card = useTicketCard(!inList && listSettled ? createdId : null);
  const number = inList?.number ?? card.data?.number ?? null;
  const missing = !inList && listSettled && card.isError;
  // Заявка есть, а в активных её нет: закрыта или отменена уже сейчас, либо не
  // влезла в предел списка. Первое объясняем вкладкой, второе просим обновить.
  const finishedStatus = card.data?.status === "closed" || card.data?.status === "cancelled";
  const hiddenNote =
    !inList && listSettled && card.data
      ? finishedStatus
        ? " Она уже закрыта или отменена: смотрите вкладку «Закрытые и отменённые»."
        : " В списке её пока не видно: обновите страницу."
      : "";

  return (
    <div
      role="status"
      data-created-banner
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3",
        missing
          ? "border-amber-600/50 bg-amber-50 text-amber-950 dark:bg-amber-950/30 dark:text-amber-100"
          : "border-emerald-600/50 bg-emerald-50 text-emerald-950 dark:bg-emerald-950/30 dark:text-emerald-100"
      )}
    >
      <CheckCircle2 className="size-5 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1 text-base font-medium">
        {missing
          ? "Заявка создана, но найти её среди заявок вашего филиала не удалось. Обновите страницу."
          : number
            ? `Заявка ${number} создана.`
            : "Заявка создана."}
        {hiddenNote}
      </p>
      <Button variant="outline" className="h-11 px-4 text-base" onClick={onDismiss}>
        <X className="size-4" aria-hidden />
        Скрыть
      </Button>
    </div>
  );
}

function FinishedList({
  branchIds,
  showBranch,
  types,
  onOpen,
}: {
  branchIds: string[];
  showBranch: boolean;
  types: TicketTypeRow[] | undefined;
  onOpen: (id: string) => void;
}) {
  const q = useMemo(
    () => ({ limit: FINISHED_LIMIT, offset: 0, filters: branchFilters(FINISHED_STATUSES, branchIds) }),
    [branchIds]
  );
  const list = useTicketList(q);
  const rows = list.data?.data ?? [];
  return (
    <div className="space-y-4">
      <ListStatus q={list} what="закрытые заявки" />
      {list.data && rows.length === 0 && (
        <p className="rounded-lg border border-dashed px-4 py-8 text-center text-base text-muted-foreground">
          Закрытых и отменённых заявок пока нет.
        </p>
      )}
      {rows.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          {rows.map((r) => (
            <BranchTicketCard
              key={r.id}
              row={r}
              symptom={symptomOf(r, types)}
              branchName={showBranch ? r.terminal_name : null}
              finished
              highlighted={false}
              onOpen={onOpen}
            />
          ))}
        </div>
      )}
      {list.data && list.data.total > rows.length && (
        <p className="text-sm text-muted-foreground">
          Показаны последние {rows.length} из {list.data.total}.
        </p>
      )}
    </div>
  );
}

function BranchTicketsPage() {
  // Тот же ключ, что у CanAccess и layout: один запрос на всё приложение.
  const perms = useQuery({
    queryKey: ["my_permissions"],
    queryFn: async () => (await apiClient.api.users.my_permissions.get()).data,
    retry: false,
  });
  const granted = (perms.data as { permissions?: string[] } | null | undefined)?.permissions;
  const permsKnown = Array.isArray(granted);
  const missing = permsKnown ? REQUIRED.filter((p) => !granted.includes(p)) : [];
  // Пока запрос прав не завершился, данные не запрашиваем. Завершившись чем
  // угодно, кроме рабочего ответа, он передаёт решение серверу (см. шапку).
  const dataEnabled = missing.length === 0 && (permsKnown || perms.isError || perms.isSuccess);
  // Без списка прав решает сервер: кнопка, которую он откажет, лучше отсутствующей.
  const canClose = !permsKnown || granted.includes(CLOSE_RIGHT);

  const branches = useMyBranches(dataEnabled);
  const branchIds = useMemo(() => (branches.data ?? []).map((b) => b.id).sort(), [branches.data]);
  const hasBranch = branchIds.length > 0;
  const listEnabled = dataEnabled && hasBranch;
  // Типы нужны только для подписей симптома: без них (нет tickets.create, сбой)
  // показываются сырые значения полей, а экран работает.
  const types = useCreatableTypes(listEnabled);

  const activeQuery = useMemo(
    () => ({ limit: ACTIVE_LIMIT, offset: 0, filters: branchFilters(ACTIVE_STATUSES, branchIds) }),
    [branchIds]
  );
  const active = useTicketList(activeQuery, listEnabled);
  const rows = active.data?.data;
  const groups = useMemo(() => groupTickets(rows ?? []), [rows]);
  const activeCount = countGroups(groups);

  const [view, setView] = useState<"active" | "finished">("active");
  const [openId, setOpenId] = useState<string | null>(null);

  // Подпись филиала на карточке нужна, только когда их несколько.
  const showBranch = (branches.data?.length ?? 0) > 1;

  // ?created=<id>
  const search = useSearchParams();
  const router = useRouter();
  const createdFromUrl = createdIdFrom(search.get("created"));
  const [dismissed, setDismissed] = useState(false);
  const createdId = dismissed ? null : createdFromUrl;
  // «Список уже перечитан после перехода»: isFetching гас бы на каждом фоновом
  // опросе раз в минуту, и баннер мигал бы (номер пропадал, ошибка зеленела).
  const listSettled = active.isSuccess && active.isFetchedAfterMount;
  const highlightedRow = createdId ? rows?.find((r) => r.id === createdId) : undefined;
  const scrolled = useRef<string | null>(null);
  useEffect(() => {
    if (!createdId || !highlightedRow || scrolled.current === createdId) return;
    scrolled.current = createdId;
    document.getElementById(`ticket-${createdId}`)?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  }, [createdId, highlightedRow]);

  // Без привязки к филиалу или без прав создавать нечего: экран создания
  // ответил бы тем же отказом.
  const unassigned = branches.data !== undefined && branches.data.length === 0;
  const header = (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Заявки филиала</h1>
        <p className="text-base text-muted-foreground">
          {branches.data && branches.data.length > 0
            ? branches.data.map((b) => b.name).join(", ")
            : "Что сломалось, кто взял и что ждёт вашего решения."}
        </p>
      </div>
      {!unassigned && missing.length === 0 && (
        <Button asChild className="h-12 px-6 text-base">
          <Link href="/branch-tickets/new">
            <Plus className="size-5" aria-hidden />
            Новая заявка
          </Link>
        </Button>
      )}
    </div>
  );

  const typeRows = types.data;
  const open = (id: string) => setOpenId(id);

  let body: React.ReactNode;
  if (missing.length > 0) {
    body = <NoListAccess missing={missing} />;
  } else if (!dataEnabled || (!branches.data && branches.isPending)) {
    body = <Loading />;
  } else if (!branches.data) {
    // Данные в кэше важнее ошибки обновления, поэтому ветка ошибки идёт после.
    body = (
      <LoadFailedPanel
        title="Не удалось определить ваш филиал"
        detail={
          branches.error?.status === 403
            ? "Сервер отказал в доступе к данным сессии (403). Войдите заново; если не помогло, обратитесь к администратору."
            : branches.error?.message
        }
        onRetry={() => branches.refetch()}
        retrying={branches.isFetching}
      />
    );
  } else if (!hasBranch) {
    body = <NoBranchPanel />;
  } else {
    body = (
      <div className="space-y-5">
        {createdId && (
          <CreatedBanner
            createdId={createdId}
            rows={rows}
            listSettled={listSettled}
            onDismiss={() => {
              setDismissed(true);
              router.replace("/branch-tickets");
            }}
          />
        )}

        <div role="tablist" aria-label="Заявки" className="flex flex-wrap gap-2">
          {(
            [
              ["active", active.data ? `Активные (${activeCount})` : "Активные"],
              ["finished", "Закрытые и отменённые"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={view === key}
              onClick={() => setView(key)}
              className={cn(
                "h-11 rounded-full border px-5 text-base font-medium outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
                view === key ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted/60"
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {view === "active" ? (
          <div className="space-y-6">
            <ListStatus q={active} what="заявки" />
            {active.data && activeCount === 0 && (
              <div className="space-y-3 rounded-lg border border-dashed px-4 py-10 text-center">
                <p className="text-base text-muted-foreground">Активных заявок нет: всё закрыто или ещё ничего не создано.</p>
                <Button asChild variant="outline" className="h-12 px-6 text-base">
                  <Link href="/branch-tickets/new">Создать заявку</Link>
                </Button>
              </div>
            )}
            {(
              [
                ["Ждут вашего подтверждения", groups.awaiting],
                ["В работе", groups.inProgress],
                ["Новые", groups.fresh],
              ] as const
            ).map(([title, list]) => (
              <Group
                key={title}
                title={title}
                rows={list}
                render={(r) => (
                  <BranchTicketCard
                    key={r.id}
                    row={r}
                    symptom={symptomOf(r, typeRows)}
                    branchName={showBranch ? r.terminal_name : null}
                    finished={false}
                    highlighted={r.id === createdId}
                    onOpen={open}
                  />
                )}
              />
            ))}
            {active.data && active.data.total > (rows?.length ?? 0) && (
              <p className="text-sm text-muted-foreground">
                Показаны {rows?.length} из {active.data.total} активных заявок.
              </p>
            )}
          </div>
        ) : (
          <FinishedList branchIds={branchIds} showBranch={showBranch} types={typeRows} onOpen={open} />
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 px-1 pb-16">
      {header}
      {body}
      <AcceptPanel ticketId={openId} canClose={canClose} onClose={() => setOpenId(null)} />
    </div>
  );
}

// useSearchParams на статически собираемой странице без Suspense валит
// `next build`, а неудачная сборка стирает рабочий .next.
export default function BranchTicketsRoute() {
  return (
    <Suspense fallback={<Loading />}>
      <BranchTicketsPage />
    </Suspense>
  );
}
