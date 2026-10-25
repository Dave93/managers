"use client";
import React from "react";
import { Link } from "@admin/i18n/routing";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@admin/components/ui/table";
import type { AttendanceImportRow } from "@admin/lib/kpi-api";
import { UNMATCHED_REASON_TEXT, importTotalsText } from "@admin/lib/kpi/attendance";

// Значение вкладки «Сотрудники» в settings/page.tsx.
const EMPLOYEES_TAB = "employees";

export function ImportResult({ row }: { row: AttendanceImportRow }) {
  const showUnknown = row.unmatched.some((u) => u.reason === "unknown_external_id");
  return (
    <div className="space-y-3">
      <p className="text-sm">
        Строк: {row.rows_total} · сопоставлено: {row.rows_matched} · не сопоставлено: {row.rows_unmatched}
      </p>
      <p className="text-sm">{importTotalsText(row)}</p>
      {row.rows_unmatched > 0 && (
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
                {row.unmatched.map((u, i) => (
                  <TableRow key={`${u.row}-${i}`}>
                    <TableCell className="tabular-nums">{u.row}</TableCell>
                    <TableCell>{u.external_id ?? "—"}</TableCell>
                    <TableCell>{UNMATCHED_REASON_TEXT[u.reason] ?? u.reason}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {row.unmatched.length < row.rows_unmatched && (
            <p className="text-xs text-muted-foreground">
              Показаны первые {row.unmatched.length} из {row.rows_unmatched}
            </p>
          )}
        </>
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
