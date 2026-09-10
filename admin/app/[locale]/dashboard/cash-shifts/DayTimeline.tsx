"use client";
import React from "react";
import { cn } from "@admin/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@admin/components/ui/popover";
import type { ShiftFlag } from "./flags";
import { barGeometry, timelineAxis } from "./timeline";
import { FLAG_LABEL, STATUS_LABEL, fmtDateTime, fmtDay, fmtDuration, fmtMoney, fmtTime } from "./format";
import type { CashShiftFull } from "./types";

type Flagged = CashShiftFull & { flags: ShiftFlag[] };
type Row = { key: string; label: string; unmapped: boolean; sub: string | null; shifts: Flagged[] };

// Retired registers (e.g. old Ekopark 67/79) carry neither a terminal nor an
// iiko group, only their own register name.
const locationLabel = (s: Flagged) =>
  s.terminal_name ?? s.iiko_group_name ?? s.cash_register_name ?? "Без названия";

// One row per register; the location label is printed only on its first row.
function buildRows(shifts: Flagged[]): Row[] {
  const byLocation = new Map<string, Flagged[]>();
  for (const s of shifts) {
    const loc = s.terminal_id ?? `group:${s.iiko_group_id ?? s.id}`;
    byLocation.set(loc, [...(byLocation.get(loc) ?? []), s]);
  }
  const rows: Row[] = [];
  for (const [loc, list] of byLocation) {
    const label = locationLabel(list[0]);
    const unmapped = !list[0].terminal_id;
    const registers = [...new Set(list.map((s) => s.cash_reg_number))].sort((a, b) => a - b);
    registers.forEach((reg, i) => {
      const own = list.filter((s) => s.cash_reg_number === reg);
      rows.push({
        key: `${loc}|${reg}`,
        label: i === 0 ? label : "",
        unmapped: i === 0 && unmapped,
        sub: registers.length > 1 ? `№ ${reg} · ${own[0].cash_register_name ?? "без имени"}` : null,
        shifts: own,
      });
    });
  }
  return rows;
}

// Unclosed shifts are the critical state: hatched red, so they stay apart from
// the amber "violation" fill even without colour vision.
const STRIPES =
  "repeating-linear-gradient(135deg, rgba(220,38,38,.55) 0 6px, rgba(220,38,38,.2) 6px 12px)";

// Fill + a darker 2px leading edge: the fill recedes, the edge keeps >= 3:1
// against the card in both themes.
const BAR_NORMAL =
  "border-slate-500 bg-slate-300 hover:bg-slate-400 dark:border-slate-400 dark:bg-slate-600 dark:hover:bg-slate-500";
const BAR_FLAGGED =
  "border-amber-700 bg-amber-400 hover:bg-amber-500 dark:border-amber-200 dark:bg-amber-500 dark:hover:bg-amber-400";
const BAR_UNCLOSED = "border-red-600 dark:border-red-400";

function barClass(flags: ShiftFlag[]) {
  if (flags.includes("unclosed")) return BAR_UNCLOSED;
  if (flags.length > 0) return BAR_FLAGGED;
  return BAR_NORMAL;
}

function LegendSwatch({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <span aria-hidden className={cn("inline-block h-3 w-4 rounded-[3px] border-l-2", className)} style={style} />;
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <LegendSwatch className={BAR_NORMAL} />в норме
      </span>
      <span className="inline-flex items-center gap-1.5">
        <LegendSwatch className={BAR_FLAGGED} />
        нарушение
      </span>
      <span className="inline-flex items-center gap-1.5">
        <LegendSwatch className={BAR_UNCLOSED} style={{ backgroundImage: STRIPES }} />
        не закрыта
      </span>
    </div>
  );
}

const DIFF_STATUSES = new Set(["ACCEPTED", "HASWARNINGS"]);

function ShiftDetails({ s }: { s: Flagged }) {
  return (
    <div className="space-y-3 text-sm">
      <div>
        <div className="font-semibold leading-snug">
          {locationLabel(s)} · № {s.cash_reg_number} · {s.cash_register_name ?? "без имени"}
        </div>
        <div className="mt-1 tabular-nums text-muted-foreground">
          {fmtDateTime(s.open_at)} → {s.close_at ? fmtDateTime(s.close_at) : "открыта"} ·{" "}
          {fmtDuration(s.open_at, s.close_at)}
        </div>
      </div>
      {s.flags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {s.flags.map((f) => (
            <span
              key={f}
              className={cn(
                "rounded px-1.5 py-0.5 text-xs",
                f === "unclosed"
                  ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
                  : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
              )}
            >
              {FLAG_LABEL[f]}
            </span>
          ))}
        </div>
      )}
      <div className="text-xs text-muted-foreground">
        Смена № {s.session_number} · {STATUS_LABEL[s.status] ?? s.status} · открыл:{" "}
        {s.responsible_user_name ?? "—"}
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 tabular-nums">
        <span className="text-muted-foreground">Заказы</span>
        <span className="text-right font-medium">{fmtMoney(s.pay_orders)}</span>
        <span className="text-muted-foreground">Наличные</span>
        <span className="text-right">{fmtMoney(s.sales_cash)}</span>
        <span className="text-muted-foreground">Карта</span>
        <span className="text-right">{fmtMoney(s.sales_card)}</span>
        <span className="text-muted-foreground">Расхождение</span>
        {/* iiko counts the cash only when a shift is accepted; before that
            cash_diff is just minus the cash sales, not a shortage. */}
        {DIFF_STATUSES.has(s.status) ? (
          <span className="text-right">{fmtMoney(s.cash_diff)}</span>
        ) : (
          <span className="text-right text-muted-foreground">— (смена не принята)</span>
        )}
      </div>
      {s.cashiers.length > 0 && (
        <div className="border-t pt-2">
          <div className="mb-1 text-xs text-muted-foreground">Кассиры</div>
          {s.cashiers.map((c) => (
            <div key={c.cashier_id} className="flex justify-between gap-3 tabular-nums">
              <span className="truncate">{c.cashier_name}</span>
              <span className="shrink-0 text-muted-foreground">
                {c.orders_count} зак. · {fmtMoney(c.revenue)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function DayTimeline({ day, shifts }: { day: string; shifts: Flagged[] }) {
  // Frozen at mount: the widget is historical, open bars need an end, not a clock.
  const [nowMs] = React.useState(() => Date.now());
  const axis = React.useMemo(() => timelineAxis(shifts, day, nowMs), [shifts, day, nowMs]);
  const rows = React.useMemo(() => buildRows(shifts), [shifts]);
  const span = axis.endMs - axis.startMs;
  const pct = (t: number) => `${((t - axis.startMs) / span) * 100}%`;

  if (shifts.length === 0) {
    return <p className="text-sm text-muted-foreground">В этот день смен нет.</p>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">
          {fmtDay(day)} <span className="font-normal text-muted-foreground">· касс: {rows.length}</span>
        </span>
        <Legend />
      </div>
      <div className="min-h-0 flex-1 overflow-auto rounded-md border">
        <div className="relative min-w-[720px]">
          <div className="sticky top-0 z-10 flex h-7 items-center border-b bg-card text-xs text-muted-foreground">
            <div className="w-56 shrink-0 px-3">Филиал / касса</div>
            <div className="relative mr-6 h-full flex-1">
              {axis.ticks.map((t) => (
                <span
                  key={t}
                  className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 tabular-nums"
                  style={{ left: pct(t) }}
                >
                  {fmtTime(new Date(t).toISOString())}
                </span>
              ))}
            </div>
          </div>
          <div className="relative">
            {/* Hour grid behind the bars. */}
            <div aria-hidden className="pointer-events-none absolute inset-y-0 left-56 right-6">
              {axis.ticks.map((t) => (
                <div key={t} className="absolute inset-y-0 border-l border-border/70" style={{ left: pct(t) }} />
              ))}
            </div>
            {rows.map((r, i) => (
              <div
                key={r.key}
                className={cn("flex items-center", r.label && r.sub ? "h-11" : "h-8", i > 0 && r.label && "border-t")}
              >
                {/* Location on top, register below: a long branch name never
                    squeezes the register name out, and vice versa. */}
                <div
                  className="w-56 shrink-0 overflow-hidden px-3"
                  title={[r.label, r.sub].filter(Boolean).join(" · ") || undefined}
                >
                  {r.label && (
                    <div className="flex items-center gap-1.5 text-sm">
                      <span className="truncate">{r.label}</span>
                      {r.unmapped && (
                        <span className="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground">не привязан</span>
                      )}
                    </div>
                  )}
                  {r.sub && <div className="truncate text-xs text-muted-foreground">{r.sub}</div>}
                </div>
                <div className="relative mr-6 h-5 flex-1">
                  {r.shifts.map((s) => {
                    const g = barGeometry(s, axis, nowMs);
                    const range = `${fmtTime(s.open_at)}–${s.close_at ? fmtTime(s.close_at) : "открыта"}`;
                    return (
                      <Popover key={s.id}>
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            aria-label={`Смена ${range}`}
                            title={s.flags.length > 0 ? `${range}: ${s.flags.map((f) => FLAG_LABEL[f]).join(", ")}` : range}
                            className={cn(
                              "absolute top-0 h-5 rounded-[3px] border-l-2 ring-2 ring-card transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                              barClass(s.flags)
                            )}
                            style={{
                              left: `${g.leftPct}%`,
                              width: `max(${g.widthPct}%, 4px)`,
                              backgroundImage: s.flags.includes("unclosed") ? STRIPES : undefined,
                            }}
                          />
                        </PopoverTrigger>
                        <PopoverContent className="w-80">
                          <ShiftDetails s={s} />
                        </PopoverContent>
                      </Popover>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
