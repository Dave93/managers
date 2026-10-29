"use client";

// The journal, opened FROM A CELL — so it arrives with a question already
// asked: "what happened to this trainee in this module?"
//
// It therefore differs from the enrollments screen's journal drawer in exactly
// one way: it knows the module that was clicked and focuses on it by default.
// The journal endpoint has no module filter (it is deliberately the whole
// append-only history of the enrollment, GET /passport/enrollments/:id/journal),
// so the focus is applied client-side over the rows that have been LOADED —
// and the counter under the toggle says so out loud rather than implying the
// filter saw the entire history.
//
// Shape notes, restated because they bit during implementation:
//  * the response is NOT the {total,data} envelope — it nests `enrollment`;
//  * `topic` and `module` are OBJECTS (or null), not flat *_id/*_title fields,
//    and a topic-level row carries its parent module too — which is what makes
//    the module focus possible at all;
//  * a ref can exist with null titles (the uuids carry no FK, so a row about a
//    hard-deleted topic still shows up as evidence rather than vanishing);
//  * `actor.kind === null` is a system-written row;
//  * `actor.name` is already resolved server-side. Do not fetch users.

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  ArrowDownCircle,
  ArrowUpCircle,
  BookOpen,
  CheckCircle2,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Stamp,
  UserCheck,
  X,
  XCircle,
} from "lucide-react";

import { Button } from "@components/ui/buttonOrigin";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@components/ui/sheet";
import { cn } from "@admin/lib/utils";
import type {
  PassportJournalEntry,
  PassportSignoffAction,
} from "@admin/lib/passport-api";

import { LevelChip, levelTitle, type MatrixT } from "./level";
import { EnrollmentStatusChip } from "./status";
import type { CellTarget } from "./matrix-grid";
import {
  fmtDate,
  fmtLongDate,
  fmtTime,
  parseTimestamp,
  useJournal,
  useTerminalNames,
} from "./use-matrix";

const PAGE = 50;

type Tone = "neutral" | "good" | "bad" | "info" | "accent";

// `labelKey` is a key under `passportUi.matrix.journal.actions`.
const ACTION: Record<
  PassportSignoffAction,
  { labelKey: string; icon: any; tone: Tone }
> = {
  material_opened: {
    labelKey: "material_opened",
    icon: BookOpen,
    tone: "neutral",
  },
  quiz_passed: { labelKey: "quiz_passed", icon: CheckCircle2, tone: "good" },
  quiz_failed: { labelKey: "quiz_failed", icon: XCircle, tone: "bad" },
  observed: { labelKey: "observed", icon: UserCheck, tone: "good" },
  observation_declined: {
    labelKey: "observation_declined",
    icon: XCircle,
    tone: "bad",
  },
  recheck_passed: {
    labelKey: "recheck_passed",
    icon: RefreshCw,
    tone: "good",
  },
  recheck_failed: {
    labelKey: "recheck_failed",
    icon: RefreshCw,
    tone: "bad",
  },
  level_set: { labelKey: "level_set", icon: ArrowUpCircle, tone: "info" },
  level_rolled_back: {
    labelKey: "level_rolled_back",
    icon: ArrowDownCircle,
    tone: "bad",
  },
  stamp_issued: { labelKey: "stamp_issued", icon: Stamp, tone: "accent" },
};

const TONE_DOT: Record<Tone, string> = {
  neutral: "border-border bg-background text-muted-foreground",
  good: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/50 dark:text-emerald-400",
  bad: "border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-400",
  info: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/50 dark:text-sky-400",
  accent:
    "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900/60 dark:bg-violet-950/50 dark:text-violet-400",
};

const ACTOR_KEYS = ["office", "trainee", "system"];

/** meta is `unknown` server-side and never validated — read it defensively. */
function metaLevel(meta: unknown): number | null {
  const v = (meta as any)?.level ?? (meta as any)?.to_level;
  return typeof v === "number" ? v : null;
}

function dayKey(iso: string): string {
  const ms = parseTimestamp(iso);
  if (Number.isNaN(ms)) return "—";
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(t: MatrixT, locale: string, iso: string): string {
  const ms = parseTimestamp(iso);
  if (Number.isNaN(ms)) return t("journal.noDate");
  const d = new Date(ms);
  const today = new Date();
  const yst = new Date(today.getTime() - 86400_000);
  const same = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (same(d, today)) return t("journal.today");
  if (same(d, yst)) return t("journal.yesterday");
  return fmtLongDate(ms, locale);
}

function Entry({
  entry,
  terminalName,
}: {
  entry: PassportJournalEntry;
  terminalName: (id: string | null) => string;
}) {
  const t = useTranslations("passportUi.matrix");
  const known = ACTION[entry.action];
  const spec = {
    label: known ? t(`journal.actions.${known.labelKey}`) : entry.action,
    icon: known?.icon ?? BookOpen,
    tone: known?.tone ?? ("neutral" as Tone),
  };
  const Icon = spec.icon;
  const subject =
    entry.topic?.title_ru ??
    entry.module?.title_ru ??
    (entry.topic || entry.module ? t("journal.materialDeleted") : null);
  const moduleLine =
    entry.topic && entry.module?.title_ru ? entry.module.title_ru : null;
  const level = metaLevel(entry.meta);
  const actorKind = entry.actor.kind ?? "system";

  return (
    <li className="relative flex gap-3 pb-4 last:pb-0">
      <span
        aria-hidden
        className="absolute left-[13px] top-7 bottom-0 w-px bg-border"
      />
      <span
        className={cn(
          "relative z-10 flex size-[27px] shrink-0 items-center justify-center rounded-full border",
          TONE_DOT[spec.tone]
        )}
      >
        <Icon className="size-3.5" />
      </span>

      <div className="min-w-0 flex-1 pt-0.5">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-[13px] font-medium leading-tight">
            {spec.label}
            {level !== null && (
              <span className="ml-1 text-muted-foreground">{t("journal.levelArrow", { level })}</span>
            )}
          </span>
          <span className="text-[11.5px] tabular-nums text-muted-foreground">
            {fmtTime(entry.created_at)}
          </span>
        </div>

        {subject && (
          <p className="truncate text-[12.5px] leading-snug">{subject}</p>
        )}
        {moduleLine && (
          <p className="truncate text-[11px] leading-snug text-muted-foreground">
            {t("journal.moduleLine", { title: moduleLine })}
          </p>
        )}

        <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-muted-foreground">
          <span className="rounded border px-1 py-px text-[10px] uppercase tracking-wide">
            {ACTOR_KEYS.includes(actorKind)
              ? t(`journal.actors.${actorKind}`)
              : actorKind}
          </span>
          {/* A `kind === null` row has no human behind it, so the «Система»
              badge IS the actor — appending "без имени" would read as a person
              whose name we failed to resolve. The fallback stays for office and
              trainee rows, where a missing name is exactly that. Same rule as
              enrollments/_components/journal-sheet.tsx; these two sheets must
              not disagree about the same journal. */}
          {entry.actor.kind !== null && (
            <span className="text-foreground/80">
              {entry.actor.name ?? t("journal.actorUnnamed")}
            </span>
          )}
          <span>·</span>
          <span>{terminalName(entry.terminal_id)}</span>
          {entry.ip && (
            <>
              <span>·</span>
              <span className="font-mono text-[10.5px]">{entry.ip}</span>
            </>
          )}
        </p>
      </div>
    </li>
  );
}

/** The facts of the clicked cell, restated so the drawer answers "why is this
 *  square red" without the reader going back to the grid. */
function CellFacts({ target }: { target: CellTarget }) {
  const t = useTranslations("passportUi.matrix");
  const { column, cell } = target;
  if (!cell)
    return (
      <div className="rounded-md border border-dashed px-3 py-2 text-[12px] text-muted-foreground">
        {t("journal.factsNoData", { title: column.title_ru })}
      </div>
    );

  const overdue = cell.deadline_status === "overdue";
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-md border px-3 py-2",
        overdue && !cell.complete
          ? "border-red-300 bg-red-50/70 dark:border-red-900/70 dark:bg-red-950/30"
          : "bg-muted/40"
      )}
    >
      <span className="flex items-center gap-1.5 text-[12.5px]">
        <LevelChip level={cell.level_min} complete={cell.complete} />
        <span className="text-muted-foreground">
          {levelTitle(t, cell.level_min)}
        </span>
      </span>
      <span className="text-[12.5px] tabular-nums">
        {t.rich("journal.factsTopics", {
          b: (c) => <b>{c}</b>,
          done: cell.topics_done,
          total: cell.topics_total,
        })}
      </span>
      <span className="text-[12.5px]">
        {cell.deadline_at ? (
          <>
            {t("journal.factsDeadline")}{" "}
            <b
              className={cn(
                overdue && "text-red-700 dark:text-red-300",
                cell.deadline_status === "warning" &&
                  "text-amber-700 dark:text-amber-300"
              )}
            >
              {fmtDate(cell.deadline_at)}
            </b>
            {overdue && cell.complete && (
              <span className="ml-1 text-muted-foreground">
                {t("journal.factsClosedNote")}
              </span>
            )}
          </>
        ) : (
          <span className="text-muted-foreground">
            {t("journal.factsDeadlineNone")}
          </span>
        )}
      </span>
      {!cell.required && (
        <span className="text-[11.5px] text-muted-foreground">
          {t("journal.factsOptional")}
        </span>
      )}
    </div>
  );
}

export function MatrixJournalSheet({
  target,
  onOpenChange,
}: {
  target: CellTarget | null;
  onOpenChange: (v: boolean) => void;
}) {
  const t = useTranslations("passportUi.matrix");
  const locale = useLocale();
  const [limit, setLimit] = useState(PAGE);
  const [moduleOnly, setModuleOnly] = useState(true);
  const terminalName = useTerminalNames();

  const enrollmentId = target?.row.enrollment_id ?? null;
  const moduleId = target?.column.module_id ?? null;

  // Every cell opens from the top of its own history, focused on its module.
  useEffect(() => {
    setLimit(PAGE);
    setModuleOnly(true);
  }, [enrollmentId, moduleId]);

  const q = useJournal(enrollmentId, limit);
  const denied = q.isError && q.error?.status === 403;
  const loaded = q.data?.data ?? [];
  const enrollment = q.data?.enrollment;

  const rows =
    moduleOnly && moduleId
      ? loaded.filter((r) => r.module?.id === moduleId)
      : loaded;

  // The backend caps `limit` at 200, so "показать ещё" stops there rather than
  // silently returning the same 200 rows forever.
  const canLoadMore = loaded.length < (q.data?.total ?? 0) && limit < 200;

  const groups: { key: string; label: string; rows: PassportJournalEntry[] }[] =
    [];
  for (const r of rows) {
    const k = dayKey(r.created_at);
    const last = groups[groups.length - 1];
    if (last && last.key === k) last.rows.push(r);
    else groups.push({
        key: k,
        label: dayLabel(t, locale, r.created_at),
        rows: [r],
      });
  }

  const traineeName = target
    ? [target.row.employee.last_name, target.row.employee.first_name]
        .filter(Boolean)
        .join(" ") || t("unnamed")
    : "";

  return (
    <Sheet open={!!target} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto px-6 pb-10 sm:max-w-2xl">
        <SheetHeader className="px-0 pt-6">
          <SheetTitle className="flex flex-wrap items-center gap-2">
            {traineeName}
            {enrollment && <EnrollmentStatusChip status={enrollment.status} />}
          </SheetTitle>
          <SheetDescription className="text-[12.5px] leading-snug">
            {target ? (
              <>
                {target.column.title_ru} ·{" "}
                {target.row.employee.position || t("positionNotSet")} ·{" "}
                {target.row.terminal_name ??
                  terminalName(target.row.terminal_id)}
                {enrollment
                  ? ` · ${t("journal.enrolledSince", {
                      date: fmtDate(enrollment.started_at),
                    })}`
                  : ""}
              </>
            ) : (
              t("journal.subtitle")
            )}
          </SheetDescription>
        </SheetHeader>

        {target && (
          <div className="mb-4">
            <CellFacts target={target} />
          </div>
        )}

        {denied ? (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-[12.5px] leading-snug">
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
            <span>
              {t.rich("journal.noAccess", {
                code: (c) => (
                  <code className="font-mono text-[11px]">{c}</code>
                ),
              })}
            </span>
          </div>
        ) : q.isLoading ? (
          <p className="flex items-center gap-2 py-10 text-[12.5px] text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> {t("journal.loading")}
          </p>
        ) : q.isError ? (
          <p className="py-10 text-[12.5px] text-destructive">
            {q.error?.message || t("requestFailed")}
          </p>
        ) : (
          <div className="space-y-4">
            {/* The focus toggle, with an honest scope line: the journal route
                has no module filter, so this narrows the LOADED page only. */}
            <div className="flex flex-wrap items-center gap-2">
              {moduleId && (
                <button
                  type="button"
                  onClick={() => setModuleOnly((v) => !v)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded border px-2 py-1 text-[11.5px] transition-colors",
                    moduleOnly
                      ? "border-foreground/20 bg-muted"
                      : "border-border text-muted-foreground hover:bg-muted/60"
                  )}
                >
                  {t("journal.onlyModule", { title: target?.column.title_ru ?? "" })}
                  {moduleOnly && <X className="size-3" />}
                </button>
              )}
              <span className="text-[11px] text-muted-foreground">
                {moduleOnly && moduleId
                  ? t("journal.countFocused", {
                      shown: rows.length,
                      loaded: loaded.length,
                      total: q.data?.total ?? 0,
                    })
                  : t("journal.countAll", {
                      loaded: loaded.length,
                      total: q.data?.total ?? 0,
                    })}
              </span>
            </div>

            {rows.length === 0 ? (
              <div className="py-10 text-center">
                <p className="text-[13px] font-medium">
                  {moduleOnly && moduleId
                    ? t("journal.emptyModule")
                    : t("journal.emptyAll")}
                </p>
                <p className="mx-auto mt-1 max-w-sm text-[12px] leading-snug text-muted-foreground">
                  {moduleOnly && moduleId
                    ? t("journal.emptyModuleHint")
                    : t("journal.emptyAllHint")}
                </p>
              </div>
            ) : (
              <div className="space-y-5">
                {groups.map((g) => (
                  <section key={g.key}>
                    <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {g.label}
                    </p>
                    <ul className="m-0 list-none p-0">
                      {g.rows.map((r) => (
                        <Entry
                          key={r.id}
                          entry={r}
                          terminalName={terminalName}
                        />
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )}

            {canLoadMore && (
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                disabled={q.isFetching}
                onClick={() => setLimit((l) => Math.min(l + PAGE, 200))}
              >
                {q.isFetching && (
                  <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                )}
                {t("journal.loadMore")}
              </Button>
            )}
            {!canLoadMore && (q.data?.total ?? 0) > loaded.length && (
              <p className="text-center text-[11.5px] text-muted-foreground">
                {t("journal.limitReached", {
                  loaded: loaded.length,
                  total: q.data?.total ?? 0,
                })}
              </p>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
