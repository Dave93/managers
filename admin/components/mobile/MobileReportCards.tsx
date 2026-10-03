"use client";

import React from "react";
import { ChevronDown } from "lucide-react";

export type CardField = { label: React.ReactNode; value: React.ReactNode };
export type CardSpec = {
  primary: React.ReactNode;
  secondary?: React.ReactNode;
  right?: React.ReactNode;
  fields?: CardField[];
  details?: React.ReactNode;
  onClick?: () => void;
};

type Props<R> = {
  rows: R[];
  render: (row: R, idx: number) => CardSpec;
  isLoading?: boolean;
  empty?: React.ReactNode;
  onPrev?: () => void;
  onNext?: () => void;
  canPrev?: boolean;
  canNext?: boolean;
  page?: number;
};

export function MobileReportCards<R>({
  rows,
  render,
  isLoading,
  empty,
  onPrev,
  onNext,
  canPrev,
  canNext,
  page,
}: Props<R>) {
  const [openIdx, setOpenIdx] = React.useState<number | null>(null);

  if (isLoading) {
    return <div className="py-8 text-center text-sm text-muted-foreground">Загрузка…</div>;
  }
  if (!rows.length) {
    return <div className="py-8 text-center text-sm text-muted-foreground">{empty ?? "Нет данных"}</div>;
  }

  return (
    <div className="space-y-2">
      {rows.map((row, i) => {
        const c = render(row, i);
        const open = openIdx === i;
        const expandable = !!c.details;
        return (
          <div key={i} className="rounded-lg border bg-white dark:bg-slate-950">
            <div
              className={expandable ? "cursor-pointer p-3 active:bg-accent" : "p-3"}
              onClick={() => {
                c.onClick?.();
                if (expandable) setOpenIdx(open ? null : i);
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 grow">
                  <div className="truncate text-sm font-semibold">{c.primary}</div>
                  {c.secondary !== undefined && (
                    <div className="mt-0.5 text-xs text-muted-foreground">{c.secondary}</div>
                  )}
                </div>
                {c.right !== undefined && (
                  <div className="shrink-0 text-right text-sm font-semibold tabular-nums">{c.right}</div>
                )}
                {expandable && (
                  <ChevronDown
                    className={`mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
                  />
                )}
              </div>
              {c.fields && c.fields.length > 0 && (
                <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  {c.fields.map((f, j) => (
                    <div key={j} className="flex min-w-0 items-baseline gap-1">
                      <span className="shrink-0 text-muted-foreground">{f.label}:</span>
                      <span className="truncate font-medium">{f.value}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {open && c.details && <div className="border-t p-3 text-xs">{c.details}</div>}
          </div>
        );
      })}
      {(onPrev || onNext) && (
        <div className="flex items-center justify-between gap-2 pt-2">
          <button
            type="button"
            className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-40"
            disabled={!canPrev}
            onClick={onPrev}
          >
            Назад
          </button>
          {page !== undefined && <span className="text-xs text-muted-foreground">Стр. {page + 1}</span>}
          <button
            type="button"
            className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-40"
            disabled={!canNext}
            onClick={onNext}
          >
            Далее
          </button>
        </div>
      )}
    </div>
  );
}

export default MobileReportCards;
