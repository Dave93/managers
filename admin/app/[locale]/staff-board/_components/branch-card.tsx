"use client";

// Карточка филиала: шапка, состав одним взглядом, сигналы, люди.
//
// Порядок блоков не декоративный. Сначала «что это за филиал», потом «сколько
// и кого», потом «что с командой не так», и только потом фамилии: сигнал должен
// попасться на глаза до того, как человек начнёт читать список из тридцати
// шести строк. Карточка без сигналов — просто список фамилий, ради которого
// незачем было делать экран.
//
// Люди сгруппированы по должностным группам, а внутри группы разделены по
// сменам: структура команды читается только так. Плоский список из 36 человек
// не отвечает ни на один вопрос, ради которого сюда пришли.

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, MapPin, UserRound } from "lucide-react";

import { cn } from "@admin/lib/utils";
import type { Branch, GroupKey, Person, ShiftKey } from "./use-staff-board";
import {
  BRAND,
  BrandMark,
  GROUP,
  GROUP_ORDER,
  SHIFT,
  SHIFT_ORDER,
  SIGNAL,
  TRAINEE_CHIP,
  peopleWord,
} from "./vocabulary";

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

/** Сколько людей видно до раскрытия. Максимум в сети — 36, и такая карточка
 *  без свёртки растянула бы строку сетки на весь экран. */
const COLLAPSED = 7;

function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim().toLocaleLowerCase("ru-RU");
  if (!q) return <>{text}</>;
  const i = text.toLocaleLowerCase("ru-RU").indexOf(q);
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded-[2px] bg-amber-200 px-px text-inherit dark:bg-amber-500/30">
        {text.slice(i, i + q.length)}
      </mark>
      {text.slice(i + q.length)}
    </>
  );
}

function PersonRow({ p, query }: { p: Person; query: string }) {
  const Shift = SHIFT[p.shift].icon;
  return (
    <li className="flex min-w-0 items-center gap-2 rounded px-1 py-[3px] transition-colors hover:bg-muted/70">
      <span
        aria-hidden
        className={cn(
          "grid size-[22px] shrink-0 place-items-center rounded-full border text-[9px] font-semibold uppercase",
          p.is_trainee
            ? "border-amber-400 bg-amber-50 text-amber-800 dark:border-amber-600/70 dark:bg-amber-950/50 dark:text-amber-200"
            : "border-border bg-muted text-muted-foreground"
        )}
      >
        {p.initials}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-medium leading-tight">
          <Highlight text={p.name} query={query} />
        </span>
        <span className="mt-px flex min-w-0 items-center gap-1 text-[10.5px] leading-tight text-muted-foreground">
          <span className="truncate" title={p.position ?? undefined}>
            {p.role}
          </span>
          {p.grade && (
            <span
              className="shrink-0 rounded border px-1 font-mono text-[9.5px] leading-[14px]"
              title={`${p.grade} разряд`}
            >
              {p.grade}р
            </span>
          )}
          {p.is_trainee && (
            <span
              className={cn(
                "shrink-0 rounded border px-1 text-[9.5px] leading-[14px]",
                TRAINEE_CHIP
              )}
            >
              стажёр
            </span>
          )}
        </span>
      </span>
      <span
        className={cn("shrink-0", SHIFT[p.shift].text)}
        title={SHIFT[p.shift].hint}
      >
        <Shift className="size-3.5" />
        <span className="sr-only">{SHIFT[p.shift].label}</span>
      </span>
    </li>
  );
}

interface Section {
  group: GroupKey;
  people: Person[];
  shifts: { shift: ShiftKey; people: Person[] }[];
}

function sectionsOf(people: Person[]): Section[] {
  return GROUP_ORDER.map((g) => {
    const inGroup = people.filter((p) => p.group === g);
    return {
      group: g,
      people: inGroup,
      shifts: SHIFT_ORDER.map((s) => ({
        shift: s,
        people: inGroup.filter((p) => p.shift === s),
      })).filter((b) => b.people.length > 0),
    };
  }).filter((s) => s.people.length > 0);
}

function CompositionBar({ branch }: { branch: Branch }) {
  const total = branch.staff.total;
  const parts = GROUP_ORDER.map((g) => ({
    g,
    n: branch.staff.groups[g],
  })).filter((p) => p.n > 0);
  return (
    <div className="min-w-0">
      <div
        className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={parts
          .map((p) => `${GROUP[p.g].label} ${p.n}`)
          .join(", ")}
      >
        {parts.map((p) => (
          <span
            key={p.g}
            className={cn("h-full", GROUP[p.g].bar)}
            style={{ width: `${(p.n / total) * 100}%` }}
            title={`${GROUP[p.g].label}: ${p.n} — ${GROUP[p.g].hint}`}
          />
        ))}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
        {parts.map((p) => (
          <span
            key={p.g}
            className="inline-flex items-center gap-1 text-[10.5px] text-muted-foreground"
          >
            <span className={cn("size-1.5 rounded-full", GROUP[p.g].dot)} aria-hidden />
            {GROUP[p.g].label}
            <span className="font-medium tabular-nums text-foreground">{p.n}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function ShiftTally({ branch }: { branch: Branch }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
      {SHIFT_ORDER.filter((s) => branch.staff.shifts[s] > 0).map((s) => {
        const Icon = SHIFT[s].icon;
        return (
          <span
            key={s}
            className="inline-flex items-center gap-1 text-[10.5px] text-muted-foreground"
            title={SHIFT[s].hint}
          >
            <Icon className={cn("size-3", SHIFT[s].text)} />
            {SHIFT[s].label}
            <span className="font-medium tabular-nums text-foreground">
              {branch.staff.shifts[s]}
            </span>
          </span>
        );
      })}
    </div>
  );
}

export function BranchCard({
  branch,
  people,
  peopleFiltered,
  query,
}: {
  branch: Branch;
  /** Люди после фильтров экрана — может быть меньше, чем branch.people. */
  people: Person[];
  peopleFiltered: boolean;
  query: string;
}) {
  const [expanded, setExpanded] = React.useState(false);
  // Свёрнутая карточка не «прячет» строки стилями, а не рендерит их: скрытая
  // клипом строка всё равно ловит фокус клавиатурой, и человек уезжает табом
  // в невидимое.
  const shown = expanded ? people : people.slice(0, COLLAPSED);
  const hidden = people.length - shown.length;
  const sections = React.useMemo(() => sectionsOf(shown), [shown]);

  return (
    <article className="flex min-w-0 flex-col rounded-lg border bg-card text-card-foreground shadow-sm transition-colors hover:border-foreground/20">
      <header className="flex min-w-0 items-start gap-2 border-b px-3 py-2">
        <span className="mt-[3px]">
          <BrandMark brand={branch.brand} size={11} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[13.5px] font-semibold leading-tight">
            {branch.name}
          </h3>
          <p className="mt-0.5 truncate text-[10.5px] text-muted-foreground">
            {BRAND[branch.brand].label}
            {branch.address ? (
              <>
                {" · "}
                <MapPin className="mr-0.5 inline size-2.5 -translate-y-px" aria-hidden />
                {branch.address}
              </>
            ) : (
              " · адрес не заведён"
            )}
          </p>
          <p
            className="mt-0.5 flex min-w-0 items-center gap-1 truncate text-[10.5px] text-muted-foreground"
            title="Менеджер филиала из карточки филиала. Это отдельное поле и оно не связано со справочником сотрудников — сигнал «нет менеджера» считается по справочнику."
          >
            <UserRound className="size-2.5 shrink-0" aria-hidden />
            {branch.manager_name ? (
              <span className="truncate text-foreground/80">{branch.manager_name}</span>
            ) : (
              <span className="italic">менеджер филиала не указан</span>
            )}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[19px] font-semibold leading-none tabular-nums">
            {branch.staff.total}
          </div>
          <div className="mt-0.5 text-[9.5px] uppercase tracking-wide text-muted-foreground">
            {peopleWord(branch.staff.total)}
          </div>
        </div>
      </header>

      <div className="flex min-w-0 flex-col gap-2 px-3 py-2">
        <CompositionBar branch={branch} />
        <ShiftTally branch={branch} />

        {branch.signals.length > 0 && (
          <ul className="flex flex-wrap gap-1">
            {branch.signals.map((s) => {
              const meta = SIGNAL[s.key];
              const Icon = meta.icon;
              const label =
                s.key === "no_pin"
                  ? `PIN ${branch.staff.pin_set}/${branch.staff.total}`
                  : s.label;
              return (
                <li key={s.key}>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded border px-1.5 py-px text-[10.5px] font-medium",
                      meta.chip
                    )}
                    title={s.detail}
                  >
                    <Icon className="size-3" aria-hidden />
                    {label}
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        {peopleFiltered && (
          <p className="text-[10.5px] text-muted-foreground">
            Показано {people.length} из {branch.staff.total} — остальных скрыли
            фильтры, состав выше считается по всему филиалу.
          </p>
        )}

        {people.length === 0 ? (
          <p className="rounded border border-dashed px-2 py-3 text-center text-[11px] text-muted-foreground">
            Под фильтр не попал никто из {branch.staff.total}{" "}
            {peopleWord(branch.staff.total)} этого филиала.
          </p>
        ) : (
          <div
            className={cn(
              "min-w-0",
              expanded && people.length > COLLAPSED && "max-h-[420px] overflow-y-auto pr-0.5"
            )}
          >
            {sections.map((sec) => {
              const G = GROUP[sec.group];
              const Icon = G.icon;
              return (
                <section key={sec.group} className="mt-1.5 first:mt-0">
                  <h4 className="flex items-center gap-1.5 border-b pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    <Icon className={cn("size-3", G.text)} />
                    <span className={G.text}>{G.label}</span>
                    <span className="tabular-nums">{sec.people.length}</span>
                  </h4>
                  {sec.shifts.map((block) => {
                    const SIcon = SHIFT[block.shift].icon;
                    return (
                      <div key={block.shift}>
                        {sec.shifts.length > 1 && (
                          <div className="mt-1 flex items-center gap-1 pl-1 text-[9.5px] uppercase tracking-wide text-muted-foreground">
                            <SIcon className={cn("size-2.5", SHIFT[block.shift].text)} />
                            {SHIFT[block.shift].label}
                            <span className="tabular-nums">{block.people.length}</span>
                          </div>
                        )}
                        <ul className="mt-0.5">
                          {block.people.map((p) => (
                            <PersonRow key={p.id} p={p} query={query} />
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </section>
              );
            })}
          </div>
        )}

        <AnimatePresence initial={false}>
          {(hidden > 0 || expanded) && (
            <motion.button
              type="button"
              key="toggle"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15, ease: EASE_OUT }}
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              className="inline-flex w-full items-center justify-center gap-1 rounded border border-dashed py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronDown
                className={cn(
                  "size-3 transition-transform duration-200",
                  expanded && "rotate-180"
                )}
                aria-hidden
              />
              {expanded
                ? "Свернуть состав"
                : `Показать всех — ещё ${hidden}`}
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </article>
  );
}

// Филиал без единой строки в справочнике. Отдельная карточка, а не серый
// вариант обычной: у неё нечего показывать внутри, и вся её работа — назвать
// причину. Пунктирная рамка + текст, цвет ничего не решает.
export function NoDataCard({ branch }: { branch: Branch }) {
  return (
    <article className="flex min-w-0 flex-col rounded-lg border border-dashed bg-muted/30 px-3 py-2">
      <div className="flex min-w-0 items-start gap-2">
        <span className="mt-[3px]">
          <BrandMark brand={branch.brand} size={11} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[12.5px] font-medium leading-tight">
            {branch.name}
          </h3>
          <p className="mt-0.5 truncate text-[10.5px] text-muted-foreground">
            {BRAND[branch.brand].label}
            {branch.address ? ` · ${branch.address}` : ""}
          </p>
        </div>
      </div>
      <p className="mt-1.5 flex items-center gap-1 text-[10.5px] text-muted-foreground">
        <UserRound className="size-2.5 shrink-0" aria-hidden />
        {branch.manager_name ? (
          <span className="truncate">{branch.manager_name}</span>
        ) : (
          <span className="italic">менеджер филиала не указан</span>
        )}
      </p>
    </article>
  );
}
