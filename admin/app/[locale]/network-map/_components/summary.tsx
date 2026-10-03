"use client";

// Верхняя сводка, переключатель режимов, легенда и полоса «не на карте».
//
// «Без данных» стоит в сводке отдельной метрикой с предупреждающей тональностью,
// а не сноской мелким шрифтом: это 38 филиалов из 72, то есть половина сети,
// про которую экран честно ничего не знает. Пока эта цифра не ноль, любое
// суждение по остальным метрикам неполное, и человек должен видеть это сразу.

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { MapPinOff } from "lucide-react";

import { cn } from "@admin/lib/utils";
import type { Branch, NetworkTotals } from "./use-network-map";
import { BranchChip, EASE_OUT } from "./branch-glyph";
import {
  BRAND,
  GROUP,
  GROUP_ORDER,
  MODES,
  MapMode,
  SHIFT,
  SHIFT_ORDER,
  EXPERIENCED_COLOR,
  NO_DATA_COLOR,
  TRAINEE_COLOR,
  pct,
} from "./vocabulary";

function Metric({
  label,
  value,
  sub,
  tone,
  border,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: string;
  border?: boolean;
}) {
  return (
    <div
      className={cn(
        "min-w-0 px-3 py-1.5",
        border && "rounded-md border border-amber-500/40 bg-amber-500/5"
      )}
    >
      <div className={cn("text-[19px] font-semibold leading-none tabular-nums", tone ?? "text-slate-50")}>
        {value}
      </div>
      <div className="mt-1 truncate text-[10px] uppercase tracking-wide text-slate-500">
        {label}
      </div>
      {sub && <div className="mt-0.5 truncate text-[10.5px] text-slate-400">{sub}</div>}
    </div>
  );
}

export function SummaryStrip({
  n,
  branches,
}: {
  n: NetworkTotals;
  branches: Branch[];
}) {
  const byBrand = Object.fromEntries(n.by_brand.map((b) => [b.brand, b]));
  const offMap = n.branches_total - n.branches_on_map;
  return (
    <div className="flex flex-wrap items-stretch gap-x-1 gap-y-2 rounded-lg border border-slate-800 bg-slate-900/40 py-1.5">
      <Metric
        label="Филиалов"
        value={n.branches_total}
        sub={
          <span className="inline-flex items-center gap-2">
            <span className="inline-flex items-center gap-1">
              <span className="size-1.5 rounded-full" style={{ background: BRAND.les.color }} aria-hidden />
              {byBrand.les?.branches ?? 0}
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="size-1.5 rounded-full" style={{ background: BRAND.chopar.color }} aria-hidden />
              {byBrand.chopar?.branches ?? 0}
            </span>
          </span>
        }
      />
      <Metric
        label="На карте"
        value={n.branches_on_map}
        sub={offMap > 0 ? `${offMap} без координат` : "координаты у всех"}
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
        tone="text-amber-200"
      />
      <Metric
        label="День / ночь"
        value={
          <span>
            {n.shifts.day}
            <span className="mx-1 text-slate-600">/</span>
            {n.shifts.night}
          </span>
        }
        sub={
          n.shifts.unknown > 0
            ? `${n.shifts.unknown} без указания смены`
            : "смена указана у всех"
        }
      />
      <Metric
        label="Состав не заведён"
        value={n.branches_without_staff_data}
        sub={`из ${n.branches_total} филиалов`}
        tone="text-amber-300"
        border
      />
    </div>
  );
}

export function ModeSwitch({
  mode,
  onChange,
}: {
  mode: MapMode;
  onChange: (m: MapMode) => void;
}) {
  const current = MODES.find((m) => m.value === mode)!;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <div
        role="tablist"
        aria-label="Режим просмотра карты"
        className="inline-flex rounded-md border border-slate-800 bg-slate-900/70 p-0.5"
      >
        {MODES.map((m) => {
          const on = m.value === mode;
          return (
            <button
              key={m.value}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => onChange(m.value)}
              className={cn(
                "relative rounded px-2.5 py-1 text-[12px] font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400",
                on ? "text-slate-950" : "text-slate-400 hover:text-slate-100"
              )}
            >
              {on && (
                <motion.span
                  layoutId="network-map-mode"
                  className="absolute inset-0 rounded bg-slate-100"
                  transition={{ duration: 0.22, ease: EASE_OUT }}
                />
              )}
              <span className="relative">{m.label}</span>
            </button>
          );
        })}
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.p
          key={current.value}
          initial={{ opacity: 0, y: 3 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -3 }}
          transition={{ duration: 0.16, ease: EASE_OUT }}
          className="text-[12px] text-slate-400"
        >
          {current.question}
        </motion.p>
      </AnimatePresence>
    </div>
  );
}

function Swatch({ color, label, dotted }: { color: string; label: string; dotted?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] text-slate-300">
      <span
        className={cn("h-2 w-4 rounded-[2px]", dotted && "border border-dashed")}
        style={dotted ? { borderColor: color } : { background: color }}
        aria-hidden
      />
      {label}
    </span>
  );
}

export function Legend({ mode }: { mode: MapMode }) {
  const current = MODES.find((m) => m.value === mode)!;
  const swatches =
    mode === "shifts"
      ? SHIFT_ORDER.map((k) => ({ key: k, color: SHIFT[k].color, label: SHIFT[k].label }))
      : mode === "trainees"
      ? [
          { key: "t", color: TRAINEE_COLOR, label: "стажёры" },
          { key: "r", color: EXPERIENCED_COLOR, label: "остальные" },
        ]
      : mode === "data"
      ? [
          { key: "y", color: "#e2e8f0", label: "состав заведён" },
          { key: "n", color: NO_DATA_COLOR, label: "данных нет", dotted: true },
        ]
      : GROUP_ORDER.map((k) => ({ key: k, color: GROUP[k].color, label: GROUP[k].label }));

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          Кольцо
        </span>
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={mode}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15, ease: EASE_OUT }}
            className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5"
          >
            {swatches.map((s: any) => (
              <Swatch key={s.key} color={s.color} label={s.label} dotted={s.dotted} />
            ))}
          </motion.span>
        </AnimatePresence>
        <span className="h-3.5 w-px bg-slate-800" aria-hidden />
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          Ядро
        </span>
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] text-slate-300">
          <svg width="13" height="13" viewBox="-11 -11 22 22" aria-hidden>
            <circle r="9" fill={BRAND.les.color} />
          </svg>
          круг — Les Ailes
        </span>
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] text-slate-300">
          <svg width="13" height="13" viewBox="-11 -11 22 22" aria-hidden>
            <path d="M0,-9L7.79,-4.5L7.79,4.5L0,9L-7.79,4.5L-7.79,-4.5Z" fill={BRAND.chopar.color} />
          </svg>
          шестиугольник — ChoparPizza
        </span>
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.p
          key={mode}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15, ease: EASE_OUT }}
          className="mt-1.5 text-[11px] leading-snug text-slate-400"
        >
          {current.legend}
        </motion.p>
      </AnimatePresence>
    </div>
  );
}

export function OffMapStrip({
  branches,
  mode,
  hoveredId,
  selectedId,
  onHover,
  onSelect,
}: {
  branches: Branch[];
  mode: MapMode;
  hoveredId: string | null;
  selectedId: string | null;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
}) {
  if (branches.length === 0) return null;
  const staff = branches.reduce((s, b) => s + b.staff.total, 0);
  return (
    // overflow-hidden здесь не косметика: горизонтальный скроллер внутри
    // прокидывал наверх свою min-content ширину (все 27 чипов в строку), и
    // из-за этого SidebarInset — flex-элемент с min-width:auto — распирал всю
    // страницу до горизонтального скролла. Замерено в браузере: без этого
    // main получал 1600px рядом с сайдбаром на 256px.
    <section className="min-w-0 max-w-full overflow-hidden rounded-lg border border-dashed border-slate-700 bg-slate-900/30 px-2.5 py-2">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-0.5">
        <h2 className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-300">
          <MapPinOff className="size-3.5 text-slate-500" aria-hidden />
          Не на карте · {branches.length}
        </h2>
        <p className="text-[11px] text-slate-500">
          координаты филиала не заведены, поэтому узла на карте нет — но люди
          есть: {staff} в этой полосе
        </p>
      </div>
      <div className="mt-1.5 flex gap-1 overflow-x-auto pb-1">
        {branches.map((b) => {
          const active = b.id === hoveredId || b.id === selectedId;
          return (
            <button
              key={b.id}
              type="button"
              onMouseEnter={() => onHover(b.id)}
              onMouseLeave={() => onHover(null)}
              onFocus={() => onHover(b.id)}
              onBlur={() => onHover(null)}
              onClick={() => onSelect(b.id)}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-md border px-1.5 py-1 transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400",
                active
                  ? "border-slate-500 bg-slate-800"
                  : "border-slate-800 bg-slate-900/60 hover:border-slate-700 hover:bg-slate-800/70"
              )}
            >
              <BranchChip branch={b} mode={mode} size={22} />
              <span className="max-w-[130px] truncate text-[11.5px] text-slate-200">
                {b.name}
              </span>
              <span
                className={cn(
                  "font-mono text-[10.5px]",
                  b.has_staff_data ? "text-slate-400" : "text-amber-300/80"
                )}
              >
                {b.has_staff_data ? b.staff.total : "?"}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
