"use client";

// Карта сети — экран для руководства: где сколько людей и какого состава.
//
// Экран тёмный сам по себе, а не по теме админки: подложка карты тёмная всегда,
// и светлый интерфейс вокруг неё читался бы как две разные страницы, склеенные
// скотчем. Тональности взяты те же, что в «Паспорте стажёра» (сланец для фона,
// янтарь для «требует внимания», изумруд для «в порядке»), поэтому раздел
// узнаётся как часть той же системы.
//
// Три вещи, которые экран обязан не соврать:
//   1. филиал без строк в справочнике ≠ филиал без людей — у них разный глиф,
//      разная группа в списке и отдельная метрика в сводке;
//   2. 27 филиалов без координат не исчезают — под картой их полоса;
//   3. упавшая подложка не делает экран пустым — узлы живут отдельно от тайлов.

import * as React from "react";
import dynamic from "next/dynamic";
import { Loader2, Network, ShieldAlert } from "lucide-react";

import type { Branch } from "./_components/use-network-map";
import { useNetworkMap } from "./_components/use-network-map";
import { Rail } from "./_components/branch-rail";
import {
  Legend,
  ModeSwitch,
  OffMapStrip,
  SummaryStrip,
} from "./_components/summary";
import type { MapMode } from "./_components/vocabulary";

// leaflet трогает window на импорте — только на клиенте и только после
// монтирования.
const MapCanvas = dynamic(() => import("./_components/map-canvas"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center rounded-lg border border-slate-800 bg-[#070c16] text-[12px] text-slate-500">
      <Loader2 className="mr-2 size-4 animate-spin" /> карта загружается
    </div>
  ),
});

export default function NetworkMapPage() {
  const q = useNetworkMap();
  const [mode, setMode] = React.useState<MapMode>("staff");
  const [hoveredId, setHoveredId] = React.useState<string | null>(null);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  const branches: Branch[] = q.data?.branches ?? [];
  const network = q.data?.network ?? null;
  const offMap = React.useMemo(
    () => branches.filter((b) => !b.has_coords),
    [branches]
  );

  const denied = q.isError && q.error?.status === 403;

  return (
    // overflow-x-clip — та же страховка, что на матрице паспорта: SidebarInset
    // выше по дереву это flex-1 без min-w-0, и любой широкий потомок (полоса
    // «не на карте» со своим горизонтальным скроллом) иначе распёр бы страницу.
    <div className="w-full min-w-0 max-w-full overflow-x-clip pb-8">
      <div className="mb-3">
        <h1 className="inline-flex items-center gap-2 text-lg font-semibold tracking-tight">
          <Network className="size-4 text-muted-foreground" aria-hidden />
          Карта сети
        </h1>
        <p className="text-[12px] text-muted-foreground">
          Филиалы обоих брендов, состав команд и пробелы в справочнике — из
          одного запроса, без пересчёта на клиенте.
        </p>
      </div>

      <div className="rounded-xl border border-slate-800 bg-[#080d18] p-2.5 text-slate-200">
        {denied ? (
          <div className="flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/5 px-3 py-2.5 text-[12.5px] leading-snug text-red-200">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              Карта сети отдаётся по праву{" "}
              <code className="font-mono text-[11px]">employees.list</code>, а у
              вашей роли его нет. Это не сбой: страница загрузилась, отказал
              именно доступ. Обратитесь к администратору office-админки.
            </span>
          </div>
        ) : q.isError ? (
          <div className="flex items-start justify-between gap-3 rounded-md border border-red-500/40 bg-red-500/5 px-3 py-2.5 text-[12.5px] leading-snug text-red-200">
            <span>Не удалось загрузить карту сети: {q.error?.message}</span>
            <button
              type="button"
              onClick={() => q.refetch()}
              className="shrink-0 rounded border border-red-400/50 px-2 py-0.5 text-[11px] text-red-100 hover:bg-red-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
            >
              повторить
            </button>
          </div>
        ) : q.isLoading ? (
          <div className="flex h-[380px] items-center justify-center text-[12px] text-slate-500">
            <Loader2 className="mr-2 size-4 animate-spin" /> собираем сеть
          </div>
        ) : !network || branches.length === 0 ? (
          <div className="rounded-md border border-slate-800 bg-slate-900/40 px-4 py-8 text-center">
            <p className="text-[13px] font-medium text-slate-200">
              В вашем скоупе нет филиалов
            </p>
            <p className="mx-auto mt-1 max-w-md text-[11.5px] leading-snug text-slate-400">
              Карта показывает только те филиалы, которые назначены вашей роли.
              Роль без назначенных филиалов и без права головного офиса видит
              пустую сеть — это не ошибка загрузки. Назначает филиалы
              администратор office-админки.
            </p>
          </div>
        ) : (
          // Сетка, а не space-y: колонка minmax(0,1fr) даёт каждому блоку
          // нулевой вклад в min-content, поэтому ни один будущий широкий
          // потомок не сможет снова распереть страницу вбок.
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2.5">
            <SummaryStrip n={network} branches={branches} />
            <ModeSwitch mode={mode} onChange={setMode} />

            <div className="grid min-w-0 gap-2.5 lg:grid-cols-[minmax(0,1fr)_330px]">
              <div className="h-[clamp(380px,56vh,640px)] min-w-0">
                <MapCanvas
                  branches={branches}
                  mode={mode}
                  hoveredId={hoveredId}
                  selectedId={selectedId}
                  onHover={setHoveredId}
                  onSelect={(id) =>
                    setSelectedId((cur) => (cur === id ? null : id))
                  }
                />
              </div>
              <div className="h-[clamp(380px,56vh,640px)] min-w-0">
                <Rail
                  branches={branches}
                  mode={mode}
                  hoveredId={hoveredId}
                  selectedId={selectedId}
                  onHover={setHoveredId}
                  onSelect={(id) =>
                    setSelectedId((cur) => (cur === id ? null : id))
                  }
                  onClear={() => setSelectedId(null)}
                />
              </div>
            </div>

            <OffMapStrip
              branches={offMap}
              mode={mode}
              hoveredId={hoveredId}
              selectedId={selectedId}
              onHover={setHoveredId}
              onSelect={(id) =>
                setSelectedId((cur) => (cur === id ? null : id))
              }
            />

            <Legend mode={mode} />
          </div>
        )}
      </div>
    </div>
  );
}
