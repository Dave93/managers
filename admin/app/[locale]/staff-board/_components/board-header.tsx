"use client";

// Сводка по сети и фильтры.
//
// «Без данных» стоит отдельной метрикой и набрано янтарём: это 38 филиалов из
// 72, то есть половина сети, про которую экран честно ничего не знает. Пока
// эта цифра не ноль, любое суждение по остальным метрикам неполное, и человек
// должен видеть это сразу. Янтарь на экране один и означает ровно проблему —
// поэтому у «стажёров» его нет, а строка про PIN набрана обычным серым.
//
// Сигналы — это одновременно и цифры сводки, и фильтры: «10 без менеджера» без
// возможности нажать и увидеть, каких именно, остаётся плакатом.

import * as React from "react";
import { motion } from "framer-motion";
import { KeyRound, RotateCcw, Search, UserSearch } from "lucide-react";

import { Input } from "@components/ui/input";
import { Switch } from "@components/ui/switch";
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
  Brand,
  NetworkTotals,
  ShiftKey,
  SignalKey,
} from "./use-staff-board";
import {
  BRAND,
  BrandMark,
  SHIFT,
  SHIFT_ORDER,
  SIGNAL,
  SIGNAL_ORDER,
  pct,
} from "./vocabulary";

export interface BoardFilters {
  brand: "" | Brand;
  branchQuery: string;
  employeeQuery: string;
  shift: "" | ShiftKey;
  onlyProblems: boolean;
  onlyNoData: boolean;
  signals: SignalKey[];
}

export const EMPTY_FILTERS: BoardFilters = {
  brand: "",
  branchQuery: "",
  employeeQuery: "",
  shift: "",
  onlyProblems: false,
  onlyNoData: false,
  signals: [],
};

export function filtersActive(f: BoardFilters): boolean {
  return (
    f.brand !== "" ||
    f.branchQuery.trim() !== "" ||
    f.employeeQuery.trim() !== "" ||
    f.shift !== "" ||
    f.onlyProblems ||
    f.onlyNoData ||
    f.signals.length > 0
  );
}

/** Фильтры, которые режут людей внутри карточки, а не карточки целиком.
 *  Филиалам без данных они неприменимы — там людей нет вообще. */
export function peopleLevelFilters(f: BoardFilters): boolean {
  return f.employeeQuery.trim() !== "" || f.shift !== "";
}

function Metric({
  label,
  value,
  sub,
  tone,
  warn,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: string;
  warn?: boolean;
}) {
  return (
    <div className={cn("min-w-0 rounded-md px-2.5 py-1.5", warn && "bg-muted/50")}>
      <div
        className={cn(
          "text-[19px] font-semibold leading-none tabular-nums",
          tone
        )}
      >
        {value}
      </div>
      <div className="mt-1 truncate text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      {sub && (
        <div className="mt-0.5 truncate text-[10.5px] text-muted-foreground">
          {sub}
        </div>
      )}
    </div>
  );
}

export function SummaryStrip({ n }: { n: NetworkTotals }) {
  const byBrand = Object.fromEntries(n.by_brand.map((b) => [b.brand, b]));
  const allPinsMissing = n.staff_total > 0 && n.pin_set_total === 0;
  return (
    <div className="min-w-0 space-y-2">
      <div className="grid min-w-0 grid-cols-2 gap-1 rounded-lg border bg-card p-1.5 sm:grid-cols-3 lg:grid-cols-6">
        <Metric
          label="Филиалов"
          value={n.branches_total}
          sub={
            <span className="inline-flex items-center gap-2">
              <span className="inline-flex items-center gap-1">
                <BrandMark brand="les" size={8} />
                {byBrand.les?.branches ?? 0}
              </span>
              <span className="inline-flex items-center gap-1">
                <BrandMark brand="chopar" size={8} />
                {byBrand.chopar?.branches ?? 0}
              </span>
            </span>
          }
        />
        <Metric
          label="Состав заведён"
          value={n.branches_with_staff_data}
          sub={`из ${n.branches_total} филиалов`}
        />
        <Metric
          label="Данные не заведены"
          value={n.branches_without_staff_data}
          sub="ни одной строки в справочнике"
          tone="text-amber-700 dark:text-amber-300"
          warn
        />
        <Metric
          label="Сотрудников"
          value={n.staff_total}
          sub={`${byBrand.les?.staff ?? 0} / ${byBrand.chopar?.staff ?? 0} по брендам`}
        />
        <Metric
          label="Стажёров"
          value={n.trainees_total}
          sub={`${pct(n.trainees_total, n.staff_total)} штата`}
        />
        <Metric
          label="День / ночь"
          value={
            <span>
              {n.shifts.day}
              <span className="mx-1 text-muted-foreground">/</span>
              {n.shifts.night}
            </span>
          }
          sub={
            n.shifts.unknown > 0
              ? `${n.shifts.unknown} без указания смены`
              : "смена указана у всех"
          }
        />
      </div>

      <p className="flex min-w-0 items-start gap-1.5 px-2.5 text-[11px] leading-snug text-muted-foreground">
        <KeyRound className="mt-px size-3 shrink-0" aria-hidden />
        {allPinsMissing ? (
          <span>
            PIN не задан ни у кого из {n.staff_total} сотрудников — войти в киоск
            аттестации по PIN сейчас нельзя ни на одном филиале.
          </span>
        ) : (
          <span>
            PIN задан у {n.pin_set_total} из {n.staff_total} сотрудников;
            остальные {n.pin_missing_total} в киоск аттестации не войдут.
          </span>
        )}
      </p>
    </div>
  );
}

function SignalChip({
  k,
  count,
  active,
  onToggle,
}: {
  k: SignalKey;
  count: number;
  active: boolean;
  onToggle: () => void;
}) {
  const meta = SIGNAL[k];
  const Icon = meta.icon;
  const disabled = count === 0;
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11.5px] font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        disabled
          ? "cursor-not-allowed border-dashed text-muted-foreground opacity-60"
          : active
          ? "border-foreground bg-foreground text-background"
          : meta.chip + " hover:brightness-95"
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {meta.filterLabel}
      <span className="tabular-nums">{count}</span>
      {active && <span className="sr-only">— фильтр включён</span>}
    </button>
  );
}

export function FilterBar({
  n,
  value,
  onChange,
  shownBranches,
}: {
  n: NetworkTotals;
  value: BoardFilters;
  onChange: (f: BoardFilters) => void;
  shownBranches: number;
}) {
  const set = (patch: Partial<BoardFilters>) =>
    onChange({ ...value, ...patch });
  const toggleSignal = (k: SignalKey) =>
    set({
      signals: value.signals.includes(k)
        ? value.signals.filter((x) => x !== k)
        : [...value.signals, k],
    });

  const active = filtersActive(value);

  return (
    <div className="min-w-0 space-y-2 rounded-lg border bg-card p-2">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Сигналы
        </span>
        {SIGNAL_ORDER.map((k) => (
          <SignalChip
            key={k}
            k={k}
            count={n.signals[k] ?? 0}
            active={value.signals.includes(k)}
            onToggle={() => toggleSignal(k)}
          />
        ))}
      </div>

      <div className="flex min-w-0 flex-wrap items-end gap-x-3 gap-y-2">
        <div className="min-w-0">
          <span
            className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
            id="staff-board-brand-label"
          >
            Бренд
          </span>
          <div
            role="group"
            aria-labelledby="staff-board-brand-label"
            className="inline-flex rounded-md border p-0.5"
          >
            {([
              { v: "" as const, label: "Все" },
              { v: "les" as const, label: BRAND.les.label },
              { v: "chopar" as const, label: BRAND.chopar.label },
            ]).map((b) => {
              const on = value.brand === b.v;
              return (
                <button
                  key={b.v || "all"}
                  type="button"
                  aria-pressed={on}
                  onClick={() => set({ brand: b.v })}
                  className={cn(
                    "relative inline-flex items-center gap-1.5 rounded px-2 py-1 text-[11.5px] font-medium transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    on ? "text-background" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {on && (
                    <motion.span
                      layoutId="staff-board-brand-pill"
                      className="absolute inset-0 rounded bg-foreground"
                      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                    />
                  )}
                  <span className="relative inline-flex items-center gap-1.5">
                    {b.v && <BrandMark brand={b.v} size={9} />}
                    {b.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="min-w-0">
          <Label
            htmlFor="staff-board-branch-q"
            className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
          >
            Филиал
          </Label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              id="staff-board-branch-q"
              value={value.branchQuery}
              onChange={(e) => set({ branchQuery: e.target.value })}
              placeholder="название или адрес"
              className="h-8 w-[190px] pl-7 text-[12px]"
            />
          </div>
        </div>

        <div className="min-w-0">
          <Label
            htmlFor="staff-board-person-q"
            className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
          >
            Сотрудник
          </Label>
          <div className="relative">
            <UserSearch
              className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              id="staff-board-person-q"
              value={value.employeeQuery}
              onChange={(e) => set({ employeeQuery: e.target.value })}
              placeholder="имя, фамилия или должность"
              className="h-8 w-[210px] pl-7 text-[12px]"
            />
          </div>
        </div>

        <div className="min-w-0">
          <Label
            htmlFor="staff-board-shift"
            className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
          >
            Смена
          </Label>
          <Select
            value={value.shift || "all"}
            onValueChange={(v) =>
              set({ shift: v === "all" ? "" : (v as ShiftKey) })
            }
          >
            <SelectTrigger id="staff-board-shift" className="h-8 w-[190px] text-[12px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все смены</SelectItem>
              {SHIFT_ORDER.map((s) => (
                <SelectItem key={s} value={s}>
                  {SHIFT[s].label}
                  <span className="ml-1 tabular-nums text-muted-foreground">
                    {n.shifts[s]}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2 pb-1">
          <Switch
            id="staff-board-problems"
            checked={value.onlyProblems}
            onCheckedChange={(c) => set({ onlyProblems: c })}
          />
          <Label htmlFor="staff-board-problems" className="text-[12px] font-normal">
            Только с проблемами
            <span className="ml-1 tabular-nums text-muted-foreground">
              {n.signals.branches_with_warnings}
            </span>
          </Label>
        </div>

        <div className="flex items-center gap-2 pb-1">
          <Switch
            id="staff-board-nodata"
            checked={value.onlyNoData}
            onCheckedChange={(c) => set({ onlyNoData: c })}
          />
          <Label htmlFor="staff-board-nodata" className="text-[12px] font-normal">
            Только без данных
            <span className="ml-1 tabular-nums text-muted-foreground">
              {n.branches_without_staff_data}
            </span>
          </Label>
        </div>

        {active && (
          <button
            type="button"
            onClick={() => onChange(EMPTY_FILTERS)}
            className="mb-1 inline-flex items-center gap-1 rounded border px-2 py-1 text-[11.5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <RotateCcw className="size-3" aria-hidden />
            Сбросить
          </button>
        )}

        <span
          className="mb-1 ml-auto text-[11.5px] text-muted-foreground"
          aria-live="polite"
        >
          Показано {shownBranches} из {n.branches_total} филиалов
        </span>
      </div>
    </div>
  );
}
