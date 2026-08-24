"use client";

// Карточка филиала: шапка, сигналы, люди.
//
// Порядок блоков не декоративный. Сначала «что это за филиал и как собрана
// команда», потом «что с ней не так», и только потом фамилии: сигнал должен
// попасться на глаза до того, как человек начнёт читать список из тридцати
// шести строк.
//
// Шапка — ровно две строки. Всё, чего в справочнике нет (адрес, менеджер
// филиала), не показывается вообще: строка «менеджер не указан», повторённая на
// семидесяти двух карточках, — это не информация, а укор, занимающий столько же
// места, сколько данные. Отсутствие менеджера уже сказано сигналом.
//
// Состав назван словами и числами — один носитель вместо трёх (точка, цвет,
// полоса). Смена тоже названа один раз, заголовком группы, а не иконкой в
// каждой строке: в карточке на 36 человек повторённое солнце — фон, а не факт.
//
// Люди сгруппированы по должностным группам, а внутри группы разделены по
// сменам: структура команды читается только так. Плоский список из 36 человек
// не отвечает ни на один вопрос, ради которого сюда пришли.

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown } from "lucide-react";

import { cn } from "@admin/lib/utils";
import type { Branch, GroupKey, Person, ShiftKey } from "./use-staff-board";
import {
  BrandMark,
  GROUP,
  GROUP_ORDER,
  SHIFT,
  SHIFT_ORDER,
  SIGNAL,
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

// Имя — единственное, что набрано цветом текста и весом. Должность, разряд и
// признак стажёра идут одной приглушённой строкой: это уточнения к имени, а не
// равноправные с ним сущности, и плашка вокруг каждого превращала карточку в
// рябь из мелких рамок.
function PersonRow({ p, query }: { p: Person; query: string }) {
  return (
    <li className="min-w-0 rounded px-1 py-[3px] transition-colors hover:bg-muted/60">
      <span className="block truncate text-[12.5px] font-medium leading-tight">
        <Highlight text={p.name} query={query} />
      </span>
      <span
        className="mt-px block truncate text-[10.5px] leading-tight text-muted-foreground"
        title={p.position ?? undefined}
      >
        {p.role}
        {p.grade && <span className="tabular-nums"> · {p.grade} разряд</span>}
        {p.is_trainee && !/стаж/i.test(p.role) && <span> · стажёр</span>}
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

/** «Управление 1 · Кухня 16 · Фронт 18 · Прочее 1» — состав словами и числами.
 *  Ни точек, ни полосы: цветная полоса тех же четырёх цветов тянула на себя
 *  внимание сильнее, чем имена людей, а сама по себе не отвечала ни на один
 *  вопрос, на который не отвечает эта строка. */
function composition(branch: Branch): string | null {
  const parts = GROUP_ORDER.filter((g) => branch.staff.groups[g] > 0);
  if (parts.length < 2) return null;
  return parts
    .map((g) => `${GROUP[g].label} ${branch.staff.groups[g]}`)
    .join(" · ");
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
  const composed = composition(branch);

  return (
    <article className="flex min-w-0 flex-col rounded-lg border bg-card px-3 py-2.5 text-card-foreground shadow-sm transition-colors hover:border-foreground/20">
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="translate-y-px">
          <BrandMark brand={branch.brand} size={9} />
        </span>
        <h3 className="min-w-0 flex-1 truncate text-[13px] font-semibold leading-tight">
          {branch.name}
        </h3>
        <span className="shrink-0 text-[13px] font-semibold leading-tight tabular-nums">
          {branch.staff.total}
        </span>
        <span className="shrink-0 text-[10.5px] leading-tight text-muted-foreground">
          {peopleWord(branch.staff.total)}
        </span>
      </div>
      {composed && (
        <p className="mt-1 truncate text-[10.5px] leading-tight text-muted-foreground">
          {composed}
        </p>
      )}

      {branch.signals.length > 0 && (
        // Сигналы — текст с иконкой, без рамки и без заливки. Янтарь остаётся
        // единственным акцентом экрана и стоит только там, где это проблема;
        // «PIN 0/36» — состояние справочника, а не авария на филиале, и живёт
        // тем же приглушённым серым, что и остальные уточнения.
        <ul className="mt-1.5 flex min-w-0 flex-wrap gap-x-3 gap-y-0.5">
          {branch.signals.map((s) => {
            const meta = SIGNAL[s.key];
            const Icon = meta.icon;
            const warn = s.severity === "warn" && s.key !== "no_pin";
            const label =
              s.key === "no_pin"
                ? `PIN ${branch.staff.pin_set}/${branch.staff.total}`
                : s.label;
            return (
              <li key={s.key}>
                <span
                  className={cn(
                    "inline-flex items-center gap-1 text-[10.5px] leading-tight",
                    warn
                      ? "text-amber-700 dark:text-amber-400"
                      : "text-muted-foreground"
                  )}
                  title={s.detail}
                >
                  <Icon className="size-3 shrink-0" aria-hidden />
                  {label}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {peopleFiltered && (
        <p className="mt-1.5 text-[10.5px] leading-snug text-muted-foreground">
          Показано {people.length} из {branch.staff.total} — остальных скрыли
          фильтры, состав выше считается по всему филиалу.
        </p>
      )}

      {people.length === 0 ? (
        <p className="mt-2 rounded bg-muted/50 px-2 py-3 text-center text-[11px] text-muted-foreground">
          Под фильтр не попал никто из {branch.staff.total}{" "}
          {peopleWord(branch.staff.total)} этого филиала.
        </p>
      ) : (
        <div
          className={cn(
            "mt-1.5 min-w-0",
            expanded &&
              people.length > COLLAPSED &&
              "max-h-[420px] overflow-y-auto pr-0.5"
          )}
        >
          {sections.map((sec) => {
            const G = GROUP[sec.group];
            // Одна смена на группу — она названа прямо в заголовке группы, без
            // отдельной строки: лишний ряд ради одного слова.
            const single = sec.shifts.length === 1 ? sec.shifts[0] : null;
            return (
              <section key={sec.group} className="mt-2.5 first:mt-0">
                <h4 className="flex min-w-0 items-baseline gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <span className="truncate">{G.label}</span>
                  <span className="font-normal tabular-nums">
                    {sec.people.length}
                  </span>
                  {single && (
                    <span className="truncate font-normal text-muted-foreground/70">
                      · {SHIFT[single.shift].label.toLocaleLowerCase("ru-RU")}
                    </span>
                  )}
                </h4>
                {sec.shifts.map((block) => (
                  <div key={block.shift}>
                    {!single && (
                      <div className="mt-1.5 flex items-baseline gap-1.5 text-[9.5px] uppercase tracking-wide text-muted-foreground/70">
                        <span className="truncate">
                          {SHIFT[block.shift].label}
                        </span>
                        <span className="tabular-nums">
                          {block.people.length}
                        </span>
                      </div>
                    )}
                    <ul className="mt-0.5">
                      {block.people.map((p) => (
                        <PersonRow key={p.id} p={p} query={query} />
                      ))}
                    </ul>
                  </div>
                ))}
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
            className="mt-1.5 inline-flex w-full items-center justify-center gap-1 rounded py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronDown
              className={cn(
                "size-3 transition-transform duration-200",
                expanded && "rotate-180"
              )}
              aria-hidden
            />
            {expanded ? "Свернуть состав" : `Показать всех — ещё ${hidden}`}
          </motion.button>
        )}
      </AnimatePresence>
    </article>
  );
}

// Филиал без единой строки в справочнике. Отдельная карточка, а не серый
// вариант обычной: у неё нечего показывать внутри. Пунктирная рамка + своя
// группа в конце экрана, цвет ничего не решает. Причина названа один раз в
// заголовке группы, а не на каждой из тридцати восьми карточек.
export function NoDataCard({ branch }: { branch: Branch }) {
  return (
    <article className="flex min-w-0 items-baseline gap-2 px-1 py-1">
      <span className="translate-y-px">
        <BrandMark brand={branch.brand} size={9} />
      </span>
      <h3 className="min-w-0 flex-1 truncate text-[12px] leading-tight text-foreground/80">
        {branch.name}
      </h3>
    </article>
  );
}
