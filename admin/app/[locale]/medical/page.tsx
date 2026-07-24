"use client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@admin/utils/eden";
import { Button } from "@admin/components/ui/buttonOrigin";
import { Input } from "@components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@components/ui/table";
import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import CanAccess from "@admin/components/can-access";
import { StatusBadge } from "./status-badge";
import { EmployeeSheet } from "./employee-sheet";
import { CompleteDialog } from "./complete-dialog";
import { ScheduleDialog } from "./schedule-dialog";
import { cn } from "@admin/lib/utils";

const PAGE_SIZE = 20;

// KPI tile: red tile maps to status=overdue which the backend expands to
// overdue+unfit, so the count shown must be the same union.
const TILES = [
  { key: "overdue", styles: "border-red-300 text-red-700", active: "bg-red-50" },
  { key: "due_soon", styles: "border-amber-300 text-amber-700", active: "bg-amber-50" },
  { key: "ok", styles: "border-green-300 text-green-700", active: "bg-green-50" },
  { key: "none", styles: "border-gray-300 text-gray-600", active: "bg-gray-50" },
] as const;

export default function MedicalPage() {
  const t = useTranslations("medical");
  const [status, setStatus] = useState("");
  const [terminalId, setTerminalId] = useState("");
  const [search, setSearch] = useState("");
  const [debSearch, setDebSearch] = useState("");
  const [page, setPage] = useState(0);
  const [sheetEmployeeId, setSheetEmployeeId] = useState<string | null>(null);
  const [completeExam, setCompleteExam] = useState<{
    examId: string;
    intervalMonths: number;
  } | null>(null);
  const [scheduleFor, setScheduleFor] = useState<{
    employeeId: string;
    startDate?: string | null;
    intervalMonths?: number | null;
  } | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setDebSearch(search), 300);
    return () => clearTimeout(id);
  }, [search]);
  useEffect(() => {
    setPage(0);
  }, [debSearch, terminalId, status]);

  const { data: summaryRes } = useQuery({
    queryKey: ["medical_summary", terminalId, debSearch],
    queryFn: () =>
      apiClient.api.medical.summary.get({
        query: {
          ...(terminalId ? { terminal_id: terminalId } : {}),
          ...(debSearch ? { search: debSearch } : {}),
        },
      }),
  });
  const summary = ((summaryRes as any)?.data ?? {}) as Record<string, number>;
  const tileCount = (key: string) =>
    key === "overdue"
      ? (summary.overdue ?? 0) + (summary.unfit ?? 0)
      : summary[key] ?? 0;

  const { data: terminalsData } = useQuery({
    queryKey: ["terminals_cached"],
    queryFn: () => apiClient.api.terminals.cached.get(),
  });
  const terminalList = [
    ...((terminalsData as any)?.data ?? terminalsData ?? []),
  ].sort((a: any, b: any) => String(a.name).localeCompare(String(b.name), "ru"));
  const terminalName = useMemo(() => {
    const m = new Map(terminalList.map((x: any) => [x.id, x.name]));
    return (id: string) => m.get(id) ?? "—";
  }, [terminalList]);

  const { data: listRes, isLoading } = useQuery({
    queryKey: ["medical_exams", status, terminalId, debSearch, page],
    queryFn: () =>
      apiClient.api.medical.exams.get({
        query: {
          limit: String(PAGE_SIZE),
          offset: String(page * PAGE_SIZE),
          ...(status ? { status } : {}),
          ...(terminalId ? { terminal_id: terminalId } : {}),
          ...(debSearch ? { search: debSearch } : {}),
        },
      }),
  });
  const rows = ((listRes as any)?.data?.data ?? []) as any[];
  const total = Number((listRes as any)?.data?.total ?? 0);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const relDue = (r: any) => {
    if (r.days_until_due == null) return "—";
    if (r.days_until_due < 0)
      return t("rel.overdueDays", { n: -r.days_until_due });
    if (r.days_until_due === 0) return t("rel.today");
    return t("rel.inDays", { n: r.days_until_due });
  };
  const fmt = (x: string | null) =>
    x ? new Date(x).toLocaleDateString("ru") : "—";

  return (
    <div className="space-y-6">
      <h2 className="text-3xl font-bold tracking-tight">{t("title")}</h2>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {TILES.map((tile) => (
          <button
            key={tile.key}
            onClick={() => setStatus(status === tile.key ? "" : tile.key)}
            className={cn(
              "border rounded-md p-4 text-left transition-colors",
              tile.styles,
              status === tile.key && tile.active,
              status === tile.key && "ring-2 ring-offset-1 ring-current"
            )}
          >
            <div className="text-sm">
              {t(`tiles.${tile.key === "due_soon" ? "dueSoon" : tile.key}` as any)}
            </div>
            <div className="text-2xl font-bold">{tileCount(tile.key)}</div>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder={t("filters.search")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-9 w-[200px]"
        />
        <Select
          value={terminalId || "__all__"}
          onValueChange={(v) => setTerminalId(v === "__all__" ? "" : v)}
        >
          <SelectTrigger className="h-9 w-[220px]">
            <SelectValue placeholder={t("filters.branch")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">{t("filters.all")}</SelectItem>
            {terminalList.map((term: any) => (
              <SelectItem key={term.id} value={term.id}>
                {term.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          className="h-9"
          onClick={() => {
            setStatus("");
            setTerminalId("");
            setSearch("");
          }}
        >
          {t("filters.reset")}
        </Button>
      </div>

      <div className="rounded-md border overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("table.employee")}</TableHead>
              <TableHead>{t("table.branch")}</TableHead>
              <TableHead>{t("table.position")}</TableHead>
              <TableHead>{t("table.lastExam")}</TableHead>
              <TableHead>{t("table.nextExam")}</TableHead>
              <TableHead>{t("table.status")}</TableHead>
              <TableHead>{t("table.due")}</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={8} className="h-24 text-center">
                  Loading...
                </TableCell>
              </TableRow>
            ) : rows.length ? (
              rows.map((r) => (
                <TableRow
                  key={r.employee_id}
                  className={cn(
                    "cursor-pointer",
                    (r.status === "overdue" || r.status === "unfit") &&
                      "border-l-2 border-l-red-500"
                  )}
                  onClick={() => setSheetEmployeeId(r.employee_id)}
                >
                  <TableCell className="font-medium">
                    {r.first_name} {r.last_name}
                  </TableCell>
                  <TableCell>{terminalName(r.terminal_id)}</TableCell>
                  <TableCell>{r.position ?? "—"}</TableCell>
                  <TableCell>{fmt(r.last_completed_date)}</TableCell>
                  <TableCell>{fmt(r.next_due_date)}</TableCell>
                  <TableCell>
                    <StatusBadge status={r.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground whitespace-nowrap">
                    {relDue(r)}
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <CanAccess permission="medical.edit">
                      <div className="flex gap-2">
                        {r.open_exam_id && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              setCompleteExam({
                                examId: r.open_exam_id,
                                intervalMonths: r.interval_months ?? 6,
                              })
                            }
                          >
                            {t("actions.complete")}
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setScheduleFor({
                              employeeId: r.employee_id,
                              startDate: r.start_date,
                              intervalMonths: r.interval_months,
                            })
                          }
                        >
                          {t("actions.schedule")}
                        </Button>
                      </div>
                    </CanAccess>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={8} className="h-24 text-center">
                  No results.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-end gap-2">
        <span className="text-sm">
          {page + 1} / {pageCount}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={page === 0}
          onClick={() => setPage((p) => p - 1)}
        >
          ←
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page + 1 >= pageCount}
          onClick={() => setPage((p) => p + 1)}
        >
          →
        </Button>
      </div>

      <EmployeeSheet
        employeeId={sheetEmployeeId}
        onClose={() => setSheetEmployeeId(null)}
        onComplete={(examId, intervalMonths) =>
          setCompleteExam({ examId, intervalMonths })
        }
        onSchedule={(employeeId, startDate, intervalMonths) =>
          setScheduleFor({ employeeId, startDate, intervalMonths })
        }
      />
      <CompleteDialog exam={completeExam} onClose={() => setCompleteExam(null)} />
      <ScheduleDialog target={scheduleFor} onClose={() => setScheduleFor(null)} />
    </div>
  );
}
