"use client";

// Словарь экрана: цвета, подписи, режимы и геометрия узла.
//
// Один файл на секцию — то же правило, что у passport/matrix/_components:
// экран владеет своим словарём, чтобы рефакторинг соседнего экрана не
// перекрашивал этот. Всё, что решает «как выглядит филиал», лежит здесь, а не
// размазано по карте, списку и карточке: узел на карте, чип в списке и полоса
// «не на карте» обязаны показывать один и тот же филиал одинаково.
//
// ЦВЕТ НИКОГДА НЕ ЕДИНСТВЕННЫЙ НОСИТЕЛЬ. У каждого различия есть второй канал:
//   бренд        — цвет + ФОРМА ядра (круг Les Ailes / шестиугольник Chopar);
//   состав       — цвет + ПОРЯДОК сегментов кольца (по часовой от 12 часов)
//                  + точные числа в карточке и подсказке;
//   нет данных   — пунктирный полый контур + знак «?» + отдельная группа в
//                  списке + отдельная метрика в сводке;
//   день/ночь    — светлое против тёмного (яркость, а не оттенок);
//   стажёры      — тёплый песочный против глухого сланцевого + доля в тексте.

import type { Brand, GroupKey, ShiftKey } from "./use-network-map";

export type MapMode = "staff" | "shifts" | "trainees" | "data";

// --------------------------------------------------------------------------
// бренды
//
// #fc004a — малиновый Les Ailes, тот же, что в мини-аппе паспорта стажёра.
// Chopar — тёплый янтарь: он не спорит с малиновым на тёмном фоне и остаётся
// различимым при дейтеранопии (у янтаря заметно выше светлота, у малинового
// ниже), а сверх того у брендов разная форма ядра.
// --------------------------------------------------------------------------
export const BRAND: Record<
  Brand,
  { label: string; color: string; shape: "circle" | "hex" }
> = {
  les: { label: "Les Ailes", color: "#fc004a", shape: "circle" },
  chopar: { label: "ChoparPizza", color: "#ffb02e", shape: "hex" },
  other: { label: "Прочее", color: "#94a3b8", shape: "circle" },
};

// --------------------------------------------------------------------------
// состав
// --------------------------------------------------------------------------
export const GROUP_ORDER: GroupKey[] = [
  "kitchen",
  "front",
  "management",
  "other",
];

export const GROUP: Record<
  GroupKey,
  { label: string; short: string; color: string; hint: string }
> = {
  kitchen: {
    label: "Кухня",
    short: "Кух",
    color: "#34d399",
    hint: "повар, старший повар, универсал, работник кухни, салатчица, мойка",
  },
  front: {
    label: "Фронт",
    short: "Фронт",
    color: "#38bdf8",
    hint: "кассир, работник зала, раздача",
  },
  management: {
    label: "Управление",
    short: "Упр",
    color: "#a78bfa",
    hint: "менеджер, стажёр-менеджер",
  },
  other: {
    label: "Прочее",
    short: "Проч",
    color: "#94a3b8",
    hint: "охрана, няня, всё, что не разобралось по должности",
  },
};

// Светлое против тёмного: различие держится на яркости, поэтому переживает
// любую форму цветовой слепоты.
export const SHIFT_ORDER: ShiftKey[] = ["day", "night", "unknown"];
export const SHIFT: Record<
  ShiftKey,
  { label: string; color: string; hint: string }
> = {
  day: {
    label: "День",
    color: "#e8eefc",
    hint: "в должности явно указана дневная смена",
  },
  night: {
    label: "Ночь",
    color: "#7c83ff",
    hint: "в должности явно указана ночная смена",
  },
  unknown: {
    label: "Смена не указана",
    color: "#3b4763",
    hint: "в строке должности смены нет — это пробел справочника, а не третья смена",
  },
};

export const TRAINEE_COLOR = "#ffd166";
export const EXPERIENCED_COLOR = "#3d4b66";
/** Выше этой доли стажёров филиал получает предупреждающий ореол. */
export const TRAINEE_ALERT = 1 / 3;

export const NO_DATA_COLOR = "#64748b";

export const MODES: {
  value: MapMode;
  label: string;
  question: string;
  legend: string;
}[] = [
  {
    value: "staff",
    label: "Штат",
    question: "Где сколько людей и какого состава",
    legend:
      "Размер узла — корень из числа людей (линейный размер раздавил бы карту: разброс от 0 до 36). Кольцо — доли состава по часовой стрелке от 12 часов: кухня, фронт, управление, прочее.",
  },
  {
    value: "shifts",
    label: "Смены",
    question: "Как штат разложен на день и ночь",
    legend:
      "Кольцо — доли смен: светлое это день, тёмно-синее ночь, глухое серое — смена в справочнике не указана. Размер узла прежний, число людей.",
  },
  {
    value: "trainees",
    label: "Стажёры",
    question: "Где много новичков",
    legend:
      "Кольцо — доля стажёров в штате филиала. Тёплый ореол вокруг узла означает, что стажёров треть и больше: такой филиал тянет обучение, а не работает.",
  },
  {
    value: "data",
    label: "Данные",
    question: "Где справочник заполнен, а где нет",
    legend:
      "Размер выключен, чтобы карта читалась только как покрытие: закрашенный узел — состав заведён, пунктирный полый со знаком «?» — по филиалу нет ни одной строки. Пунктирные узлы мигают, потому что это дыра в данных, а не оформление.",
  },
];

// --------------------------------------------------------------------------
// геометрия узла
//
// Единичный глиф рисуется вокруг (0,0): ядро радиусом CORE_R, кольцо радиусом
// RING_R толщиной RING_W. Размер задаётся масштабом группы, поэтому один и тот
// же глиф годится и для карты, и для чипа 20×20 в списке.
// --------------------------------------------------------------------------
export const CORE_R = 9;
export const RING_R = 15;
export const RING_W = 4.2;
export const RING_C = 2 * Math.PI * RING_R;

/**
 * Корень, а не линейная шкала. Медиана штата 5–6 человек, максимум 36: при
 * линейном размере Ташкент превратился бы в одно пятно, а филиалы на 2–3
 * человека исчезли бы совсем.
 */
export function staffScale(total: number): number {
  return Math.max(0.5, (3.4 + 2.05 * Math.sqrt(Math.max(total, 0))) / CORE_R);
}

export const NO_DATA_SCALE = 0.58;
export const DATA_MODE_SCALE = 0.86;

export function nodeScale(
  mode: MapMode,
  hasStaffData: boolean,
  total: number
): number {
  if (mode === "data") return DATA_MODE_SCALE;
  if (!hasStaffData) return NO_DATA_SCALE;
  return staffScale(total);
}

/** Правильный шестиугольник с вершиной вверх, вписанный в радиус r. */
export function hexPath(r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    pts.push(`${(r * Math.cos(a)).toFixed(2)},${(r * Math.sin(a)).toFixed(2)}`);
  }
  return `M${pts.join("L")}Z`;
}

export interface Arc {
  key: string;
  color: string;
  label: string;
  n: number;
  /** длина штриха и смещение вдоль окружности кольца, уже в единицах пути */
  dash: string;
  offset: number;
  dotted?: boolean;
}

/**
 * Сегменты кольца из набора «ключ → количество». Порядок фиксирован и является
 * вторым каналом после цвета: первый сегмент всегда начинается в 12 часах и
 * идёт по часовой стрелке. Между сегментами оставлен зазор — иначе два соседних
 * тёмных сегмента сливаются в один.
 */
export function buildArcs(
  parts: { key: string; n: number; color: string; label: string; dotted?: boolean }[]
): Arc[] {
  const total = parts.reduce((s, p) => s + p.n, 0);
  if (total <= 0) return [];
  const gap = parts.filter((p) => p.n > 0).length > 1 ? 1.6 : 0;
  const out: Arc[] = [];
  let cursor = 0;
  for (const p of parts) {
    if (p.n <= 0) continue;
    const span = (p.n / total) * RING_C;
    const len = Math.max(span - gap, 0.6);
    out.push({
      key: p.key,
      color: p.color,
      label: p.label,
      n: p.n,
      dash: `${len.toFixed(2)} ${(RING_C - len).toFixed(2)}`,
      offset: -cursor,
      dotted: p.dotted,
    });
    cursor += span;
  }
  return out;
}

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
