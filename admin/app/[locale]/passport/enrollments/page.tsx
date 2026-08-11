"use client";

// Стажировки — where a training actually begins.
//
// The screen is one table with a compact metrics bar, because the two
// questions HR opens it with are "кто у меня сейчас стажируется" and "у кого
// горит испытательный". The default filter is `live` (active + paused), the
// same default GET /passport/matrix uses — the two screens are the same cohort
// seen two ways, and disagreeing about the default would read as one of them
// being broken.
//
// Chrome goes through next-intl like the rest of the admin; the operational
// prose (consequence dialogs, the bot-not-configured banner, the 409 panels)
// stays Russian in place, exactly as in the curriculum builder: it is written
// for HR and head office, and machine-translating "этот QR у стажёра на руках
// станет мёртвым" into a locale nobody operates in would be worse than showing
// the original.

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Info, Plus, X } from "lucide-react";

import { Button } from "@components/ui/buttonOrigin";
import { Label } from "@components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@components/ui/select";
import { cn } from "@admin/lib/utils";
import type {
  PassportEnrollmentRow,
  PassportStatusFilter,
} from "@admin/lib/passport-api";

import { buildColumns } from "./columns";
import { DataTable, type EnrollmentFilters } from "./data-table";
import { EnrollmentSheet, type CreatedInvite } from "./_components/enrollment-sheet";
import { InvitePrintView, type InviteToPrint } from "./_components/invite-print";
import { JournalSheet } from "./_components/journal-sheet";
import { BOT_ENV_VAR, botUsername } from "./_components/invite-link";
import { isLive } from "./_components/status";
import {
  deadlineInfo,
  fullName,
  useEnrollmentsAccess,
  usePrograms,
  useTerminalNames,
  useTerminals,
} from "./_components/use-enrollments";

const STATUS_OPTIONS: { value: PassportStatusFilter; key: string }[] = [
  { value: "live", key: "statusLive" },
  { value: "all", key: "statusAll" },
  { value: "active", key: "statusActive" },
  { value: "paused", key: "statusPaused" },
  { value: "completed", key: "statusCompleted" },
  { value: "failed", key: "statusFailed" },
];

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className={cn("text-[15px] font-semibold tabular-nums", tone)}>
        {value}
      </span>
      <span className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
    </div>
  );
}

export default function EnrollmentsPage() {
  const t = useTranslations("passport.enrollments");
  const access = useEnrollmentsAccess();
  const terminalName = useTerminalNames();
  const terminals = useTerminals();
  const programs = usePrograms();
  const programsDenied = programs.isError && programs.error?.status === 403;

  const [status, setStatus] = useState<PassportStatusFilter>("live");
  const [terminalId, setTerminalId] = useState("");
  const [programId, setProgramId] = useState("");
  // Set only by the 409 panel's «Показать её в списке» — a one-employee view
  // that has to be dismissible, hence the chip below.
  const [employeeId, setEmployeeId] = useState("");

  const [sheetOpen, setSheetOpen] = useState(false);
  const [invite, setInvite] = useState<InviteToPrint | null>(null);
  const [journal, setJournal] = useState<{
    id: string;
    name: string | null;
  } | null>(null);

  const [result, setResult] = useState<{
    rows: PassportEnrollmentRow[];
    total: number;
    loading: boolean;
  }>({ rows: [], total: 0, loading: true });

  const bot = botUsername();

  const filters: EnrollmentFilters = useMemo(
    () => ({
      status,
      terminal_id: terminalId,
      program_id: programId,
      employee_id: employeeId,
    }),
    [status, terminalId, programId, employeeId]
  );

  const columns = useMemo(
    () =>
      buildColumns({
        canManage: access.canManage,
        terminalName,
        onPrint: setInvite,
        onJournal: (row) =>
          setJournal({
            id: row.id,
            name: fullName(row.first_name, row.last_name),
          }),
      }),
    // terminalName closes over the terminals query; rebuilding on its data is
    // what makes branch names appear once that request lands.
    [access.canManage, terminals.data]
  );

  // Deadline counters describe the rows on screen, not the whole result set —
  // there is no aggregate endpoint and inventing one client-side would mean
  // pulling every page. The qualifier next to the strip says so rather than
  // letting the number imply more than it knows.
  const counts = useMemo(() => {
    const live = result.rows.filter((r) => isLive(r.status));
    let warning = 0;
    let overdue = 0;
    for (const r of live) {
      const d = deadlineInfo(r.probation_deadline);
      if (!d) continue;
      if (d.tone === "overdue") overdue++;
      else if (d.tone === "warning") warning++;
    }
    return { live: live.length, warning, overdue };
  }, [result.rows]);

  const onCreated = (created: CreatedInvite) =>
    setInvite({
      inviteId: created.invite_id,
      expiresAt: created.invite_expires_at,
      traineeName: created.traineeName || "Стажёр",
      position: created.position,
      programRu: created.programRu,
      programUz: created.programUz,
      branch: created.branch,
    });

  return (
    <div className="pb-10">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-[12px] text-muted-foreground">{t("subtitle")}</p>
        </div>
        {access.canManage && (
          <Button size="sm" onClick={() => setSheetOpen(true)}>
            <Plus className="mr-1.5 size-3.5" /> {t("newEnrollment")}
          </Button>
        )}
      </div>

      {/* The one thing that must be known BEFORE anyone starts an enrollment:
          without a configured bot the invite cannot be turned into a QR at all. */}
      {!bot && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] leading-snug text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
          <Info className="mt-0.5 size-4 shrink-0" />
          <span>
            <b>Печать QR-инвайтов выключена.</b> В этой сборке админки не задана
            переменная{" "}
            <code className="rounded bg-amber-100 px-1 py-px font-mono text-[11px] dark:bg-amber-900/50">
              {BOT_ENV_VAR}
            </code>{" "}
            — имя Telegram-бота паспорта (
            <code className="font-mono text-[11px]">pasport_stajer_bot</code>),
            без которого ссылку для QR собрать не из чего. Стажировки создавать
            можно, инвайты выпускаются, но
            распечатать их не получится, пока переменную не зададут в{" "}
            <code className="font-mono text-[11px]">admin/.env</code> и админку
            не пересоберут.
          </span>
        </div>
      )}

      {/* ------------------------------ filters ------------------------------ */}
      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border bg-card px-3 py-2.5">
        <div className="space-y-1">
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {t("filterStatus")}
          </Label>
          <Select
            value={status}
            onValueChange={(v) => setStatus(v as PassportStatusFilter)}
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

        <div className="space-y-1">
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {t("filterTerminal")}
          </Label>
          <Select
            value={terminalId || "__all__"}
            onValueChange={(v) => setTerminalId(v === "__all__" ? "" : v)}
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

        {/* Hidden rather than shown broken when GET /passport/programs 403s —
            that route is gated on passport.matrix.view, a different permission
            from the one that opens this page. */}
        {!programsDenied && (
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {t("filterProgram")}
            </Label>
            <Select
              value={programId || "__all__"}
              onValueChange={(v) => setProgramId(v === "__all__" ? "" : v)}
            >
              <SelectTrigger className="h-8 w-[210px] text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">{t("allPrograms")}</SelectItem>
                {(programs.data?.data ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.position} · {p.title_ru}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {employeeId && (
          <button
            type="button"
            onClick={() => setEmployeeId("")}
            className="mb-0.5 inline-flex items-center gap-1.5 rounded border border-border bg-muted/60 px-2 py-1 text-[11.5px] hover:bg-muted"
          >
            {t("oneEmployee")}
            <X className="size-3" />
          </button>
        )}

        <div className="ml-auto flex items-end gap-5 rounded-md bg-muted/50 px-3 py-1.5">
          <Metric label={t("metricTotal")} value={result.total} />
          <Metric label={t("metricLive")} value={counts.live} />
          <Metric
            label={t("metricWarning")}
            value={counts.warning}
            tone={
              counts.warning
                ? "text-amber-600 dark:text-amber-400"
                : undefined
            }
          />
          <Metric
            label={t("metricOverdue")}
            value={counts.overdue}
            tone={
              counts.overdue ? "text-red-600 dark:text-red-400" : undefined
            }
          />
        </div>
      </div>
      <p className="mb-3 px-1 text-[11px] text-muted-foreground">
        {t("metricScope")}
      </p>

      <DataTable columns={columns} filters={filters} onResult={setResult} />

      <EnrollmentSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onCreated={onCreated}
        onShowInList={(id) => {
          setEmployeeId(id);
          setStatus("all");
        }}
        onOpenJournal={(id) => setJournal({ id, name: null })}
      />

      <JournalSheet
        enrollmentId={journal?.id ?? null}
        traineeName={journal?.name ?? null}
        onOpenChange={(v) => !v && setJournal(null)}
      />

      {invite && (
        <InvitePrintView invite={invite} onClose={() => setInvite(null)} />
      )}
    </div>
  );
}
