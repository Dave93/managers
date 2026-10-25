"use client";
import React, { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@admin/components/ui/button";
import { Input } from "@admin/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@admin/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@admin/components/ui/table";
import {
  kpiApi,
  postAttendanceFile,
  type AttendanceImportRow,
  type AttendanceParseResponse,
  type UnmatchedRow,
} from "@admin/lib/kpi-api";
import {
  MAPPING_FIELDS,
  UNMATCHED_REASON_TEXT,
  columnLabel,
  defaultSheet,
  fileIssue,
  guessMapping,
  headersAt,
  mappingIssues,
  previewBody,
  toMapping,
  type MappingDraft,
} from "@admin/lib/kpi/attendance";
import { KpiApiError, kpiErrorText, shouldRetry } from "@admin/lib/kpi/errors";
import { ALL } from "@admin/lib/kpi/filters";
import { formatTashkent } from "@admin/lib/kpi/format";
import { monthLabel } from "@admin/lib/kpi/periods";
import { qk } from "../../_components/use-kpi";
import { ImportResult } from "./import-result";

const MAX_HEADER_ROW = 20;
const UNMATCHED_SHOWN = 20;

type Step = "idle" | "mapping" | "done";

export function ImportWizard({ period }: { period: string }) {
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>("idle");
  const [parsed, setParsed] = useState<AttendanceParseResponse | null>(null);
  const [sheetName, setSheetName] = useState("");
  const [headerRow, setHeaderRow] = useState(1);
  const [draft, setDraft] = useState<MappingDraft>({});
  const [reading, setReading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [result, setResult] = useState<AttendanceImportRow | null>(null);
  // Причины 422 nothing_matched относятся к месяцу, за который была попытка.
  const [failed, setFailed] = useState<{ period: string; rows: UnmatchedRow[] } | null>(null);
  // Смена key сбрасывает выбранный файл в поле.
  const [fileKey, setFileKey] = useState(0);
  const commitLatch = useRef(false);

  const imports = useQuery<AttendanceImportRow[], Error>({
    queryKey: qk.attendanceImports(period),
    queryFn: () => kpiApi.attendance.imports(period),
    retry: shouldRetry,
  });
  const existing = (imports.data ?? []).find((r) => r.status === "committed") ?? null;

  const sheet = useMemo(() => parsed?.sheets.find((s) => s.name === sheetName) ?? null, [parsed, sheetName]);
  const rows = useMemo(() => sheet?.rows ?? [], [sheet]);
  const maxHeaderRow = Math.max(1, Math.min(MAX_HEADER_ROW, rows.length));
  const headers = useMemo(() => headersAt(rows, headerRow), [rows, headerRow]);
  const width = Math.max(headers.length, ...rows.map((r) => r.length), 0);
  const body = useMemo(() => previewBody(rows, headerRow), [rows, headerRow]);
  const { errors, warnings } = mappingIssues(draft);

  const reset = () => {
    setStep("idle");
    setParsed(null);
    setSheetName("");
    setDraft({});
    setResult(null);
    setFailed(null);
    setFileKey((k) => k + 1);
  };

  const openSheet = (resp: AttendanceParseResponse, name: string, row?: number) => {
    const s = resp.sheets.find((x) => x.name === name);
    const sheetRows = s?.rows ?? [];
    const limit = Math.max(1, Math.min(MAX_HEADER_ROW, sheetRows.length));
    const hr = Math.min(Math.max(1, row ?? s?.header_row ?? 1), limit);
    setSheetName(name);
    setHeaderRow(hr);
    setDraft(guessMapping(headersAt(sheetRows, hr)));
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || reading) return;
    const issue = fileIssue(file);
    if (issue) {
      toast.error(issue);
      setFileKey((k) => k + 1);
      return;
    }
    setReading(true);
    try {
      const resp = await postAttendanceFile(file);
      if (resp.sheets.length === 0) {
        toast.error("В файле нет листов с данными");
        setFileKey((k) => k + 1);
        return;
      }
      setParsed(resp);
      setFailed(null);
      openSheet(resp, defaultSheet(resp.sheets));
      setStep("mapping");
    } catch (err) {
      toast.error(kpiErrorText(err));
      setFileKey((k) => k + 1);
    } finally {
      setReading(false);
    }
  };

  const setField = (key: keyof MappingDraft, value: string) => {
    setDraft((d) => {
      const next = { ...d };
      if (value === ALL) delete next[key];
      else next[key] = Number(value);
      return next;
    });
  };

  const commit = async () => {
    const mapping = toMapping(draft);
    if (!parsed || !mapping || errors.length > 0 || commitLatch.current) return;
    commitLatch.current = true;
    setCommitting(true);
    try {
      const row = await kpiApi.attendance.commit({
        token: parsed.token,
        sheet: sheetName,
        period,
        header_row: headerRow,
        mapping,
      });
      setResult(row);
      setStep("done");
      qc.invalidateQueries({ queryKey: qk.attendanceImportsAll });
      qc.invalidateQueries({ queryKey: qk.formAll });
      toast.success(`Загружено строк: ${row.rows_matched}`);
    } catch (err) {
      toast.error(kpiErrorText(err));
      if (err instanceof KpiApiError && err.code === "upload_expired") {
        reset();
      } else if (err instanceof KpiApiError && err.code === "nothing_matched") {
        const list = Array.isArray(err.body.unmatched) ? (err.body.unmatched as UnmatchedRow[]) : [];
        setFailed({ period, rows: list.slice(0, UNMATCHED_SHOWN) });
      }
    } finally {
      commitLatch.current = false;
      setCommitting(false);
    }
  };

  if (step === "done" && result) {
    return (
      <section className="space-y-3 rounded-md border p-4">
        <h2 className="text-base font-medium">Загружено за {monthLabel(result.period)}</h2>
        <ImportResult row={result} />
        <Button type="button" variant="outline" className="h-11" onClick={reset}>
          Загрузить другой файл
        </Button>
      </section>
    );
  }

  if (step === "idle" || !parsed || !sheet) {
    return (
      <section className="space-y-2 rounded-md border p-4">
        <h2 className="text-base font-medium">Новая загрузка</h2>
        <Input
          key={fileKey}
          type="file"
          accept=".xlsx,.xls,.csv"
          aria-label="Файл Workly"
          className="h-11 pt-2"
          disabled={reading}
          onChange={onFile}
        />
        {reading && <p className="text-sm text-muted-foreground">Читаю файл…</p>}
      </section>
    );
  }

  const failedRows = failed && failed.period === period ? failed.rows : [];

  return (
    <section className="space-y-4 rounded-md border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-medium">Файл «{parsed.file_name}»</h2>
        <Button type="button" variant="outline" className="h-11" disabled={committing} onClick={reset}>
          Отмена
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span>Лист</span>
          <Select value={sheetName} disabled={committing} onValueChange={(name) => openSheet(parsed, name)}>
            <SelectTrigger className="h-11 w-full" aria-label="Лист">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {parsed.sheets.map((s) => (
                <SelectItem key={s.name} value={s.name}>
                  {s.name} · {s.total_rows} строк
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="space-y-1 text-sm">
          <span>Строка заголовков</span>
          <Select
            value={String(headerRow)}
            disabled={committing}
            onValueChange={(v) => openSheet(parsed, sheetName, Number(v))}
          >
            <SelectTrigger className="h-11 w-full" aria-label="Строка заголовков">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: maxHeaderRow }, (_, i) => i + 1).map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {MAPPING_FIELDS.map((f) => (
          <label key={f.key} className="space-y-1 text-sm">
            <span>
              {f.label}
              {f.required && <span className="ml-1 text-xs text-muted-foreground">обязательно</span>}
            </span>
            <Select
              value={draft[f.key] === undefined ? ALL : String(draft[f.key])}
              disabled={committing}
              onValueChange={(v) => setField(f.key, v)}
            >
              <SelectTrigger className="h-11 w-full" aria-label={f.label}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>— не выбрана —</SelectItem>
                {Array.from({ length: width }, (_, i) => (
                  <SelectItem key={i} value={String(i)}>
                    {columnLabel(i, headers[i] ?? "")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        ))}
      </div>

      <div className="space-y-1">
        <p className="text-sm font-medium">Предпросмотр</p>
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                {Array.from({ length: width }, (_, i) => {
                  const fields = MAPPING_FIELDS.filter((f) => draft[f.key] === i);
                  return (
                    <TableHead key={i} className="align-top">
                      <div>{headers[i]?.trim() || "—"}</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {fields.map((f) => (
                          <span key={f.key} className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal text-foreground">
                            {f.label}
                          </span>
                        ))}
                      </div>
                    </TableHead>
                  );
                })}
              </TableRow>
            </TableHeader>
            <TableBody>
              {body.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={Math.max(width, 1)} className="text-sm text-muted-foreground">
                    После строки заголовков данных нет
                  </TableCell>
                </TableRow>
              ) : (
                body.map((r, ri) => (
                  <TableRow key={ri}>
                    {Array.from({ length: width }, (_, ci) => (
                      <TableCell key={ci} className="whitespace-nowrap">
                        {r[ci] ?? ""}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        <p className="text-xs text-muted-foreground">Показаны первые строки листа</p>
      </div>

      {(errors.length > 0 || warnings.length > 0) && (
        <ul className="space-y-1 text-sm">
          {errors.map((m) => (
            <li key={m} className="text-destructive">
              {m}
            </li>
          ))}
          {warnings.map((m) => (
            <li key={m} className="text-amber-700">
              {m}
            </li>
          ))}
        </ul>
      )}

      {existing && (
        <p className="text-sm text-amber-700">
          За {monthLabel(period)} уже загружен «{existing.file_name}» {formatTashkent(existing.created_at)}. Новая
          загрузка заменит его
        </p>
      )}

      <Button type="button" className="h-11" disabled={errors.length > 0 || committing} onClick={commit}>
        {committing ? "Загружаю…" : `Загрузить за ${monthLabel(period)}`}
      </Button>

      {failedRows.length > 0 && (
        <div className="space-y-1" role="alert">
          <p className="text-sm text-destructive">Ни одна строка не сопоставилась. Первые причины:</p>
          <ul className="space-y-0.5 text-sm">
            {failedRows.map((u, i) => (
              <li key={`${u.row}-${i}`}>
                Строка {u.row}
                {u.external_id ? ` (${u.external_id})` : ""}: {UNMATCHED_REASON_TEXT[u.reason] ?? u.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
