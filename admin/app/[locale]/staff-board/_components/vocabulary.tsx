"use client";

// Словарь экрана: цвета, подписи, иконки, порядок.
//
// Один файл на секцию — то же правило, что у passport/matrix/_components и у
// network-map/_components: экран владеет своим словарём, чтобы рефакторинг
// соседнего экрана не перекрашивал этот. Тональности взяты оттуда же (изумруд
// кухня, небесный фронт, фиолетовый управление, янтарь «требует внимания»),
// поэтому раздел читается как часть одной системы. В отличие от карты сети
// экран живёт в обычной теме админки, значит у каждого цвета есть светлый и
// тёмный вариант.
//
// ЦВЕТ НИКОГДА НЕ ЕДИНСТВЕННЫЙ НОСИТЕЛЬ СМЫСЛА:
//   бренд      — цвет + ФОРМА метки (круг Les Ailes / шестиугольник Chopar) + подпись;
//   состав     — названия групп и числа словами, без цвета вообще;
//   смена      — заголовок группы людей, а не иконка в каждой строке;
//   сигнал     — иконка + текст, цвет только усиливает;
//   нет данных — пунктирная рамка + отдельная группа в конце + текст причины.

import * as React from "react";
import {
  ChefHat,
  CircleQuestionMark,
  KeyRound,
  Moon,
  ShieldUser,
  Sun,
  UserRound,
  UtensilsCrossed,
  Users,
} from "lucide-react";

import type { Brand, GroupKey, ShiftKey, SignalKey } from "./use-staff-board";

// --------------------------------------------------------------------------
// бренды
//
// #fc004a — малиновый Les Ailes, тот же, что в мини-аппе паспорта стажёра и на
// карте сети. Chopar — тёплый янтарь. Сверх цвета у брендов разная форма метки,
// поэтому различие переживает любую форму цветовой слепоты.
// --------------------------------------------------------------------------
export const BRAND: Record<
  Brand,
  { label: string; color: string; shape: "circle" | "hex" }
> = {
  les: { label: "Les Ailes", color: "#fc004a", shape: "circle" },
  chopar: { label: "ChoparPizza", color: "#ffb02e", shape: "hex" },
  other: { label: "Прочее", color: "#94a3b8", shape: "circle" },
};

/** Правильный шестиугольник вершиной вверх, вписанный в радиус r. */
function hexPath(r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    pts.push(`${(r * Math.cos(a)).toFixed(2)},${(r * Math.sin(a)).toFixed(2)}`);
  }
  return `M${pts.join("L")}Z`;
}

export function BrandMark({
  brand,
  size = 11,
}: {
  brand: Brand;
  size?: number;
}) {
  const b = BRAND[brand];
  const r = size / 2;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`${-r} ${-r} ${size} ${size}`}
      className="shrink-0"
      role="img"
      aria-label={b.label}
    >
      {b.shape === "circle" ? (
        <circle r={r * 0.92} fill={b.color} />
      ) : (
        <path d={hexPath(r * 0.98)} fill={b.color} />
      )}
    </svg>
  );
}

// --------------------------------------------------------------------------
// группы должностей
// --------------------------------------------------------------------------
export const GROUP_ORDER: GroupKey[] = [
  "management",
  "kitchen",
  "front",
  "other",
];

export const GROUP: Record<
  GroupKey,
  {
    label: string;
    short: string;
    hint: string;
    icon: React.ComponentType<{ className?: string }>;
    bar: string;
    dot: string;
    text: string;
  }
> = {
  management: {
    label: "Управление",
    short: "Упр",
    hint: "менеджер, стажёр-менеджер",
    icon: ShieldUser,
    bar: "bg-violet-500 dark:bg-violet-400",
    dot: "bg-violet-500 dark:bg-violet-400",
    text: "text-violet-700 dark:text-violet-300",
  },
  kitchen: {
    label: "Кухня",
    short: "Кух",
    hint: "повар, старший повар, универсал, работник кухни, салатчица, мойка",
    icon: ChefHat,
    bar: "bg-emerald-500 dark:bg-emerald-400",
    dot: "bg-emerald-500 dark:bg-emerald-400",
    text: "text-emerald-700 dark:text-emerald-300",
  },
  front: {
    label: "Фронт",
    short: "Фронт",
    hint: "кассир, работник зала, раздача",
    icon: UtensilsCrossed,
    bar: "bg-sky-500 dark:bg-sky-400",
    dot: "bg-sky-500 dark:bg-sky-400",
    text: "text-sky-700 dark:text-sky-300",
  },
  other: {
    label: "Прочее",
    short: "Проч",
    hint: "охрана, няня, всё, что не разобралось по должности",
    icon: Users,
    bar: "bg-slate-400 dark:bg-slate-500",
    dot: "bg-slate-400 dark:bg-slate-500",
    text: "text-slate-600 dark:text-slate-300",
  },
};

// --------------------------------------------------------------------------
// смены
//
// Различие держится на иконке и подписи, цвет — третьим каналом.
// --------------------------------------------------------------------------
export const SHIFT_ORDER: ShiftKey[] = ["day", "night", "unknown"];

export const SHIFT: Record<
  ShiftKey,
  {
    label: string;
    hint: string;
    icon: React.ComponentType<{ className?: string }>;
    text: string;
  }
> = {
  day: {
    label: "День",
    hint: "в должности явно указана дневная смена",
    icon: Sun,
    text: "text-amber-600 dark:text-amber-400",
  },
  night: {
    label: "Ночь",
    hint: "в должности явно указана ночная смена",
    icon: Moon,
    text: "text-indigo-600 dark:text-indigo-300",
  },
  unknown: {
    label: "Смена не указана",
    hint: "в строке должности смены нет — это пробел справочника, а не третья смена",
    icon: CircleQuestionMark,
    text: "text-muted-foreground",
  },
};

// --------------------------------------------------------------------------
// сигналы
//
// Подписи приходят с бэкенда вместе с числами (label/detail в ответе) — здесь
// только иконка, тональность и короткое имя для фильтра, чтобы кнопка фильтра
// и чип на карточке назывались одинаково.
//
// Тональность одна на все сигналы-проблемы. Три разных оттенка (янтарь,
// индиго, оранжевый) читались как три разных класса беды, которого нет:
// различает сигналы иконка и текст. Акцент, стоящий везде, перестаёт быть
// акцентом, поэтому янтарь остаётся только на проблемах — «PIN не задан»
// это состояние справочника и живёт нейтральным серым.
// --------------------------------------------------------------------------
export const SIGNAL_ORDER: SignalKey[] = [
  "no_manager",
  "no_senior_cook",
  "no_night",
  "trainee_heavy",
];

export const SIGNAL: Record<
  SignalKey,
  {
    filterLabel: string;
    icon: React.ComponentType<{ className?: string }>;
    chip: string;
  }
> = {
  no_manager: {
    filterLabel: "Без менеджера",
    icon: UserRound,
    chip: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200",
  },
  no_senior_cook: {
    filterLabel: "Без старшего повара",
    icon: ChefHat,
    chip: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200",
  },
  no_night: {
    filterLabel: "Без ночной смены",
    icon: Moon,
    chip: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200",
  },
  trainee_heavy: {
    filterLabel: "Стажёров больше трети",
    icon: Users,
    chip: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200",
  },
  no_pin: {
    filterLabel: "PIN не задан",
    icon: KeyRound,
    chip: "border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300",
  },
};


export function pct(n: number, of: number): string {
  if (!of) return "0%";
  return `${Math.round((n / of) * 100)}%`;
}

export function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

export function peopleWord(n: number) {
  return plural(n, "человек", "человека", "человек");
}
