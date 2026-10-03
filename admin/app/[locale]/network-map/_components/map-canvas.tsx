"use client";

// Карта.
//
// Узлы НЕ являются leaflet-маркерами. Это один SVG-слой поверх карты, который
// сам проецирует координаты через map.latLngToContainerPoint на каждое
// движение карты. Причина простая: L.divIcon пересоздаёт DOM при каждой смене
// режима, а значит между «Штатом» и «Сменами» ничего не может анимироваться —
// узлы просто подменяются. Здесь узел живёт один и тот же от загрузки до
// ухода со страницы, поэтому кольцо действительно перетекает из состава в
// смены, а не мигает.
//
// Плата за это — zoomAnimation: false. Анимированный зум leaflet двигает
// пласты CSS-трансформом, а наш слой не в этих пластах; вместо рассинхрона на
// каждый зум выбран мгновенный зум. Для рабочей панели это честный размен.
//
// Подложка. Тайлы CARTO в регионе временами недоступны, и экран обязан это
// пережить: контейнер тёмный сам по себе, узлы рисуются поверх независимо от
// тайлов, масштабная линейка остаётся — карта без подложки теряет улицы, но не
// теряет ни взаимного расположения филиалов, ни расстояний.

import * as React from "react";
import { MapContainer, ScaleControl, TileLayer, useMap } from "react-leaflet";
import { motion } from "framer-motion";
import { Minus, Plus, Maximize2, ImageOff, Locate } from "lucide-react";
import type { Map as LeafletMap } from "leaflet";
import "leaflet/dist/leaflet.css";

import type { Branch } from "./use-network-map";
import { GlyphBody, EASE_OUT } from "./branch-glyph";
import { BRAND, MapMode, RING_R, nodeScale } from "./vocabulary";

const TASHKENT: [number, number] = [41.3, 69.26];
/** Подписи узлов включаются с этого зума — раньше они наезжают друг на друга. */
const LABEL_ZOOM = 11;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
}

/**
 * Плотное ядро сети. 45 филиалов с координатами разбросаны от Нукуса до
 * Ферганы, и подгонка под все сразу превращает Ташкент, где стоит большинство,
 * в одно пятно размером с монету. Стартовый вид — ядро; вся сеть остаётся в
 * одном клике, а счётчик под картой всегда говорит, сколько узлов сейчас за
 * кадром, чтобы вид «по ядру» не выглядел как вся сеть.
 */
function clusterPoints(points: [number, number][]): [number, number][] {
  if (points.length < 4) return points;
  const mlat = median(points.map((p) => p[0]));
  const mlon = median(points.map((p) => p[1]));
  const near = points.filter(
    (p) => Math.abs(p[0] - mlat) < 0.6 && Math.abs(p[1] - mlon) < 0.6
  );
  return near.length >= 3 ? near : points;
}

function FitOnce({ points }: { points: [number, number][] }) {
  const map = useMap();
  const done = React.useRef(false);
  React.useEffect(() => {
    if (done.current || points.length === 0) return;
    done.current = true;
    const core = clusterPoints(points);
    if (core.length === 1) map.setView(core[0], 13);
    else map.fitBounds(core as any, { padding: [48, 48] });
  }, [map, points]);
  return null;
}

interface NodeLayerProps {
  map: LeafletMap | null;
  branches: Branch[];
  mode: MapMode;
  hoveredId: string | null;
  selectedId: string | null;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
  onFitAll: () => void;
}

function NodeLayer({
  map,
  branches,
  mode,
  hoveredId,
  selectedId,
  onHover,
  onSelect,
  onFitAll,
}: NodeLayerProps) {
  const groups = React.useRef(new Map<string, SVGGElement | null>());
  const labels = React.useRef(new Map<string, SVGTextElement | null>());
  const tip = React.useRef<HTMLDivElement | null>(null);
  const offView = React.useRef<HTMLDivElement | null>(null);
  const offViewCount = React.useRef<HTMLSpanElement | null>(null);
  const hoveredRef = React.useRef<string | null>(null);
  hoveredRef.current = hoveredId;
  const selectedRef = React.useRef<string | null>(null);
  selectedRef.current = selectedId;

  const [zoom, setZoom] = React.useState(11);

  // Большие узлы рисуются первыми, мелкие поверх — иначе филиал на два
  // человека полностью скрывается под соседним на тридцать.
  const ordered = React.useMemo(
    () =>
      [...branches].sort(
        (a, z) =>
          nodeScale(mode, z.has_staff_data, z.staff.total) -
          nodeScale(mode, a.has_staff_data, a.staff.total)
      ),
    [branches, mode]
  );

  // Позиции обновляются напрямую через setAttribute, без ре-рендера React:
  // во время перетаскивания карты leaflet шлёт move каждый кадр, и гонять на
  // этом React-дерево из 45 анимированных узлов незачем.
  const place = React.useCallback(() => {
    if (!map) return;
    const size = map.getSize();
    let out = 0;
    for (const b of branches) {
      const el = groups.current.get(b.id);
      if (b.lat == null || b.lon == null) continue;
      const p = map.latLngToContainerPoint([b.lat, b.lon]);
      if (p.x < 0 || p.y < 0 || p.x > size.x || p.y > size.y) out++;
      if (el) el.setAttribute("transform", `translate(${p.x.toFixed(1)},${p.y.toFixed(1)})`);
    }
    // Развод подписей. Филиалы стоят плотно, и без этого прохода на зуме
    // получается каша из наложенных имён — хуже, чем совсем без подписей.
    // Приоритет: тот, на который смотрят, затем более крупные филиалы;
    // подпись, чей прямоугольник пересёк уже размещённую, просто не рисуется.
    const placed: number[][] = [];
    const prio = [...branches].sort((a, z) => {
      const aa = a.id === hoveredRef.current || a.id === selectedRef.current ? 1 : 0;
      const zz = z.id === hoveredRef.current || z.id === selectedRef.current ? 1 : 0;
      return zz - aa || z.staff.total - a.staff.total;
    });
    for (const b of prio) {
      const el = labels.current.get(b.id);
      if (!el || b.lat == null || b.lon == null) continue;
      const p = map.latLngToContainerPoint([b.lat, b.lon]);
      const dx = Number(el.getAttribute("x") ?? 0);
      let w = 0;
      try {
        w = el.getComputedTextLength();
      } catch {
        w = b.name.length * 5.6;
      }
      const box = [p.x + dx - 2, p.y - 8, p.x + dx + w + 2, p.y + 6];
      const forced =
        b.id === hoveredRef.current || b.id === selectedRef.current;
      const clash =
        !forced &&
        placed.some(
          (r) => !(box[2] < r[0] || box[0] > r[2] || box[3] < r[1] || box[1] > r[3])
        );
      el.style.display = clash ? "none" : "";
      if (!clash) placed.push(box);
    }
    if (offView.current && offViewCount.current) {
      offViewCount.current.textContent = String(out);
      offView.current.style.display = out > 0 ? "flex" : "none";
    }
    const hid = hoveredRef.current;
    if (tip.current && hid) {
      const b = branches.find((x) => x.id === hid);
      if (b && b.lat != null && b.lon != null) {
        const p = map.latLngToContainerPoint([b.lat, b.lon]);
        tip.current.style.transform = `translate(${p.x}px, ${p.y}px)`;
      }
    }
  }, [map, branches]);

  React.useLayoutEffect(() => {
    place();
  }, [place, mode, hoveredId, selectedId, zoom]);

  React.useEffect(() => {
    if (!map) return;
    const evs = ["move", "zoom", "zoomend", "moveend", "resize", "viewreset"];
    evs.forEach((e) => map.on(e as any, place));
    const onZoom = () => setZoom(map.getZoom());
    map.on("zoomend", onZoom);
    onZoom();
    return () => {
      evs.forEach((e) => map.off(e as any, place));
      map.off("zoomend", onZoom);
    };
  }, [map, place]);

  const hovered = hoveredId ? branches.find((b) => b.id === hoveredId) : null;
  const anyActive = !!(hoveredId || selectedId);

  return (
    <>
      <svg
        className="pointer-events-none absolute inset-0 z-[500] h-full w-full"
        role="presentation"
      >
        {ordered.map((b, i) => {
          const scale = nodeScale(mode, b.has_staff_data, b.staff.total);
          const active = b.id === hoveredId || b.id === selectedId;
          const hit = Math.max(RING_R * scale + 6, 13);
          // Подписи всех 45 узлов на обзорном зуме превращаются в кашу, поэтому
          // они появляются, когда человек приблизил карту, и всегда — у того
          // узла, на который он смотрит.
          const showLabel = active || zoom >= LABEL_ZOOM;
          return (
            <g
              key={b.id}
              ref={(el) => {
                groups.current.set(b.id, el);
              }}
            >
              {/* Волна появления — ровно один раз, на загрузке. Смена режима
                  ничего не пересоздаёт и волну не повторяет. */}
              <motion.g
                initial={{ opacity: 0, scale: 0.55 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{
                  duration: 0.3,
                  ease: EASE_OUT,
                  delay: Math.min(i * 0.008, 0.28),
                }}
              >
                <GlyphBody
                  branch={b}
                  mode={mode}
                  active={active}
                  dim={anyActive && !active}
                />
              </motion.g>
              {showLabel && (
                <text
                  ref={(el) => {
                    labels.current.set(b.id, el);
                  }}
                  x={RING_R * scale + 7}
                  y={4}
                  fontSize={11}
                  fontWeight={600}
                  fill={active ? "#f8fafc" : "#cbd5e1"}
                  stroke="#050912"
                  strokeWidth={3}
                  paintOrder="stroke"
                  opacity={anyActive && !active ? 0.2 : active ? 1 : 0.82}
                  style={{ userSelect: "none" }}
                >
                  {b.name}
                </text>
              )}
              <circle
                r={hit}
                fill="transparent"
                className="pointer-events-auto cursor-pointer"
                onMouseEnter={() => onHover(b.id)}
                onMouseLeave={() => onHover(null)}
                onClick={() => onSelect(b.id)}
              />
            </g>
          );
        })}
      </svg>

      <div
        ref={tip}
        className="pointer-events-none absolute left-0 top-0 z-[600]"
        style={{ display: hovered ? "block" : "none" }}
      >
        {hovered && (
          <div className="-translate-x-1/2 -translate-y-full pb-6">
            <div className="min-w-[150px] max-w-[240px] rounded-md border border-slate-700 bg-slate-950/95 px-2.5 py-2 shadow-xl">
              <div className="flex items-center gap-1.5">
                <span
                  className="size-2 shrink-0 rounded-[2px]"
                  style={{ background: (BRAND[hovered.brand] ?? BRAND.other).color }}
                  aria-hidden
                />
                <span className="truncate text-[12.5px] font-semibold text-slate-100">
                  {hovered.name}
                </span>
              </div>
              <div className="mt-1 text-[11px] leading-snug text-slate-400">
                {(BRAND[hovered.brand] ?? BRAND.other).label}
                {" · "}
                {hovered.has_staff_data
                  ? `${hovered.staff.total} чел.`
                  : "состав не заведён"}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Сколько узлов сейчас за кадром. Стартовый вид намеренно показывает
          ядро сети, и умолчать об остальных значило бы выдать часть за целое. */}
      <div
        ref={offView}
        className="absolute bottom-2 right-2 z-[600] hidden items-center gap-2 rounded-md border border-slate-700 bg-slate-950/90 px-2 py-1 text-[11px] text-slate-300"
      >
        <span>
          <span ref={offViewCount} className="font-semibold text-slate-100" />{" "}
          филиалов вне вида
        </span>
        <button
          type="button"
          onClick={onFitAll}
          className="rounded border border-slate-600 px-1.5 py-px text-[10.5px] text-slate-200 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
        >
          показать всю сеть
        </button>
      </div>
    </>
  );
}

export interface MapCanvasProps {
  branches: Branch[];
  mode: MapMode;
  hoveredId: string | null;
  selectedId: string | null;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
}

export default function MapCanvas({
  branches,
  mode,
  hoveredId,
  selectedId,
  onHover,
  onSelect,
}: MapCanvasProps) {
  const [map, setMap] = React.useState<LeafletMap | null>(null);
  const [tiles, setTiles] = React.useState<"pending" | "ok" | "failed">(
    "pending"
  );
  const errors = React.useRef(0);

  const onMap = React.useMemo(
    () => branches.filter((b) => b.has_coords && b.lat != null && b.lon != null),
    [branches]
  );
  const points = React.useMemo(
    () => onMap.map((b) => [b.lat as number, b.lon as number] as [number, number]),
    [onMap]
  );

  // Подложка может не ответить вовсе (не только отдать 404 на плитку), поэтому
  // помимо счётчика ошибок есть таймаут: молча ждать тайлы дольше семи секунд
  // и не сказать об этом — то же самое, что соврать.
  React.useEffect(() => {
    const t = setTimeout(
      () => setTiles((s) => (s === "pending" ? "failed" : s)),
      7000
    );
    return () => clearTimeout(t);
  }, []);

  const fitAll = React.useCallback(() => {
    if (!map || points.length === 0) return;
    map.fitBounds(points as any, { padding: [48, 48] });
  }, [map, points]);

  const fitCore = React.useCallback(() => {
    if (!map || points.length === 0) return;
    const core = clusterPoints(points);
    if (core.length === 1) map.setView(core[0], 13);
    else map.fitBounds(core as any, { padding: [48, 48] });
  }, [map, points]);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-lg border border-slate-800 bg-[#070c16]">
      <MapContainer
        ref={setMap as any}
        center={TASHKENT}
        zoom={11}
        zoomControl={false}
        attributionControl={false}
        zoomAnimation={false}
        fadeAnimation={false}
        markerZoomAnimation={false}
        scrollWheelZoom
        className="absolute inset-0 h-full w-full"
        style={{ background: "#070c16" }}
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          subdomains="abcd"
          maxZoom={19}
          eventHandlers={{
            tileload: () => setTiles("ok"),
            tileerror: () => {
              errors.current += 1;
              if (errors.current >= 4) setTiles((s) => (s === "ok" ? s : "failed"));
            },
          }}
        />
        <ScaleControl position="bottomleft" imperial={false} />
        <FitOnce points={points} />
      </MapContainer>

      <NodeLayer
        map={map}
        branches={onMap}
        mode={mode}
        hoveredId={hoveredId}
        selectedId={selectedId}
        onHover={onHover}
        onSelect={onSelect}
        onFitAll={fitAll}
      />

      <div className="absolute right-2 top-2 z-[600] flex flex-col gap-1">
        <MapButton label="Приблизить" onClick={() => map?.zoomIn()}>
          <Plus className="size-3.5" />
        </MapButton>
        <MapButton label="Отдалить" onClick={() => map?.zoomOut()}>
          <Minus className="size-3.5" />
        </MapButton>
        <MapButton label="Ядро сети (Ташкент)" onClick={fitCore}>
          <Locate className="size-3.5" />
        </MapButton>
        <MapButton label="Вся сеть" onClick={fitAll}>
          <Maximize2 className="size-3.5" />
        </MapButton>
      </div>

      {tiles === "failed" && (
        <div className="absolute left-2 top-2 z-[600] flex max-w-[300px] items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-[11px] leading-snug text-amber-200">
          <ImageOff className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>
            Подложка карты не загрузилась. Филиалы, их расположение друг
            относительно друга и масштабная линейка внизу остаются верными —
            пропали только улицы.
          </span>
        </div>
      )}

      <div className="pointer-events-none absolute bottom-1 left-1/2 z-[600] -translate-x-1/2 text-[9px] text-slate-600">
        © OpenStreetMap · © CARTO
      </div>
    </div>
  );
}

function MapButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="flex size-7 items-center justify-center rounded border border-slate-700 bg-slate-900/90 text-slate-300 transition-colors hover:bg-slate-800 hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-1 focus-visible:ring-offset-slate-950"
    >
      {children}
    </button>
  );
}
