"use client";
import React from "react";
import { useTranslations } from "next-intl";
import { Link } from "@admin/i18n/routing";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@admin/components/ui/table";
import type { AttendanceImportRow, UnmatchedRow } from "@admin/lib/kpi-api";
import { UNMATCHED_REASON_KEY, importTotalsText, rowsCountText, skippedReasonsText } from "@admin/lib/kpi/attendance";

// Значение вкладки «Сотрудники» в settings/page.tsx.
const EMPLOYEES_TAB = "employees";

function RowsTable({ rows, total }: { rows: UnmatchedRow[]; total: number }) {
  const t = useTranslations("kpiScreens.attendance.result");
  const tk = useTranslations("kpi");
  return (
    <>
      <div className="max-h-80 overflow-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("row")}</TableHead>
              <TableHead>{t("tabNumber")}</TableHead>
              <TableHead>{t("reason")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((u, i) => (
              <TableRow key={`${u.row}-${i}`}>
                <TableCell className="tabular-nums">{u.row}</TableCell>
                <TableCell>{u.external_id ?? "—"}</TableCell>
                <TableCell>{Object.hasOwn(UNMATCHED_REASON_KEY, u.reason) ? tk(UNMATCHED_REASON_KEY[u.reason]) : u.reason}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {rows.length < total && (
        <p className="text-xs text-muted-foreground">
          {t("shownFirst", { shown: rows.length, total })}
        </p>
      )}
    </>
  );
}

export function ImportResult({ row }: { row: AttendanceImportRow }) {
  const t = useTranslations("kpiScreens.attendance.result");
  const tk = useTranslations("kpi");
  const showUnknown = row.unmatched.some((u) => u.reason === "unknown_external_id");
  return (
    <div className="space-y-3">
      <p className="text-sm">{rowsCountText(row, tk)}</p>
      <p className="text-sm">{importTotalsText(row, tk)}</p>
      {row.rows_unmatched > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">{t("unmatchedTitle")}</h3>
          <RowsTable rows={row.unmatched} total={row.rows_unmatched} />
        </div>
      )}
      {row.rows_skipped > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">{t("skippedTitle")}</h3>
          {row.skipped.length > 0 && (
            <p className="text-sm text-muted-foreground">
              {row.skipped.length < row.rows_skipped ? t("skippedReasonsPrefix", { count: row.skipped.length }) : ""}
              {skippedReasonsText(row.skipped, tk)}
            </p>
          )}
          <RowsTable rows={row.skipped} total={row.rows_skipped} />
        </div>
      )}
      {showUnknown && (
        <Link
          href={`/kpi/settings?tab=${EMPLOYEES_TAB}`}
          className="inline-flex h-11 items-center text-sm text-primary underline underline-offset-4"
        >
          {t("setTabNumbers")}
        </Link>
      )}
    </div>
  );
}
