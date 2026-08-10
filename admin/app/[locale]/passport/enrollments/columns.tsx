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

export function buildColumns({
  canManage,
  terminalName,
  onPrint,
  onJournal,
}: {
  canManage: boolean;
  terminalName: (id: string | null) => string;
  onPrint: (invite: InviteToPrint) => void;
  onJournal: (row: PassportEnrollmentRow) => void;
}): ColumnDef<PassportEnrollmentRow, any>[] {
  return [
    {
      id: "employee",
      header: "Стажёр",
      cell: ({ row }) => {
        const r = row.original;
        return (
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-[13px] font-medium leading-tight">
              {fullName(r.first_name, r.last_name)}
            </span>
            <span className="truncate text-[11.5px] text-muted-foreground">
              {r.position || "должность не указана"}
            </span>
          </div>
        );
      },
    },
    {
      id: "terminal",
      header: "Филиал",
      cell: ({ row }) => (
        <span className="text-[12.5px]">
          {terminalName(row.original.terminal_id)}
        </span>
      ),
    },
    {
      id: "program",
      header: "Программа",
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
      header: "Старт",
      cell: ({ row }) => (
        <span className="text-[12.5px] tabular-nums text-muted-foreground">
          {fmtDate(row.original.started_at)}
        </span>
      ),
    },
    {
      id: "deadline",
      header: "Испытательный",
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
      header: "Статус",
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
