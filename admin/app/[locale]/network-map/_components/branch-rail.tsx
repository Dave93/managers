"use client";

// Правая колонка: список филиалов и карточка филиала.
//
// Список связан с картой в обе стороны — наведение здесь подсвечивает узел,
// наведение на узел подсвечивает строку и подкручивает её в видимую область.
// Он же делает экран доступным с клавиатуры: узлы на карте намеренно не
// попадают в таб-обход (45 подряд идущих точек остановки — это не доступность,
// а ловушка), а вся навигация идёт через настоящие кнопки списка.
//
// Филиалы без данных о составе стоят отдельной группой внизу, а не вперемешку
// с нулями. Смешать их значило бы сказать руководству, что в 38 филиалах из 72
// никто не работает.

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  Baby,
  MapPin,
  MapPinOff,
  Moon,
  Sun,
  UserCog,
} from "lucide-react";

import { cn } from "@admin/lib/utils";
import type { Branch } from "./use-network-map";
import { BranchChip, EASE_OUT, traineeShare } from "./branch-glyph";
import {
  BRAND,
  GROUP,
  GROUP_ORDER,
  MapMode,
  SHIFT,
  SHIFT_ORDER,
  TRAINEE_ALERT,
  TRAINEE_COLOR,
  pct,
  plural,
} from "./vocabulary";

function BrandTag({ brand }: { brand: Branch["brand"] }) {
  const b = BRAND[brand] ?? BRAND.other;
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap text-[10px] text-slate-400">
      <span
        className="size-1.5 rounded-full"
        style={{ background: b.color }}
        aria-hidden
      />
      {b.label}
    </span>
  );
}

/** Правая метрика строки — она меняется вместе с режимом, как и узлы. */
function RowMetric({ b, mode }: { b: Branch; mode: MapMode }) {
  if (!b.has_staff_data)
    return (
      <span className="whitespace-nowrap text-[11px] text-amber-300/80">
        нет данных
      </span>
    );
  if (mode === "shifts")
    return (
      <span className="whitespace-nowrap font-mono text-[11px] text-slate-300">
        <Sun className="mr-0.5 inline size-3 text-slate-200" aria-hidden />
        {b.staff.shifts.day}
        <span className="mx-1 text-slate-600">/</span>
        <Moon className="mr-0.5 inline size-3 text-indigo-300" aria-hidden />
        {b.staff.shifts.night}
      </span>
    );
  if (mode === "trainees") {
    const share = traineeShare(b);
    return (
      <span
        className={cn(
          "whitespace-nowrap font-mono text-[11px]",
          share >= TRAINEE_ALERT ? "text-amber-300" : "text-slate-300"
        )}
      >
        {b.staff.trainees} · {pct(b.staff.trainees, b.staff.total)}
      </span>
    );
  }
  if (mode === "data")
    return (
      <span className="whitespace-nowrap text-[11px] text-emerald-300/90">
        состав заведён
      </span>
    );
  return (
    <span className="whitespace-nowrap font-mono text-[12px] font-semibold text-slate-100 tabular-nums">
      {b.staff.total}
    </span>
  );
}

function BranchRow({
  b,
  mode,
  active,
  onHover,
  onSelect,
}: {
  b: Branch;
  mode: MapMode;
  active: boolean;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
}) {
  const ref = React.useRef<HTMLButtonElement | null>(null);
  React.useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest" });
  }, [active]);
  return (
    <button
      ref={ref}
      type="button"
      onMouseEnter={() => onHover(b.id)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(b.id)}
      onBlur={() => onHover(null)}
      onClick={() => onSelect(b.id)}
      className={cn(
        "flex w-full items-center gap-2 rounded-md border border-transparent px-1.5 py-1 text-left transition-colors",
        "hover:border-slate-700 hover:bg-slate-800/60",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400",
        active && "border-slate-600 bg-slate-800/80"
      )}
    >
      <BranchChip branch={b} mode={mode} size={26} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[12.5px] font-medium text-slate-100">
            {b.name}
          </span>
          {!b.has_coords && (
            <MapPinOff
              className="size-3 shrink-0 text-slate-500"
              aria-label="нет координат"
            />
          )}
        </span>
        <BrandTag brand={b.brand} />
      </span>
      <RowMetric b={b} mode={mode} />
    </button>
  );
}

export function BranchList({
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
  const withData = branches
    .filter((b) => b.has_staff_data)
    .sort((a, z) => z.staff.total - a.staff.total || a.name.localeCompare(z.name, "ru"));
  const noData = branches
    .filter((b) => !b.has_staff_data)
    .sort((a, z) => a.name.localeCompare(z.name, "ru"));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-baseline justify-between px-1.5 pb-1.5">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          Филиалы
        </h2>
        <span className="text-[10px] text-slate-500">по убыванию штата</span>
      </div>
      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-1">
        {withData.map((b) => (
          <BranchRow
            key={b.id}
            b={b}
            mode={mode}
            active={b.id === hoveredId || b.id === selectedId}
            onHover={onHover}
            onSelect={onSelect}
          />
        ))}

        {noData.length > 0 && (
          <>
            <div className="mt-3 border-t border-dashed border-slate-700 px-1.5 pb-1 pt-2">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-300/90">
                Состав не заведён · {noData.length}
              </div>
              <p className="mt-0.5 text-[10.5px] leading-snug text-slate-500">
                В справочнике сотрудников по этим филиалам нет ни одной строки.
                Это пробел в данных, а не пустой филиал — сколько там людей,
                экран не знает и не показывает.
              </p>
            </div>
            {noData.map((b) => (
              <BranchRow
                key={b.id}
                b={b}
                mode={mode}
                active={b.id === hoveredId || b.id === selectedId}
                onHover={onHover}
                onSelect={onSelect}
              />
            ))}
          </>
        )}

        {branches.length === 0 && (
          <p className="px-1.5 py-6 text-[12px] leading-snug text-slate-400">
            В вашем скоупе нет активных филиалов. Скоуп задаётся ролью в
            office-админке; если филиалы должны быть, их назначает администратор.
          </p>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  tone?: string;
}) {
  return (
    <div className="min-w-0">
      <div className={cn("text-[15px] font-semibold tabular-nums", tone ?? "text-slate-100")}>
        {value}
      </div>
      <div className="truncate text-[10px] uppercase tracking-wide text-slate-500">
        {label}
      </div>
    </div>
  );
}

function Bar({ parts }: { parts: { key: string; n: number; color: string; label: string }[] }) {
  const total = parts.reduce((s, p) => s + p.n, 0);
  if (!total) return null;
  return (
    <div className="space-y-1">
      <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
        {parts
          .filter((p) => p.n > 0)
          .map((p) => (
            <div
              key={p.key}
              style={{ width: `${(p.n / total) * 100}%`, background: p.color }}
              title={`${p.label}: ${p.n}`}
            />
          ))}
      </div>
      <div className="flex flex-wrap gap-x-2.5 gap-y-0.5">
        {parts
          .filter((p) => p.n > 0)
          .map((p) => (
            <span key={p.key} className="inline-flex items-center gap-1 text-[10.5px] text-slate-400">
              <span className="size-1.5 rounded-full" style={{ background: p.color }} aria-hidden />
              {p.label} <span className="font-mono text-slate-200">{p.n}</span>
            </span>
          ))}
      </div>
    </div>
  );
}

export function BranchCard({
  b,
  mode,
  onBack,
}: {
  b: Branch;
  mode: MapMode;
  onBack: () => void;
}) {
  const brand = BRAND[b.brand] ?? BRAND.other;
  const share = traineeShare(b);
  const gradeKeys = ["1", "2", "3", "—"].filter((k) => (b.staff.grades[k] ?? 0) > 0);

  return (
    <motion.div
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 12 }}
      transition={{ duration: 0.18, ease: EASE_OUT }}
      className="flex h-full min-h-0 flex-col"
    >
      <button
        type="button"
        onClick={onBack}
        className="mb-2 inline-flex w-fit items-center gap-1 rounded px-1 py-0.5 text-[11px] text-slate-400 transition-colors hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
      >
        <ArrowLeft className="size-3.5" /> ко всем филиалам
      </button>

      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="flex items-start gap-2.5">
          <BranchChip branch={b} mode={mode} size={44} />
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold leading-tight text-slate-50">
              {b.name}
            </h3>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <BrandTag brand={b.brand} />
              {b.playground && (
                <span className="inline-flex items-center gap-1 whitespace-nowrap rounded border border-sky-900/70 bg-sky-950/50 px-1 py-px text-[10px] text-sky-300">
                  <Baby className="size-3" aria-hidden /> детская площадка
                </span>
              )}
              {!b.has_coords && (
                <span className="inline-flex items-center gap-1 whitespace-nowrap rounded border border-slate-700 bg-slate-800/70 px-1 py-px text-[10px] text-slate-300">
                  <MapPinOff className="size-3" aria-hidden /> нет на карте
                </span>
              )}
            </div>
          </div>
        </div>

        <dl className="mt-3 space-y-1.5 text-[11.5px] leading-snug">
          <div className="flex gap-2">
            <dt className="w-[74px] shrink-0 text-slate-500">Менеджер</dt>
            <dd className="min-w-0 text-slate-200">
              {b.manager_name || <span className="text-slate-500">не указан</span>}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-[74px] shrink-0 text-slate-500">Адрес</dt>
            <dd className="min-w-0 text-slate-300">
              {b.address || <span className="text-slate-500">не указан</span>}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-[74px] shrink-0 text-slate-500">Координаты</dt>
            <dd className="min-w-0 font-mono text-[11px] text-slate-400">
              {b.has_coords ? (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="size-3" aria-hidden />
                  {b.lat?.toFixed(5)}, {b.lon?.toFixed(5)}
                </span>
              ) : (
                <span className="font-sans text-slate-500">
                  не заведены — филиал показан в полосе под картой
                </span>
              )}
            </dd>
          </div>
        </dl>

        {!b.has_staff_data ? (
          <div className="mt-3 rounded-md border border-dashed border-amber-500/40 bg-amber-500/5 p-2.5">
            <div className="text-[12px] font-medium text-amber-200">
              Состав не заведён
            </div>
            <p className="mt-1 text-[11px] leading-snug text-slate-400">
              В справочнике сотрудников нет ни одной активной строки с этим
              филиалом. Экран не подставляет сюда ноль: «людей нет» и «данных
              нет» — разные факты, и второй лечится заведением сотрудников в
              разделе «Сотрудники», а не наймом.
            </p>
          </div>
        ) : b.staff.total === 0 ? (
          <div className="mt-3 rounded-md border border-slate-700 bg-slate-800/40 p-2.5">
            <div className="text-[12px] font-medium text-slate-200">
              Активных сотрудников нет
            </div>
            <p className="mt-1 text-[11px] leading-snug text-slate-400">
              Строки по филиалу в справочнике есть, но все они неактивны. Это
              настоящий ноль, а не пробел в данных.
            </p>
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            <div className="grid grid-cols-3 gap-2 rounded-md border border-slate-800 bg-slate-900/50 px-2.5 py-2">
              <Stat label="всего" value={b.staff.total} />
              <Stat
                label="стажёры"
                value={`${b.staff.trainees} · ${pct(b.staff.trainees, b.staff.total)}`}
                tone={share >= TRAINEE_ALERT ? "text-amber-300" : undefined}
              />
              <Stat
                label="день / ночь"
                value={`${b.staff.shifts.day} / ${b.staff.shifts.night}`}
              />
            </div>

            {share >= TRAINEE_ALERT && (
              <p
                className="rounded border-l-2 pl-2 text-[11px] leading-snug text-amber-200"
                style={{ borderColor: TRAINEE_COLOR }}
              >
                Стажёров {pct(b.staff.trainees, b.staff.total)} штата — филиал
                сейчас больше учит, чем работает.
              </p>
            )}

            <section className="space-y-1.5">
              <h4 className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Состав
              </h4>
              <Bar
                parts={GROUP_ORDER.map((k) => ({
                  key: k,
                  n: b.staff.groups[k] ?? 0,
                  color: GROUP[k].color,
                  label: GROUP[k].label,
                }))}
              />
            </section>

            <section className="space-y-1.5">
              <h4 className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Смены
              </h4>
              <Bar
                parts={SHIFT_ORDER.map((k) => ({
                  key: k,
                  n: b.staff.shifts[k] ?? 0,
                  color: SHIFT[k].color,
                  label: SHIFT[k].label,
                }))}
              />
              {b.staff.shifts.unknown > 0 && (
                <p className="text-[10.5px] leading-snug text-slate-500">
                  У {b.staff.shifts.unknown}{" "}
                  {plural(b.staff.shifts.unknown, "сотрудника", "сотрудников", "сотрудников")}{" "}
                  смена в должности не написана — это пробел справочника, а не
                  третья смена.
                </p>
              )}
            </section>

            <section className="space-y-1.5">
              <h4 className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Разряды
              </h4>
              <div className="flex flex-wrap gap-1">
                {gradeKeys.map((k) => (
                  <span
                    key={k}
                    className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-800/70 px-1.5 py-px text-[10.5px] text-slate-200"
                  >
                    {k === "—" ? "разряд не указан" : `${k} разряд`}
                    <span className="font-mono text-slate-400">
                      {b.staff.grades[k]}
                    </span>
                  </span>
                ))}
                {gradeKeys.length === 0 && (
                  <span className="text-[11px] text-slate-500">
                    ни в одной должности разряд не указан
                  </span>
                )}
              </div>
            </section>

            <section className="space-y-1">
              <h4 className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Должности
              </h4>
              <ul className="space-y-px">
                {b.staff.roles.map((r) => (
                  <li
                    key={r.role}
                    className="flex items-baseline gap-2 border-b border-slate-800/70 py-0.5 text-[11.5px] last:border-0"
                  >
                    <UserCog className="size-3 shrink-0 text-slate-600" aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-slate-200">
                      {r.role}
                    </span>
                    <span className="font-mono tabular-nums text-slate-400">
                      {r.n}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        )}
      </div>
    </motion.div>
  );
}

export function Rail(props: {
  branches: Branch[];
  mode: MapMode;
  hoveredId: string | null;
  selectedId: string | null;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
  onClear: () => void;
}) {
  const selected = props.selectedId
    ? props.branches.find((b) => b.id === props.selectedId)
    : null;
  return (
    <div className="relative flex h-full min-h-0 flex-col rounded-lg border border-slate-800 bg-slate-900/40 p-2">
      <AnimatePresence mode="wait" initial={false}>
        {selected ? (
          <BranchCard key="card" b={selected} mode={props.mode} onBack={props.onClear} />
        ) : (
          <motion.div
            key="list"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15, ease: EASE_OUT }}
            className="flex h-full min-h-0 flex-col"
          >
            <BranchList {...props} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
