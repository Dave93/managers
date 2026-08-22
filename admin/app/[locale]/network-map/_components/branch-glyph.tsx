"use client";

// Глиф филиала — единственная реализация «как выглядит филиал» на этом экране.
//
// Тот же код рисует узел на карте, чип 20×20 в списке и чип в полосе «не на
// карте». Это не экономия строк: филиал без данных обязан выглядеть одинаково
// во всех трёх местах, иначе полоса «не на карте» начнёт врать ровно про те
// 27 филиалов, ради которых её и завели.
//
// Глиф рисуется в единичной системе вокруг (0,0) и масштабируется группой,
// поэтому один компонент годится и для карты, и для чипа.

import { motion } from "framer-motion";
import * as React from "react";

import type { Branch } from "./use-network-map";
import {
  Arc,
  BRAND,
  CORE_R,
  EXPERIENCED_COLOR,
  GROUP,
  GROUP_ORDER,
  MapMode,
  NO_DATA_COLOR,
  RING_R,
  RING_W,
  SHIFT,
  SHIFT_ORDER,
  TRAINEE_ALERT,
  TRAINEE_COLOR,
  buildArcs,
  hexPath,
  nodeScale,
} from "./vocabulary";

export const EASE_OUT: [number, number, number, number] = [0.16, 1, 0.3, 1];
export const T_MODE = { duration: 0.26, ease: EASE_OUT };

export function traineeShare(b: Branch): number {
  return b.staff.total ? b.staff.trainees / b.staff.total : 0;
}

/** Сегменты кольца для конкретного режима. В режиме «Данные» кольца нет. */
export function arcsFor(b: Branch, mode: MapMode): Arc[] {
  if (!b.has_staff_data || mode === "data" || b.staff.total === 0) return [];
  if (mode === "shifts")
    return buildArcs(
      SHIFT_ORDER.map((k) => ({
        key: k,
        n: b.staff.shifts[k] ?? 0,
        color: SHIFT[k].color,
        label: SHIFT[k].label,
        dotted: k === "unknown",
      }))
    );
  if (mode === "trainees")
    return buildArcs([
      {
        key: "trainees",
        n: b.staff.trainees,
        color: TRAINEE_COLOR,
        label: "Стажёры",
      },
      {
        key: "rest",
        n: b.staff.total - b.staff.trainees,
        color: EXPERIENCED_COLOR,
        label: "Остальные",
      },
    ]);
  return buildArcs(
    GROUP_ORDER.map((k) => ({
      key: k,
      n: b.staff.groups[k] ?? 0,
      color: GROUP[k].color,
      label: GROUP[k].label,
    }))
  );
}

export interface GlyphProps {
  branch: Branch;
  mode: MapMode;
  /** true — узел на карте (анимируется), false — статичный чип в списке. */
  animated?: boolean;
  active?: boolean;
  dim?: boolean;
  /**
   * Принудительный масштаб. Нужен ровно чипам в списке: там размер узла ничего
   * не кодирует (рядом стоит само число), а филиал без данных при штатном
   * масштабе 0.58 съёживался в нечитаемую точку.
   */
  scaleOverride?: number;
}

/**
 * Содержимое глифа без обёртки — вызывающий сам решает, куда его поставить:
 * карта переносит группу в точку проекции, чип ставит её в центр viewBox.
 */
export function GlyphBody({
  branch: b,
  mode,
  animated = true,
  active = false,
  dim = false,
  scaleOverride,
}: GlyphProps) {
  const brand = BRAND[b.brand] ?? BRAND.other;
  const scale =
    scaleOverride ?? nodeScale(mode, b.has_staff_data, b.staff.total);
  const arcs = arcsFor(b, mode);
  const noData = !b.has_staff_data;
  const emptyKnown = b.has_staff_data && b.staff.total === 0;
  const alerting =
    mode === "trainees" &&
    b.has_staff_data &&
    b.staff.total > 0 &&
    traineeShare(b) >= TRAINEE_ALERT;
  // Единственная пульсация на экране, и только в режиме «Данные»: она означает
  // пробел в справочнике, за который кто-то отвечает. Во всех остальных
  // режимах ничего не мигает.
  const pulsing = noData && mode === "data";

  const G: any = animated ? motion.g : "g";
  const C: any = animated ? motion.circle : "circle";
  const P: any = animated ? motion.path : "path";

  const coreFill = noData ? "rgba(8,13,24,0.85)" : brand.color;
  const coreStroke = noData ? brand.color : "rgba(4,8,16,0.75)";
  const coreProps = {
    fill: coreFill,
    stroke: coreStroke,
    strokeWidth: noData ? 1.7 : 1.1,
    strokeDasharray: noData ? "3 2.6" : undefined,
  };

  return (
    <G
      style={{ opacity: dim ? 0.3 : 1 }}
      {...(animated
        ? {
            initial: false,
            animate: {
              scale,
              opacity: dim ? 0.3 : pulsing ? [0.5, 1, 0.5] : 1,
            },
            transition: pulsing
              ? {
                  scale: T_MODE,
                  opacity: { duration: 2.6, repeat: Infinity, ease: "easeInOut" },
                }
              : T_MODE,
          }
        : { transform: `scale(${scale})` })}
    >
      {/* Ореол «стажёров треть и больше» — форма (отдельное внешнее кольцо),
          а не только цвет. */}
      {alerting && (
        <circle
          r={RING_R + 4.6}
          fill="none"
          stroke={TRAINEE_COLOR}
          strokeWidth={1.3}
          opacity={0.9}
        />
      )}

      {/* Состав известен, людей ноль: кольцо есть, но оно пустое и серое.
          Это НЕ то же самое, что пунктирное ядро «данных нет». */}
      {emptyKnown && mode !== "data" && (
        <circle
          r={RING_R}
          fill="none"
          stroke={NO_DATA_COLOR}
          strokeWidth={1.1}
          opacity={0.55}
        />
      )}

      {arcs.map((a) => (
        <C
          key={a.key}
          r={RING_R}
          fill="none"
          stroke={a.color}
          strokeWidth={RING_W}
          strokeLinecap="butt"
          transform="rotate(-90)"
          {...(animated
            ? {
                initial: false,
                animate: { strokeDasharray: a.dash, strokeDashoffset: a.offset },
                transition: T_MODE,
              }
            : { strokeDasharray: a.dash, strokeDashoffset: a.offset })}
        />
      ))}

      {brand.shape === "hex" ? (
        <P d={hexPath(CORE_R)} {...coreProps} />
      ) : (
        <C r={CORE_R} {...coreProps} />
      )}

      {noData && (
        <text
          y={4.6}
          textAnchor="middle"
          fontSize={13}
          fontWeight={700}
          fill={brand.color}
          opacity={0.95}
          style={{ userSelect: "none" }}
        >
          ?
        </text>
      )}

      {active && (
        <circle
          r={RING_R + 7.5}
          fill="none"
          stroke="#f8fafc"
          strokeWidth={1.4}
          opacity={0.85}
        />
      )}
    </G>
  );
}

/** Чип-глиф для списка и полосы «не на карте». */
export function BranchChip({
  branch,
  mode,
  size = 26,
  active = false,
}: {
  branch: Branch;
  mode: MapMode;
  size?: number;
  active?: boolean;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="-21 -21 42 42"
      aria-hidden
      className="shrink-0"
    >
      <GlyphBody
        branch={branch}
        mode={mode}
        animated={false}
        active={active}
        scaleOverride={branch.has_staff_data ? 1 : 0.9}
      />
    </svg>
  );
}
