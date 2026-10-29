"use client";

// The grid: rows are trainees, columns are the modules of THEIR programme.
//
// !! COLUMN KEYING !! `modules` is a flat list of (program_id, module_id)
// PAIRS, not a list of modules: `sort`, `required` and `deadline_days` live on
// passport_program_modules, so one module attached to two programmes is
// legitimately two columns with different settings. Every column is therefore
// keyed on `${program_id}:${module_id}` (see `columnKey` below) and a row's
// columns are selected with `column.program_id === row.program_id`. Keying on
// module_id alone collides the instant the result spans two programmes — and
// the default filter (`live`, all branches) spans them routinely.
//
// That same fact drives the layout. A single wide grid holding every column of
// every programme would be mostly holes: a cook's row has nothing to say about
// a cashier's modules. So the grid is SECTIONED BY PROGRAMME — one table per
// programme, carrying only that programme's columns. With one programme
// selected (the usual case) this degenerates to exactly the single grid the
// design asks for; with several it stays readable instead of turning into a
// sparse matrix nobody can scan.
//
// Cells are read, never re-derived: `level_min`, `complete` and
// `deadline_status` are computed server-side by the same deadlineStatus() the
// trainee's own phone feed uses, so a module the trainee sees as overdue is
// red here too. `cells` carries only `module_id` (its programme is the row's),
// so the per-row lookup is a plain Map on module_id — unique within one
// programme by construction.
//
// Horizontal scroll is contained per section: the scroller is
// `w-full overflow-x-auto` and the table inside is `w-max`. Block containers do
// not stretch to their content, so the page body itself never gains a
// sideways scrollbar no matter how many modules a programme has.

import { useMemo } from "react";
import { AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@admin/lib/utils";
import type {
  PassportMatrixCell,
  PassportMatrixModule,
  PassportMatrixRow,
} from "@admin/lib/passport-api";

import { LevelChip, levelTitle, type MatrixT } from "./level";
import { EnrollmentStatusChip } from "./status";
import { brandLabel, deadlineInfo, fmtDate, fullName } from "./use-matrix";

/** The identity of a column. NEVER `module_id` alone — see the header comment. */
export function columnKey(m: { program_id: string; module_id: string }): string {
  return `${m.program_id}:${m.module_id}`;
}

export interface CellTarget {
  row: PassportMatrixRow;
  column: PassportMatrixModule;
  cell: PassportMatrixCell | null;
}

interface ProgramGroup {
  program_id: string;
  title: string;
  columns: PassportMatrixModule[];
  rows: PassportMatrixRow[];
}

function edgeClass(cell: PassportMatrixCell | null): string {
  // A module with NO ACTIVE TOPICS (`level_min === null`) gets the neutral
  // dashed edge and nothing else. The server still reports its
  // `deadline_status` — and still counts it in `totals.overdue_modules`, since
  // `complete` is false for a topic-less module — but painting an empty square
  // red would blame the trainee for an empty curriculum. This branch has to
  // live HERE rather than as a second class on the call site: cn() is
  // tailwind-merge, so a later `border-dashed` would win the border while the
  // red BACKGROUND from this function survived, producing a pink cell with a
  // grey edge that matches no entry in the legend.
  if (!cell || cell.level_min === null) return "border-dashed border-border/60";
  if (cell.deadline_status === "overdue")
    return cell.complete
      ? // Dashed, not solid: the date really did pass, but the module is
        // closed and `totals.overdue_modules` deliberately does not count it.
        "border-dashed border-red-300 dark:border-red-900/80"
      : "border-red-400 bg-red-50/70 dark:border-red-700/80 dark:bg-red-950/30";
  if (cell.deadline_status === "warning")
    return "border-amber-300 bg-amber-50/60 dark:border-amber-800/80 dark:bg-amber-950/20";
  return "border-transparent";
}

function cellTitle(
  t: MatrixT,
  column: PassportMatrixModule,
  cell: PassportMatrixCell | null
): string {
  if (!cell) return `${column.title_ru}\n${t("grid.cellNoProgress")}`;
  const lines = [
    column.title_ru,
    t("grid.cellLevel", { level: levelTitle(t, cell.level_min) }),
    t("grid.cellTopicsDone", {
      done: cell.topics_done,
      total: cell.topics_total,
    }),
    cell.required ? t("grid.cellRequired") : t("grid.cellOptional"),
  ];
  if (cell.deadline_at) {
    const label =
      cell.deadline_status === "overdue"
        ? cell.complete
          ? t("grid.cellDeadlinePassedClosed")
          : t("grid.cellOverdue")
        : cell.deadline_status === "warning"
          ? t("lessThan3Days")
          : t("grid.cellOnTime");
    lines.push(
      t("grid.cellDeadline", { date: fmtDate(cell.deadline_at), label })
    );
  } else {
    lines.push(t("grid.cellDeadlineNone"));
  }
  lines.push(t("grid.cellClickJournal"));
  return lines.join("\n");
}

function ProgramSection({
  group,
  terminalName,
  onOpenCell,
}: {
  group: ProgramGroup;
  terminalName: (id: string | null) => string;
  onOpenCell: (t: CellTarget) => void;
}) {
  const t = useTranslations("passportUi.matrix");
  const overdueCounterTitle = [
    t("grid.overdueTitle1"),
    t("grid.overdueTitle2"),
    t("grid.overdueTitle3"),
  ].join("\n");
  return (
    <section className="w-full min-w-0">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-1">
        <h2 className="text-[13px] font-semibold tracking-tight">
          {group.title}
        </h2>
        <span className="text-[11.5px] text-muted-foreground">
          {t("grid.trainees", { count: group.rows.length })} ·{" "}
          {t("grid.modules", { count: group.columns.length })}
        </span>
      </div>

      {/* Columns are PUBLISHED and ACTIVE modules only — exactly the filter the
          trainee's own feed uses. A programme whose modules are all still in
          draft therefore has no columns at all, and saying so beats showing a
          two-column table that looks like a bug. */}
      {group.columns.length === 0 && (
        <p className="mb-2 px-1 text-[11.5px] leading-snug text-amber-700 dark:text-amber-400">
          {t("grid.noPublished")}
        </p>
      )}

      {/* The only element allowed to scroll sideways. */}
      <div className="w-full overflow-x-auto rounded-lg border bg-card">
        <table className="w-max border-separate border-spacing-0 text-left">
          <thead>
            <tr>
              <th
                scope="col"
                className="sticky left-0 z-20 w-[268px] min-w-[268px] border-b bg-card px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground shadow-[1px_0_0_0_hsl(var(--border))]"
              >
                {t("grid.colTrainee")}
              </th>
              <th
                scope="col"
                className="w-[96px] min-w-[96px] border-b bg-card px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
              >
                {t("grid.colModules")}
              </th>
              {group.columns.map((c, i) => (
                <th
                  key={columnKey(c)}
                  scope="col"
                  title={`${i + 1}. ${c.title_ru}${
                    c.deadline_days
                      ? `\n${t("grid.colDeadline", { days: c.deadline_days })}`
                      : `\n${t("grid.colDeadlineNone")}`
                  }${c.required ? "" : `\n${t("grid.colOptionalModule")}`}`}
                  className="w-[112px] min-w-[112px] max-w-[112px] border-b bg-card px-1.5 py-2 align-bottom"
                >
                  <span className="block text-[9.5px] font-medium tabular-nums text-muted-foreground/70">
                    {i + 1}
                    {!c.required && (
                      <span className="ml-1 font-normal">
                        {t("grid.optionalShort")}
                      </span>
                    )}
                    {c.deadline_days ? (
                      <span className="ml-1 font-normal">
                        · {t("grid.daysShort", { count: c.deadline_days })}
                      </span>
                    ) : null}
                  </span>
                  <span className="line-clamp-2 text-[11px] font-medium leading-tight">
                    {c.title_ru}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {group.rows.map((row) => {
              const byModule = new Map(row.cells.map((c) => [c.module_id, c]));
              const probation = deadlineInfo(row.probation_deadline);
              const live = row.status === "active" || row.status === "paused";
              return (
                <tr key={row.enrollment_id} className="group">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 w-[268px] min-w-[268px] border-b bg-card px-3 py-2 text-left font-normal shadow-[1px_0_0_0_hsl(var(--border))] group-hover:bg-muted/40"
                  >
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-[13px] font-medium">
                          {fullName(
                            row.employee.first_name,
                            row.employee.last_name,
                            t("unnamed")
                          )}
                        </span>
                        {row.status !== "active" && (
                          <EnrollmentStatusChip status={row.status} />
                        )}
                      </span>
                      <span className="truncate text-[11px] text-muted-foreground">
                        {row.employee.position || t("positionNotSet")} ·{" "}
                        {row.terminal_name ?? terminalName(row.terminal_id)}
                        {brandLabel(row.brand)
                          ? ` · ${brandLabel(row.brand)}`
                          : ""}
                      </span>
                      {probation && live && probation.tone !== "ok" && (
                        <span
                          className={cn(
                            "inline-flex w-fit items-center gap-1 rounded border px-1 py-px text-[10px] leading-none",
                            probation.tone === "overdue"
                              ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
                              : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300"
                          )}
                          title={t("grid.probationUntil", {
                            date: fmtDate(row.probation_deadline),
                          })}
                        >
                          <AlertTriangle className="size-2.5" aria-hidden />
                          {probation.tone === "overdue"
                            ? t("grid.probationOverdue", {
                                days: Math.abs(probation.days),
                              })
                            : t("grid.probationLeft", {
                                days: Math.max(probation.days, 0),
                              })}
                        </span>
                      )}
                    </span>
                  </th>

                  <td className="border-b px-2 py-2 text-center align-middle group-hover:bg-muted/40">
                    <span className="text-[12px] font-medium tabular-nums">
                      {row.totals.modules_done}/{row.totals.modules_total}
                    </span>
                    {/* The counter's tooltip carries BOTH directions of the
                        `overdue_modules` discrepancy, stated where the
                        confusion actually happens — at the number that
                        disagrees with the cells next to it, not in a footnote
                        at the top of the page. Nothing is recomputed: this is
                        the server's own count, explained. */}
                    {row.totals.overdue_modules > 0 && (
                      <span
                        className="block text-[10px] font-medium leading-tight text-red-600 dark:text-red-400"
                        title={overdueCounterTitle}
                      >
                        {t("grid.overdueShort", { count: row.totals.overdue_modules })}
                      </span>
                    )}
                  </td>

                  {group.columns.map((c) => {
                    const cell = byModule.get(c.module_id) ?? null;
                    // level_min === null means the module has no ACTIVE topics
                    // — a fact about the curriculum, not about the trainee. It
                    // gets an empty cell, never a grey "0" chip.
                    const empty = !cell || cell.level_min === null;
                    return (
                      <td
                        key={columnKey(c)}
                        className="border-b px-1 py-1 align-middle group-hover:bg-muted/40"
                      >
                        <button
                          type="button"
                          onClick={() =>
                            onOpenCell({ row, column: c, cell })
                          }
                          title={cellTitle(t, c, cell)}
                          aria-label={`${fullName(
                            row.employee.first_name,
                            row.employee.last_name,
                            t("unnamed")
                          )} — ${c.title_ru}: ${
                            cell
                              ? t("grid.ariaState", {
                                  level: levelTitle(t, cell.level_min),
                                  done: cell.topics_done,
                                  total: cell.topics_total,
                                })
                              : t("grid.ariaNoData")
                          }`}
                          className={cn(
                            "flex h-[46px] w-full flex-col items-center justify-center gap-0.5 rounded-md border-2 transition-colors",
                            "hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            edgeClass(cell)
                          )}
                        >
                          {empty ? (
                            <span className="text-[12px] leading-none text-muted-foreground/50">
                              —
                            </span>
                          ) : (
                            <>
                              <LevelChip
                                level={cell!.level_min}
                                complete={cell!.complete}
                              />
                              <span className="text-[10px] leading-none tabular-nums text-muted-foreground">
                                {cell!.topics_done}/{cell!.topics_total}
                              </span>
                            </>
                          )}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function MatrixGrid({
  modules,
  rows,
  terminalName,
  onOpenCell,
}: {
  modules: PassportMatrixModule[];
  rows: PassportMatrixRow[];
  terminalName: (id: string | null) => string;
  onOpenCell: (t: CellTarget) => void;
}) {
  const t = useTranslations("passportUi.matrix");
  const groups = useMemo<ProgramGroup[]>(() => {
    const byProgram = new Map<string, ProgramGroup>();
    for (const row of rows) {
      let g = byProgram.get(row.program_id);
      if (!g) {
        g = {
          program_id: row.program_id,
          title: row.program_title_ru ?? t("grid.untitledProgram"),
          // The one selection rule the API's own comment mandates.
          columns: modules.filter((m) => m.program_id === row.program_id),
          rows: [],
        };
        byProgram.set(row.program_id, g);
      }
      g.rows.push(row);
    }
    return [...byProgram.values()];
  }, [modules, rows, t]);

  return (
    <div className="w-full min-w-0 space-y-6">
      {groups.map((g) => (
        <ProgramSection
          key={g.program_id}
          group={g}
          terminalName={terminalName}
          onOpenCell={onOpenCell}
        />
      ))}
    </div>
  );
}
