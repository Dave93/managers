"use client";
import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@admin/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@admin/components/ui/table";
import { kpiApi, type AttendanceImportRow } from "@admin/lib/kpi-api";
import { IMPORT_STATUS } from "@admin/lib/kpi/attendance";
import { kpiErrorText, loadErrors, shouldRetry } from "@admin/lib/kpi/errors";
import { formatTashkent } from "@admin/lib/kpi/format";
import { KpiBadge } from "../../_components/kpi-badge";
import { StaleNote } from "../../_components/stale-note";
import { qk } from "../../_components/use-kpi";
import { ImportResult } from "./import-result";

export function ImportsTable({ period }: { period: string }) {
  const t = useTranslations("kpiScreens.attendance.imports");
  const tc = useTranslations("kpiScreens.common");
  const tk = useTranslations("kpi");
  const list = useQuery<AttendanceImportRow[], Error>({
    queryKey: qk.attendanceImports(period),
    queryFn: () => kpiApi.attendance.imports(period),
    retry: shouldRetry,
  });
  // Храним id: после повторной загрузки список обновляется, и диалог берёт свежую строку.
  const [openId, setOpenId] = useState<string | null>(null);
  const rows = list.data ?? [];
  const opened = openId ? rows.find((r) => r.id === openId) ?? null : null;
  const { blocking, stale } = loadErrors(list);

  if (blocking)
    return (
      <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">
        {kpiErrorText(blocking, tk)}
      </p>
    );
  if (list.isPending) return <p className="text-sm text-muted-foreground">{tc("loading")}</p>;

  return (
    <div className="space-y-3">
      {stale != null && <StaleNote error={stale} />}
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("colUploaded")}</TableHead>
                <TableHead>{t("colFile")}</TableHead>
                <TableHead>{t("colSheet")}</TableHead>
                <TableHead>{t("colWho")}</TableHead>
                <TableHead className="text-right">{t("colRows")}</TableHead>
                <TableHead className="text-right">{t("colMatched")}</TableHead>
                <TableHead className="text-right">{t("colUnmatched")}</TableHead>
                <TableHead className="text-right">{t("colSkipped")}</TableHead>
                <TableHead>{t("colStatus")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow
                  key={r.id}
                  className="cursor-pointer"
                  tabIndex={0}
                  onClick={() => setOpenId(r.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setOpenId(r.id);
                    }
                  }}
                >
                  <TableCell className="whitespace-nowrap">{formatTashkent(r.created_at)}</TableCell>
                  <TableCell>{r.file_name}</TableCell>
                  <TableCell>{r.sheet}</TableCell>
                  <TableCell>{r.uploaded_by_name ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.rows_total}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.rows_matched}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.rows_unmatched}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.rows_skipped}</TableCell>
                  <TableCell>
                    <KpiBadge tone={IMPORT_STATUS[r.status].tone}>{tk(IMPORT_STATUS[r.status].labelKey)}</KpiBadge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={opened !== null} onOpenChange={(o) => !o && setOpenId(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{opened?.file_name ?? t("dialogFallbackTitle")}</DialogTitle>
            <DialogDescription>
              {opened ? t("dialogDescription", { date: formatTashkent(opened.created_at), sheet: opened.sheet }) : ""}
            </DialogDescription>
          </DialogHeader>
          {opened && <ImportResult row={opened} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
