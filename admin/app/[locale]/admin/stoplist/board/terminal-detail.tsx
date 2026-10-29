"use client";
import { useState } from "react";
import { ChevronDown, ChevronLeft } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { cn } from "@admin/lib/utils";
import { Skeleton } from "@admin/components/ui/skeleton";
import {
  BRAND_LABEL,
  fmtDate,
  fmtDateTime,
  fmtDuration,
  fmtTime,
  severityClass,
} from "./format";
import type { Incident, Position, TerminalGroup } from "./use-board";

function RepeatBadge({ n }: { n: number }) {
  const t = useTranslations("stoplistPage");
  if (n < 2) return null;
  return (
    <span
      className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300"
      title={t("board.repeatTitle")}
    >
      {t("board.repeat", { count: n })}
    </span>
  );
}

function PositionRow({ p, showDate }: { p: Position; showDate?: boolean }) {
  const t = useTranslations("stoplistPage");
  const variants = p.variants.length;
  const balance = p.variants.find((v) => v.last_balance != null)?.last_balance ?? null;
  return (
    <div className="flex items-center gap-3 py-1.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="truncate text-sm">{p.name}</span>
          {variants > 1 && (
            <span
              className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
              title={p.variants.map((v) => v.product_name).join("\n")}
            >
              {t("board.variants", { count: variants })}
            </span>
          )}
          <RepeatBadge n={p.times_30d} />
        </div>
        {showDate && (
          <div className="text-xs text-muted-foreground">{t("board.since", { date: fmtDateTime(p.started_at) })}</div>
        )}
      </div>
      {balance != null && balance > 0 && (
        <span className="hidden text-xs tabular-nums text-muted-foreground sm:inline" title={t("board.balanceTitle")}>
          {t("board.balance", { count: balance })}
        </span>
      )}
      <span className={cn("shrink-0 text-sm tabular-nums", severityClass(p.seconds))}>
        {fmtDuration(t, p.seconds)}
      </span>
    </div>
  );
}

function IncidentBlock({ inc }: { inc: Incident }) {
  const t = useTranslations("stoplistPage");
  const locale = useLocale();
  const n = inc.positions.length;
  return (
    <div className="rounded-lg border">
      <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-1.5 text-xs">
        <span className="font-semibold tabular-nums">{fmtTime(inc.started_at)}</span>
        <span className="text-muted-foreground">
          {fmtDate(inc.started_at, locale)} · {t("board.positionsCount", { count: n })}
        </span>
        <span className={cn("ml-auto tabular-nums", severityClass(inc.seconds))}>
          {fmtDuration(t, inc.seconds)}
        </span>
      </div>
      <div className="divide-y px-3">
        {inc.positions.map((p) => (
          <PositionRow key={p.key} p={p} />
        ))}
      </div>
    </div>
  );
}

function Section({
  title,
  count,
  children,
  defaultOpen = true,
  hint,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
  defaultOpen?: boolean;
  hint?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 py-2 text-left"
      >
        <ChevronDown
          className={cn("h-4 w-4 text-muted-foreground transition-transform", !open && "-rotate-90")}
        />
        <span className="text-sm font-semibold">{title}</span>
        <span className="text-sm tabular-nums text-muted-foreground">{count}</span>
        {hint && <span className="hidden text-xs text-muted-foreground sm:inline">{hint}</span>}
      </button>
      {open && <div className="space-y-2 pb-4">{children}</div>}
    </section>
  );
}

type Props = {
  terminal: TerminalGroup | null;
  isLoading: boolean;
  onBack?: () => void;
};

export function TerminalDetail({ terminal, isLoading, onBack }: Props) {
  const ts = useTranslations("stoplistPage");
  if (isLoading) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (!terminal) {
    return (
      <div className="flex h-full items-center justify-center p-10 text-center text-sm text-muted-foreground">
        {ts("board.selectTerminal")}
      </div>
    );
  }
  const t = terminal;
  return (
    <div className="px-4 pb-8">
      <div className="sticky top-0 z-[1] -mx-4 flex items-center gap-2 border-b bg-background px-4 py-3">
        {onBack && (
          <button type="button" onClick={onBack} aria-label={ts("board.back")} className="-ml-1 p-1">
            <ChevronLeft className="h-5 w-5" />
          </button>
        )}
        <div className="min-w-0">
          <h3 className="truncate text-lg font-semibold leading-tight">{t.name}</h3>
          <div className="truncate text-xs text-muted-foreground">
            {BRAND_LABEL[t.brand] ?? t.brand}
            {t.managersName ? ` · ${t.managersName}` : ""}
          </div>
        </div>
        <div className="ml-auto text-right text-xs text-muted-foreground">
          <div>
            <span className="text-base font-semibold tabular-nums text-foreground">{t.freshCount}</span>{" "}
            {ts("board.freshLabel")}
          </div>
          <div className="tabular-nums">
            {ts("board.staleChronicSummary", { stale: t.staleCount, chronic: t.chronicCount })}
          </div>
        </div>
      </div>

      {t.fresh.length === 0 && t.stale.length === 0 && t.chronic.length === 0 && (
        <div className="py-10 text-center text-sm text-emerald-600">{ts("board.empty")}</div>
      )}

      {t.fresh.length > 0 && (
        <Section
          title={ts("board.sectionFresh")}
          count={t.freshCount}
          hint={ts("board.sectionFreshHint")}
        >
          {t.fresh.map((inc) => (
            <IncidentBlock key={inc.key} inc={inc} />
          ))}
        </Section>
      )}
      {t.fresh.length === 0 && t.total > 0 && (
        <div className="py-3 text-sm text-muted-foreground">{ts("board.noNewStops")}</div>
      )}

      {t.stale.length > 0 && (
        <Section title={ts("board.sectionStale")} count={t.staleCount} hint={ts("board.sectionStaleHint")}>
          <div className="divide-y rounded-lg border px-3">
            {t.stale.map((p) => (
              <PositionRow key={p.key} p={p} showDate />
            ))}
          </div>
        </Section>
      )}

      {t.chronic.length > 0 && (
        <Section
          title={ts("board.sectionChronic")}
          count={t.chronicCount}
          hint={ts("board.sectionChronicHint")}
          defaultOpen={false}
        >
          <div className="divide-y rounded-lg border px-3 opacity-80">
            {t.chronic.map((p) => (
              <PositionRow key={p.key} p={p} showDate />
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
