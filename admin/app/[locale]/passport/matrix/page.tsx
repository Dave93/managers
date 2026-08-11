"use client";

// Матрица прогресса — the screen HR actually lives in.
//
// One question, asked across 53 branches of two brands: who is where, and what
// is late. Everything on it is read from GET /passport/matrix and NOTHING is
// re-derived: `level_min`, `complete`, `deadline_status` and
// `totals.overdue_modules` are computed server-side by the same code the
// trainee's phone runs, so the grid and the miniapp can never disagree.
//
// The one place where the screen deliberately shows two numbers that look
// contradictory: `totals.overdue_modules` EXCLUDES modules that are already
// complete, while a cell keeps the raw `deadline_status` — so a cell can read
// "overdue" (dashed red) while the metrics strip does not count it. That is
// correct: the counter counts what still needs chasing. It is explained under
// the strip and in the legend, and it is NOT "fixed" by recomputing anything.
//
// Chrome goes through next-intl like the rest of the admin; the operational
// prose stays Russian in place, exactly as on the enrollments screen and in
// the curriculum builder — it is written for HR and head office.

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight, Loader2, ShieldAlert } from "lucide-react";

import { Button } from "@components/ui/buttonOrigin";
import { Label } from "@components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@components/ui/select";
import { Skeleton } from "@components/ui/skeleton";
import { cn } from "@admin/lib/utils";
import type {
  PassportMatrixQuery,
  PassportStatusFilter,
} from "@admin/lib/passport-api";

import { MatrixLegend } from "./_components/level";
import { MatrixGrid, type CellTarget } from "./_components/matrix-grid";
import { MatrixJournalSheet } from "./_components/journal-sheet";
import {
  parseTimestamp,
  useMatrix,
  useMatrixAccess,
  usePrograms,
  useTerminalNames,
  useTerminals,
} from "./_components/use-matrix";

const STATUS_OPTIONS: { value: PassportStatusFilter; key: string }[] = [
  { value: "live", key: "statusLive" },
  { value: "all", key: "statusAll" },
  { value: "active", key: "statusActive" },
  { value: "paused", key: "statusPaused" },
  { value: "completed", key: "statusCompleted" },
  { value: "failed", key: "statusFailed" },
];

// The two organizations behind the 53 branches (organization.code).
const BRANDS = [
  { value: "chopar", label: "ChoparPizza" },
  { value: "les", label: "Les Ailes" },
];

const PAGE_SIZES = [50, 100, 200];
const DAYS_30 = 30 * 86400_000;

function Metric({
  label,
  value,
  tone,
  hint,
  action,
}: {
  label: string;
  value: number | string;
  tone?: string;
  hint?: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex min-w-0 flex-col" title={hint}>
      <span className={cn("text-[17px] font-semibold tabular-nums", tone)}>
        {value}
      </span>
      <span className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
        {action && (
          <button
            type="button"
            onClick={action.onClick}
            className="ml-1 underline decoration-dotted underline-offset-2 hover:text-foreground"
          >
            {action.label}
          </button>
        )}
      </span>
    </div>
  );
}

export default function MatrixPage() {
  const t = useTranslations("passport.matrix");
  const access = useMatrixAccess();
  const terminals = useTerminals();
  const terminalName = useTerminalNames();
  const programs = usePrograms();

  const [status, setStatus] = useState<PassportStatusFilter>("live");
  const [brand, setBrand] = useState("");
  const [terminalId, setTerminalId] = useState("");
  const [position, setPosition] = useState("");
  const [pageSize, setPageSize] = useState(100);
  const [page, setPage] = useState(0);

  const [target, setTarget] = useState<CellTarget | null>(null);

  // Every empty param is OMITTED, never sent blank: terminal_id is uuid-typed
  // server-side and a stringified "" would 422 the whole grid.
  const query = useMemo<PassportMatrixQuery>(
    () => ({
      limit: String(pageSize),
      offset: String(page * pageSize),
      status,
      ...(brand ? { brand } : {}),
      ...(terminalId ? { terminal_id: terminalId } : {}),
      ...(position ? { position } : {}),
    }),
    [pageSize, page, status, brand, terminalId, position]
  );

  const q = useMatrix(query);
  // The permission is also checked up front (see the early return below); this
  // catches the other 403 the route can return — a terminal-scoped user whose
  // scope is empty gets an empty result, not a refusal, so a 403 here means
  // the permission itself was lost between page load and request.
  const denied = q.isError && q.error?.status === 403;
  const rows = q.data?.rows ?? [];
  const modules = q.data?.modules ?? [];
  const total = q.data?.total ?? 0;

  const resetPage = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setPage(0);
  };

  /**
   * Position is matched EXACTLY against `employees.position` server-side, so
   * the option list is the union of the programme catalogue's positions (the
   * canonical vocabulary) and the positions actually present in the rows on
   * screen. Offering only one of the two would hide a real filter or produce
   * one that silently matches nothing.
   */
  const positionOptions = useMemo(() => {
    const set = new Set<string>();
    for (const p of programs.data?.data ?? []) if (p.position) set.add(p.position);
    for (const r of rows) if (r.employee.position) set.add(r.employee.position);
    return [...set].sort((a, b) => a.localeCompare(b, "ru"));
  }, [programs.data, rows]);

  /**
   * The strip. Counted over the rows ON THIS PAGE — there is no aggregate
   * endpoint and inventing one client-side would mean pulling every page. The
   * qualifier under the strip says so rather than letting the numbers imply
   * more than they know. Only «всего» is a server number.
   */
  const metrics = useMemo(() => {
    const now = Date.now();
    let live = 0;
    let overdueModules = 0;
    let awaiting = 0;
    let completed30 = 0;
    for (const r of rows) {
      if (r.status === "active" || r.status === "paused") live++;
      // Straight from the server total: excludes modules already complete.
      overdueModules += r.totals.overdue_modules;
      for (const c of r.cells) {
        // level_min === 2 «сделал» and the module is not closed: the trainee
        // has done their part and the next move belongs to a mentor.
        // level_min === null (no active topics) is not a 2 and never counts.
        if (!c.complete && c.level_min === 2) awaiting++;
      }
      if (r.completed_at) {
        const ms = parseTimestamp(r.completed_at);
        if (!Number.isNaN(ms) && now - ms <= DAYS_30) completed30++;
      }
    }
    return { live, overdueModules, awaiting, completed30 };
  }, [rows]);

  // «Завершено за 30 дней» can only be counted when closed enrollments are in
  // scope at all — the default filter is the live cohort. Rather than printing
  // a confident 0, the tile says the number is out of scope and offers the one
  // click that brings it in.
  const completedInScope = status === "all" || status === "completed";

  const filtersDirty = !!(brand || terminalId || position) || status !== "live";
  const pageCount = Math.max(Math.ceil(total / pageSize), 1);

  if (access.ready && !access.canViewMatrix) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-[12.5px] leading-snug">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
        <span>
          Матрица отдаётся по праву{" "}
          <code className="font-mono text-[11px]">passport.matrix.view</code>, а
          у вашей роли его нет. Обратитесь к администратору.
        </span>
      </div>
    );
  }

  return (
    // `overflow-x-clip` is belt and braces for the requirement that the PAGE
    // never scrolls sideways. Each grid section already carries its own
    // `overflow-x-auto`, and a scroll container contributes 0 to min-content, so
    // a wide table cannot widen the shell — but the shell above us
    // (components/ui/sidebar.tsx `SidebarInset`) is a `flex-1` flex item with no
    // `min-w-0`, i.e. exactly the shape that blows out if that reasoning ever
    // stops holding. `clip` (not `hidden`) leaves the vertical axis visible and
    // creates no scrollport, so the sticky first column still anchors to the
    // section scroller, and Sheet/Popover are portaled out of here anyway.
    <div className="w-full min-w-0 max-w-full overflow-x-clip pb-10">
      <div className="mb-4">
        <h1 className="text-lg font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-[12px] text-muted-foreground">{t("subtitle")}</p>
      </div>

      {/* ------------------------------ filters ------------------------------ */}
      <div className="mb-3 flex flex-wrap items-end gap-3 rounded-lg border bg-card px-3 py-2.5">
        <div className="space-y-1">
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {t("filterBrand")}
          </Label>
          <Select
            value={brand || "__all__"}
            onValueChange={resetPage((v: string) =>
              setBrand(v === "__all__" ? "" : v)
            )}
          >
            <SelectTrigger className="h-8 w-[160px] text-[13px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">{t("allBrands")}</SelectItem>
              {BRANDS.map((b) => (
                <SelectItem key={b.value} value={b.value}>
                  {b.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {t("filterTerminal")}
          </Label>
          <Select
            value={terminalId || "__all__"}
            onValueChange={resetPage((v: string) =>
              setTerminalId(v === "__all__" ? "" : v)
            )}
          >
            <SelectTrigger className="h-8 w-[210px] text-[13px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">{t("allTerminals")}</SelectItem>
              {(terminals.data ?? []).map((tr) => (
                <SelectItem key={tr.id} value={tr.id}>
                  {tr.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {t("filterPosition")}
          </Label>
          <Select
            value={position || "__all__"}
            onValueChange={resetPage((v: string) =>
              setPosition(v === "__all__" ? "" : v)
            )}
          >
            <SelectTrigger className="h-8 w-[180px] text-[13px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">{t("allPositions")}</SelectItem>
              {positionOptions.map((p) => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {t("filterStatus")}
          </Label>
          <Select
            value={status}
            onValueChange={resetPage((v: string) =>
              setStatus(v as PassportStatusFilter)
            )}
          >
            <SelectTrigger className="h-8 w-[170px] text-[13px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {t(o.key)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {filtersDirty && (
          <Button
            variant="ghost"
            size="sm"
            className="mb-0.5 h-8 text-[12px]"
            onClick={() => {
              setBrand("");
              setTerminalId("");
              setPosition("");
              setStatus("live");
              setPage(0);
            }}
          >
            {t("reset")}
          </Button>
        )}

        <div className="ml-auto flex items-end gap-5 rounded-md bg-muted/50 px-3 py-1.5">
          <Metric label={t("metricTotal")} value={total} />
          <Metric label={t("metricLive")} value={metrics.live} />
          <Metric
            label={t("metricOverdue")}
            value={metrics.overdueModules}
            tone={
              metrics.overdueModules
                ? "text-red-600 dark:text-red-400"
                : undefined
            }
            hint="Модули, у которых дедлайн прошёл и которые ещё не закрыты. Уже закрытые просроченные сюда не входят."
          />
          <Metric
            label={t("metricAwaiting")}
            value={metrics.awaiting}
            tone={
              metrics.awaiting ? "text-amber-600 dark:text-amber-400" : undefined
            }
            hint="Модули, где слабейшая тема на уровне «сделал»: стажёр свою часть выполнил, следующий шаг за наставником."
          />
          <Metric
            label={t("metricCompleted30")}
            value={completedInScope ? metrics.completed30 : "—"}
            hint={
              completedInScope
                ? undefined
                : "Завершённые стажировки не входят в текущий фильтр, поэтому считать нечего."
            }
            action={
              completedInScope
                ? undefined
                : {
                    label: "показать",
                    onClick: () => {
                      setStatus("completed");
                      setPage(0);
                    },
                  }
            }
          />
        </div>
      </div>

      <p className="mb-3 px-1 text-[11px] leading-snug text-muted-foreground">
        «Всего» — по текущему фильтру целиком; остальные счётчики — по строкам на
        этой странице. «Просрочено модулей» намеренно не считает уже закрытые
        модули: у такого модуля ячейка всё равно с красной (пунктирной) рамкой —
        дедлайн действительно прошёл, — но догонять там уже нечего. Обратный
        случай тоже бывает: модуль без активных тем закрытым не считается и в
        счётчик попадает, а ячейка у него пустая — учить там пока нечему, и
        вопрос это к куррикулуму, а не к стажёру.
      </p>

      <MatrixLegend className="mb-4" />

      {/* ------------------------------- grid -------------------------------- */}
      {denied ? (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-[12.5px] leading-snug">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
          <span>
            Матрица отдаётся по праву{" "}
            <code className="font-mono text-[11px]">passport.matrix.view</code>,
            а у вас его нет. Обратитесь к администратору.
          </span>
        </div>
      ) : q.isLoading ? (
        <div className="space-y-2 rounded-lg border bg-card p-3">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : q.isError ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-6 text-center text-[12.5px] text-destructive">
          {q.error?.message ?? "Не удалось загрузить матрицу"}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border bg-card px-4 py-14 text-center">
          <p className="text-[13.5px] font-medium">
            {filtersDirty ? "По этому фильтру никого нет" : "Стажировок пока нет"}
          </p>
          <p className="mx-auto mt-1.5 max-w-lg text-[12px] leading-snug text-muted-foreground">
            {filtersDirty ? (
              <>
                По умолчанию показаны только идущие стажировки. Переключите
                статус на «Все», чтобы увидеть завершённые, или сбросьте фильтры.
                Должность сверяется точь-в-точь с карточкой сотрудника — если
                там написано иначе, чем в программе, фильтр по должности ничего
                не найдёт.
              </>
            ) : (
              <>
                Как только HR начнёт первую стажировку на вкладке «Стажировки»,
                стажёр появится здесь строкой, а модули его программы —
                колонками.
              </>
            )}
          </p>
          {filtersDirty && (
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => {
                setBrand("");
                setTerminalId("");
                setPosition("");
                setStatus("live");
                setPage(0);
              }}
            >
              {t("reset")}
            </Button>
          )}
        </div>
      ) : (
        <MatrixGrid
          modules={modules}
          rows={rows}
          terminalName={terminalName}
          onOpenCell={setTarget}
        />
      )}

      {/* ------------------------------ paging ------------------------------- */}
      {rows.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 px-1">
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-muted-foreground">Строк:</span>
            <Select
              value={String(pageSize)}
              onValueChange={(v) => {
                setPageSize(Number(v));
                setPage(0);
              }}
            >
              <SelectTrigger className="h-8 w-[80px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent side="top">
                {PAGE_SIZES.map((s) => (
                  <SelectItem key={s} value={String(s)}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-[12px] tabular-nums text-muted-foreground">
              всего: {total}
            </span>
            {q.isFetching && (
              <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[12px] tabular-nums text-muted-foreground">
              стр. {page + 1} из {pageCount}
            </span>
            <Button
              variant="outline"
              className="size-8 p-0"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(p - 1, 0))}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Button
              variant="outline"
              className="size-8 p-0"
              disabled={page + 1 >= pageCount}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}

      <MatrixJournalSheet
        target={target}
        onOpenChange={(v) => !v && setTarget(null)}
      />
    </div>
  );
}
