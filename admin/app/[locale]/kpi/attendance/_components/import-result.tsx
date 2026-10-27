"use client";
import React from "react";
import { Link } from "@admin/i18n/routing";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@admin/components/ui/table";
import type { AttendanceImportRow, UnmatchedRow } from "@admin/lib/kpi-api";
import { UNMATCHED_REASON_TEXT, importTotalsText, rowsCountText, skippedReasonsText } from "@admin/lib/kpi/attendance";

// Значение вкладки «Сотрудники» в settings/page.tsx.
const EMPLOYEES_TAB = "employees";

function RowsTable({ rows, total }: { rows: UnmatchedRow[]; total: number }) {
  return (
    <>
      <div className="max-h-80 overflow-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Строка</TableHead>
              <TableHead>Табельный номер</TableHead>
              <TableHead>Причина</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((u, i) => (
              <TableRow key={`${u.row}-${i}`}>
                <TableCell className="tabular-nums">{u.row}</TableCell>
                <TableCell>{u.external_id ?? "—"}</TableCell>
                <TableCell>{UNMATCHED_REASON_TEXT[u.reason] ?? u.reason}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {rows.length < total && (
        <p className="text-xs text-muted-foreground">
          Показаны первые {rows.length} из {total}
        </p>
      )}
    </>
  );
}

export function ImportResult({ row }: { row: AttendanceImportRow }) {
  const showUnknown = row.unmatched.some((u) => u.reason === "unknown_external_id");
  return (
    <div className="space-y-3">
      <p className="text-sm">{rowsCountText(row)}</p>
      <p className="text-sm">{importTotalsText(row)}</p>
      {row.rows_unmatched > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Не сопоставлено: сотрудник не найден</h3>
          <RowsTable rows={row.unmatched} total={row.rows_unmatched} />
        </div>
      )}
      {row.rows_skipped > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Пропущено: сотрудник найден, строка не учтена</h3>
          {row.skipped.length > 0 && <p className="text-sm text-muted-foreground">{skippedReasonsText(row.skipped)}</p>}
          <RowsTable rows={row.skipped} total={row.rows_skipped} />
        </div>
      )}
      {showUnknown && (
        <Link
          href={`/kpi/settings?tab=${EMPLOYEES_TAB}`}
          className="inline-flex h-11 items-center text-sm text-primary underline underline-offset-4"
        >
          Проставить табельные номера
        </Link>
      )}
    </div>
  );
}
