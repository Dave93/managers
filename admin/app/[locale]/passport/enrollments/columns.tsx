"use client";

// Column defs for the enrollments table. Built by a factory rather than
// exported as a constant because every action column needs the page's
// handlers (print / journal) and the terminal-name map, and threading those
// through `table.options.meta` would hide them from type-checking.

import type { ColumnDef } from "@tanstack/react-table";

import type { PassportEnrollmentRow } from "@admin/lib/passport-api";
import { DeadlineCell, EnrollmentStatusChip, isLive } from "./_components/status";
import { RowActions } from "./_components/row-actions";
import type { InviteToPrint } from "./_components/invite-print";
import { deadlineInfo, fmtDate, fullName } from "./_components/use-enrollments";

/** next-intl translator, scoped to "passportUi.enrollments". */
type Translate = (key: string) => string;

export function buildColumns({
  canManage,
  terminalName,
  onPrint,
  onJournal,
  t,
}: {
  t: Translate;
  canManage: boolean;
  terminalName: (id: string | null) => string;
  onPrint: (invite: InviteToPrint) => void;
  onJournal: (row: PassportEnrollmentRow) => void;
}): ColumnDef<PassportEnrollmentRow, any>[] {
  return [
    {
      id: "employee",
      header: t("columns.trainee"),
      cell: ({ row }) => {
        const r = row.original;
        return (
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-[13px] font-medium leading-tight">
              {fullName(r.first_name, r.last_name, t("common.noName"))}
            </span>
            <span className="truncate text-[11.5px] text-muted-foreground">
              {r.position || t("common.noPosition")}
            </span>
          </div>
        );
      },
    },
    {
      id: "terminal",
      header: t("columns.branch"),
      cell: ({ row }) => (
        <span className="text-[12.5px]">
          {/* Server-resolved name first; terminalName() is the fallback for a
              terminal that no longer exists in the cached registry. */}
          {row.original.terminal_name ?? terminalName(row.original.terminal_id)}
        </span>
      ),
    },
    {
      id: "program",
      header: t("columns.program"),
      cell: ({ row }) => {
        const r = row.original;
        return (
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-[12.5px] leading-tight">
              {r.program_title_ru ?? "—"}
            </span>
            {r.program_title_uz && (
              <span className="truncate text-[11px] text-muted-foreground">
                {r.program_title_uz}
              </span>
            )}
          </div>
        );
      },
    },
    {
      id: "started",
      header: t("columns.start"),
      cell: ({ row }) => (
        <span className="text-[12.5px] tabular-nums text-muted-foreground">
          {fmtDate(row.original.started_at)}
        </span>
      ),
    },
    {
      id: "deadline",
      header: t("columns.probation"),
      cell: ({ row }) => {
        const r = row.original;
        return (
          <DeadlineCell
            info={deadlineInfo(r.probation_deadline)}
            date={fmtDate(r.probation_deadline)}
            live={isLive(r.status)}
          />
        );
      },
    },
    {
      id: "status",
      header: t("columns.status"),
      cell: ({ row }) => <EnrollmentStatusChip status={row.original.status} />,
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <div className="flex justify-end">
          <RowActions
            row={row.original}
            canManage={canManage}
            onPrint={onPrint}
            onJournal={onJournal}
          />
        </div>
      ),
    },
  ];
}
