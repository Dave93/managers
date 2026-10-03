"use client";

// Состав филиалов — экран, на котором видно не «сколько людей», а «кто и где».
//
// Три вещи, которые он обязан не соврать:
//
//   1. Филиал без строк в справочнике — это НЕ филиал без людей. Таких 38 из 72.
//      Они не прячутся, не смешиваются с остальными и не считаются нулём: своя
//      группа в конце, своя подпись про незаведённый справочник. Разница не
//      косметическая — на таком филиале нельзя завести стажировку, значит
//      паспорт стажёра там не заработает.
//
//   2. Сигналы важнее фамилий. Десять филиалов без менеджера, восемь без
//      старшего повара, двадцать без единого человека в ночь — это то, ради
//      чего экран существует, и это стоит выше списков, а не под ними.
//
//   3. Фильтры реально сужают выдачу. Сигнал, по которому нельзя кликнуть и
//      увидеть эти самые филиалы, — плакат, а не инструмент.
//
// Всё, что здесь считается, — это пересечения и подсчёты по уже разобранному
// ответу. Разбор должности, приведение имён и сами сигналы живут на бэкенде.

import * as React from "react";
import { Loader2, Plus, ShieldAlert, UsersRound } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@admin/lib/utils";
import { Button } from "@admin/components/ui/buttonOrigin";
import AttestationEmployeeFormSheet from "@admin/components/forms/attestation-employee/sheet";
import type { Branch, Person } from "./_components/use-staff-board";
import {
  useCanEditEmployees,
  useStaffBoard,
} from "./_components/use-staff-board";
import { BranchCard, NoDataCard } from "./_components/branch-card";
import {
  EMPTY_FILTERS,
  FilterBar,
  SummaryStrip,
  filtersActive,
  peopleLevelFilters,
  type BoardFilters,
} from "./_components/board-header";

const norm = (s: string) => s.trim().toLocaleLowerCase("ru-RU");
const has = (haystack: string | null | undefined, needle: string) =>
  (haystack ?? "").toLocaleLowerCase("ru-RU").includes(needle);

export default function StaffBoardPage() {
  const t = useTranslations("attestation");
  const q = useStaffBoard();
  // Читать состав можно по employees.list, заводить человека — по
  // employees.edit. Право спрашивается один раз здесь и раздаётся карточкам
  // пропом: 72 одинаковых хука ради одного и того же ответа не нужны.
  const canEdit = useCanEditEmployees();
  const [filters, setFilters] = React.useState<BoardFilters>(EMPTY_FILTERS);

  const branches: Branch[] = q.data?.branches ?? [];
  const network = q.data?.network ?? null;

  const bq = norm(filters.branchQuery);
  const eq = norm(filters.employeeQuery);
  const peopleFilters = peopleLevelFilters(filters);

  const matchesBranch = React.useCallback(
    (b: Branch) =>
      (!filters.brand || b.brand === filters.brand) &&
      (!bq || has(b.name, bq) || has(b.address, bq)),
    [filters.brand, bq]
  );

  const visiblePeople = React.useCallback(
    (b: Branch): Person[] =>
      b.people.filter(
        (p) =>
          (!filters.shift || p.shift === filters.shift) &&
          (!eq || has(p.name, eq) || has(p.role, eq) || has(p.position, eq))
      ),
    [filters.shift, eq]
  );

  // Карточки филиалов, по которым справочник заведён.
  const cards = React.useMemo(() => {
    if (filters.onlyNoData) return [];
    return branches
      .filter((b) => b.has_staff_data && matchesBranch(b))
      .filter(
        (b) =>
          !filters.onlyProblems || b.signals.some((s) => s.severity === "warn")
      )
      // Несколько выбранных сигналов складываются по ИЛИ: чипы читаются как
      // «покажи такие филиалы», а не как пересечение бед.
      .filter(
        (b) =>
          filters.signals.length === 0 ||
          filters.signals.some((k) => b.signals.some((s) => s.key === k))
      )
      .map((b) => ({ branch: b, people: visiblePeople(b) }))
      .filter((x) => !peopleFilters || x.people.length > 0);
  }, [
    branches,
    filters.onlyNoData,
    filters.onlyProblems,
    filters.signals,
    matchesBranch,
    visiblePeople,
    peopleFilters,
  ]);

  // Филиалы без единой строки в справочнике. Фильтры по людям и по сигналам к
  // ним неприменимы — не потому что «не подошли», а потому что применять не к
  // чему. Экран обязан сказать это словами, иначе группа просто исчезнет и
  // будет прочитана как «таких филиалов нет».
  const noDataApplicable =
    !peopleFilters && filters.signals.length === 0 && !filters.onlyProblems;
  const noData = React.useMemo(
    () => branches.filter((b) => !b.has_staff_data && matchesBranch(b)),
    [branches, matchesBranch]
  );

  const denied = q.isError && q.error?.status === 403;
  const shownBranches = cards.length + (noDataApplicable ? noData.length : 0);

  return (
    // overflow-x-clip — та же страховка, что на матрице паспорта и карте сети:
    // SidebarInset выше по дереву это flex-1 без min-w-0, и любой широкий
    // потомок иначе распёр бы страницу вбок.
    <div className="w-full min-w-0 max-w-full overflow-x-clip pb-8">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h1 className="inline-flex items-center gap-2 text-lg font-semibold tracking-tight">
            <UsersRound className="size-4 text-muted-foreground" aria-hidden />
            Состав филиалов
          </h1>
          <p className="text-[12px] text-muted-foreground">
            Кто где работает и как собрана команда — по каждому филиалу
            поимённо, из одного запроса.
          </p>
        </div>
        {canEdit && (
          <AttestationEmployeeFormSheet>
            <Button size="sm" className="shrink-0">
              <Plus className="size-4" aria-hidden />
              {t("employees.addEmployee")}
            </Button>
          </AttestationEmployeeFormSheet>
        )}
      </div>

      {denied ? (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-[12.5px] leading-snug text-destructive">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            Состав филиалов отдаётся по праву{" "}
            <code className="font-mono text-[11px]">employees.list</code>, а у
            вашей роли его нет. Это не сбой: страница загрузилась, отказал именно
            доступ. Обратитесь к администратору office-админки.
          </span>
        </div>
      ) : q.isError ? (
        <div className="flex items-start justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-[12.5px] leading-snug text-destructive">
          <span>Не удалось загрузить состав филиалов: {q.error?.message}</span>
          <button
            type="button"
            onClick={() => q.refetch()}
            className="shrink-0 rounded border border-destructive/50 px-2 py-0.5 text-[11px] transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            повторить
          </button>
        </div>
      ) : q.isLoading ? (
        <div className="flex h-[320px] items-center justify-center text-[12px] text-muted-foreground">
          <Loader2 className="mr-2 size-4 animate-spin" aria-hidden /> собираем
          состав филиалов
        </div>
      ) : !network || branches.length === 0 ? (
        <div className="rounded-lg border border-dashed px-4 py-10 text-center">
          <p className="text-[13px] font-medium">В вашем скоупе нет филиалов</p>
          <p className="mx-auto mt-1 max-w-md text-[11.5px] leading-snug text-muted-foreground">
            Экран показывает только те филиалы, которые назначены вашей роли.
            Роль без назначенных филиалов и без права головного офиса видит
            пустой список — это не ошибка загрузки. Назначает филиалы
            администратор office-админки.
          </p>
        </div>
      ) : (
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2.5">
          <SummaryStrip n={network} />
          <FilterBar
            n={network}
            value={filters}
            onChange={setFilters}
            shownBranches={shownBranches}
          />

          {!filters.onlyNoData &&
            (cards.length === 0 ? (
              <div className="rounded-lg border border-dashed px-4 py-8 text-center">
                <p className="text-[13px] font-medium">
                  Ни один филиал не подошёл под фильтры
                </p>
                <p className="mx-auto mt-1 max-w-lg text-[11.5px] leading-snug text-muted-foreground">
                  {peopleFilters
                    ? "Фильтры по сотруднику и смене оставляют филиал в выдаче только тогда, когда в нём есть хотя бы один подходящий человек."
                    : "Снимите часть условий — фильтры складываются, а не заменяют друг друга."}{" "}
                  {filtersActive(filters) && (
                    <button
                      type="button"
                      onClick={() => setFilters(EMPTY_FILTERS)}
                      className="underline decoration-dotted underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      Сбросить фильтры
                    </button>
                  )}
                </p>
              </div>
            ) : (
              <div className="grid min-w-0 items-start gap-2.5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {cards.map((c) => (
                  <BranchCard
                    key={c.branch.id}
                    branch={c.branch}
                    people={c.people}
                    peopleFiltered={
                      peopleFilters && c.people.length < c.branch.staff.total
                    }
                    query={filters.employeeQuery}
                    canEdit={canEdit}
                  />
                ))}
              </div>
            ))}

          {noData.length > 0 && (
            <section className="min-w-0 rounded-lg border border-dashed bg-muted/20 p-2.5">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <h2 className="text-[11px] font-semibold uppercase tracking-wide">
                  Данные не заведены · {noData.length}
                </h2>
                <p className="text-[11px] text-muted-foreground">
                  по этим филиалам в справочнике сотрудников нет ни одной строки
                  — это пробел в данных, а не пустой филиал
                </p>
              </div>
              <p className="mt-1 max-w-3xl text-[11px] leading-snug text-muted-foreground">
                Пока филиала нет в справочнике, на нём нельзя завести
                стажировку: паспорт стажёра заводится на сотрудника из
                employees. Люди там работают — просто система о них не знает.
              </p>
              {noDataApplicable ? (
                <div
                  className={cn(
                    "mt-2 grid min-w-0 items-start gap-1.5",
                    "sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4"
                  )}
                >
                  {noData.map((b) => (
                    <NoDataCard key={b.id} branch={b} canEdit={canEdit} />
                  ))}
                </div>
              ) : (
                <p className="mt-2 rounded border border-dashed px-2.5 py-2 text-[11px] leading-snug text-muted-foreground">
                  {noData.length} таких филиалов скрыто: включены фильтры по
                  людям или по сигналам, а у филиала без строк в справочнике
                  сотрудников нет — под такие условия он не попадает по
                  определению, а не потому что «не подошёл». Снимите фильтр по
                  сотруднику, смене и сигналам, чтобы увидеть их.
                </p>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
