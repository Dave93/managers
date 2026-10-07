"use client";

// Заявки офиса: «что сейчас происходит».
//
// Сверху тонкая полоса счётчиков, под ней фильтры, потом таблица. Счётчики
// берутся из того же GET /tickets с limit=1 и своим фильтром по статусу: есть
// поле total, а отдельный эндпоинт статистики ради четырёх чисел не нужен.
// Счётчики не зависят от фильтров ниже, они про всю очередь, а не про выборку.
//
// Дедлайнов в системе нет сознательно. Их заменяет колонка «Висит»: сколько
// заявка стоит в текущем статусе, и всё старше суток подсвечено.
//
// Состояние фильтров лежит в URL (nuqs), чтобы ссылку на выборку можно было
// отправить коллеге и чтобы обновление страницы её не теряло.

import { useEffect, useMemo, useState } from "react";
import {
  parseAsArrayOf,
  parseAsBoolean,
  parseAsString,
  parseAsStringEnum,
  useQueryState,
} from "nuqs";
import { ChevronDown } from "lucide-react";

import { Button } from "@components/ui/buttonOrigin";
import { Label } from "@components/ui/label";
import { Skeleton } from "@components/ui/skeleton";
import { Switch } from "@components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@components/ui/select";
import { cn } from "@admin/lib/utils";
import type { TicketListQuery, TicketStatus } from "@admin/lib/tickets-api";
import { STATUS_ORDER, StatusBadge, statusLabel } from "@admin/components/tickets/status";
import {
  useTicketList,
  useTicketTerminals,
  useTicketTypes,
} from "@admin/lib/use-tickets";

import { buildColumns } from "./columns";
import { DataTable } from "./data-table";

type Filter = NonNullable<TicketListQuery["filters"]>[number];

const ALL = "__all__";
const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// счётчики
// ---------------------------------------------------------------------------

// «Закрыто за 7 дней» считается от границы, округлённой до часа: граница
// входит в ключ запроса, и с каждой миллисекундой она бы заводила новый запрос.
function useClosedSince(): string {
  const compute = () => {
    const hour = 3_600_000;
    return new Date(Math.floor((Date.now() - 7 * DAY_MS) / hour) * hour).toISOString();
  };
  const [since, setSince] = useState(compute);
  useEffect(() => {
    const id = setInterval(() => setSince(compute()), 10 * 60_000);
    return () => clearInterval(id);
  }, []);
  return since;
}

function Counter({
  label,
  filters,
  active,
  onSelect,
}: {
  label: string;
  filters: Filter[];
  active?: boolean;
  onSelect?: () => void;
}) {
  const { data, isPending, isError, error } = useTicketList({ limit: 1, offset: 0, filters });

  // Загрузка, число и «нет данных» различимы: на отказе счётчик не пульсирует
  // вечно, а показывает прочерк с причиной в подсказке.
  const value = isPending ? (
    <Skeleton className="my-1 h-5 w-9" />
  ) : isError ? (
    <span
      className="text-xl font-semibold text-muted-foreground"
      title={(error as Error)?.message || "Не удалось получить число"}
    >
      —
    </span>
  ) : (
    <span className="text-xl font-semibold tabular-nums">{data?.total ?? 0}</span>
  );

  const body = (
    <>
      <span className="flex h-7 items-center">{value}</span>
      <span className="text-[12px] leading-tight text-muted-foreground">{label}</span>
    </>
  );
  const cell = "flex flex-col items-start gap-0.5 px-4 py-3 text-left";

  return onSelect ? (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={cn(
        cell,
        "outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/60",
        active && "bg-muted/60"
      )}
    >
      {body}
    </button>
  ) : (
    <div className={cell}>{body}</div>
  );
}

// ---------------------------------------------------------------------------
// мультивыбор статуса
// ---------------------------------------------------------------------------

function StatusMultiSelect({
  value,
  onChange,
  disabled,
}: {
  value: TicketStatus[];
  onChange: (next: TicketStatus[]) => void;
  disabled?: boolean;
}) {
  const label =
    value.length === 0
      ? "Все статусы"
      : value.length === 1
        ? statusLabel(value[0])
        : `${statusLabel(value[0])} +${value.length - 1}`;
  const toggle = (s: TicketStatus) =>
    onChange(
      value.includes(s)
        ? value.filter((x) => x !== s)
        : STATUS_ORDER.filter((x) => x === s || value.includes(x))
    );

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          disabled={disabled}
          className="h-8 w-[170px] justify-between px-3 text-[13px] font-normal"
        >
          <span className="truncate">{label}</span>
          <ChevronDown className="size-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[210px] p-1.5">
        {STATUS_ORDER.map((s) => (
          <label
            key={s}
            className="flex cursor-pointer items-center gap-2.5 rounded px-2 py-1.5 hover:bg-muted"
          >
            <input
              type="checkbox"
              className="size-3.5 accent-primary"
              checked={value.includes(s)}
              onChange={() => toggle(s)}
            />
            <StatusBadge status={s} />
          </label>
        ))}
        {value.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="mt-1 h-7 w-full justify-start px-2 text-[12px] text-muted-foreground"
            onClick={() => onChange([])}
          >
            Сбросить статус
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

function FilterLabel({ children }: { children: React.ReactNode }) {
  return (
    <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
      {children}
    </Label>
  );
}

// ---------------------------------------------------------------------------
// страница
// ---------------------------------------------------------------------------

export default function TicketsPage() {
  const [statuses, setStatuses] = useQueryState(
    "status",
    parseAsArrayOf(parseAsStringEnum<TicketStatus>(STATUS_ORDER)).withDefault([])
  );
  const [typeId, setTypeId] = useQueryState("type", parseAsString.withDefault(""));
  const [terminalId, setTerminalId] = useQueryState("terminal", parseAsString.withDefault(""));
  const [priority, setPriority] = useQueryState(
    "priority",
    parseAsStringEnum(["normal", "urgent"]).withDefault("normal" as "normal" | "urgent")
  );
  const [priorityOn, setPriorityOn] = useQueryState("urgent", parseAsBoolean.withDefault(false));
  const [awaiting, setAwaiting] = useQueryState("awaiting", parseAsBoolean.withDefault(false));

  const types = useTicketTypes();
  const terminals = useTicketTerminals();
  const closedSince = useClosedSince();

  // «Только непринятые» = сданные исполнителем и ждущие приёмки офисом
  // (status = done, дальше их принимает tickets.close). Включённый тумблер
  // главнее выбора статусов, поэтому мультивыбор при нём выключен.
  const filters = useMemo<Filter[]>(() => {
    const f: Filter[] = [];
    if (awaiting) f.push({ field: "status", operator: "eq", value: "done" });
    else if (statuses.length) f.push({ field: "status", operator: "in", value: statuses });
    if (typeId) f.push({ field: "type_id", operator: "eq", value: typeId });
    if (terminalId) f.push({ field: "terminal_id", operator: "eq", value: terminalId });
    if (priorityOn) f.push({ field: "priority", operator: "eq", value: priority });
    return f;
  }, [awaiting, statuses, typeId, terminalId, priorityOn, priority]);

  const hasFilters = filters.length > 0;
  const resetFilters = () => {
    setStatuses(null);
    setTypeId(null);
    setTerminalId(null);
    setPriority(null);
    setPriorityOn(null);
    setAwaiting(null);
  };

  // Карточка заявки (TicketSheet) появится в Task 4; до неё клик по строке
  // ничего не открывает, и страница от этого не ломается.
  const onOpen: (id: string) => void = () => undefined;

  const columns = useMemo(
    () => buildColumns({ onOpen, types: types.data }),
    // onOpen стабильна по смыслу (заглушка), пересборка нужна только типам.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [types.data]
  );

  const only = (s: TicketStatus) => () => {
    setAwaiting(null);
    setStatuses([s]);
  };
  const isOnly = (s: TicketStatus) => !awaiting && statuses.length === 1 && statuses[0] === s;

  return (
    <div className="pb-10">
      <div className="mb-4">
        <h1 className="text-lg font-semibold tracking-tight">Заявки</h1>
        <p className="text-[12px] text-muted-foreground">
          Что сейчас происходит: очередь по статусам и список заявок всех филиалов.
        </p>
      </div>

      {/* ------------------------------ счётчики ------------------------------ */}
      <div className="mb-4 grid grid-cols-2 divide-x divide-y overflow-hidden rounded-lg border bg-card sm:grid-cols-4 sm:divide-y-0">
        <Counter
          label="Новые"
          filters={[{ field: "status", operator: "eq", value: "new" }]}
          active={isOnly("new")}
          onSelect={only("new")}
        />
        <Counter
          label="В работе"
          filters={[{ field: "status", operator: "eq", value: "in_progress" }]}
          active={isOnly("in_progress")}
          onSelect={only("in_progress")}
        />
        <Counter
          label="Сдано, ждёт приёмки"
          filters={[{ field: "status", operator: "eq", value: "done" }]}
          active={isOnly("done")}
          onSelect={only("done")}
        />
        <Counter
          label="Закрыто за 7 дней"
          filters={[
            { field: "status", operator: "eq", value: "closed" },
            { field: "closed_at", operator: "gte", value: closedSince },
          ]}
        />
      </div>

      {/* ------------------------------ фильтры ------------------------------ */}
      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border bg-card px-3 py-2.5">
        <div className="space-y-1">
          <FilterLabel>Статус</FilterLabel>
          <StatusMultiSelect value={statuses} onChange={setStatuses} disabled={awaiting} />
        </div>

        {/* Прячем, а не рисуем пустым, когда справочник отказал: права на типы
            и филиалы не те же, что на сам список. */}
        {!types.isError && (
          <div className="space-y-1">
            <FilterLabel>Тип</FilterLabel>
            <Select
              value={typeId || ALL}
              onValueChange={(v) => setTypeId(v === ALL ? null : v)}
            >
              <SelectTrigger className="h-8 w-[190px] text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Все типы</SelectItem>
                {(types.data ?? []).map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name_ru}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {!terminals.isError && (
          <div className="space-y-1">
            <FilterLabel>Филиал</FilterLabel>
            <Select
              value={terminalId || ALL}
              onValueChange={(v) => setTerminalId(v === ALL ? null : v)}
            >
              <SelectTrigger className="h-8 w-[210px] text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Все филиалы</SelectItem>
                {(terminals.data ?? []).map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="space-y-1">
          <FilterLabel>Приоритет</FilterLabel>
          <Select
            value={priorityOn ? priority : ALL}
            onValueChange={(v) => {
              if (v === ALL) {
                setPriorityOn(null);
                setPriority(null);
              } else {
                setPriority(v as "normal" | "urgent");
                setPriorityOn(true);
              }
            }}
          >
            <SelectTrigger className="h-8 w-[140px] text-[13px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Любой</SelectItem>
              <SelectItem value="urgent">Срочные</SelectItem>
              <SelectItem value="normal">Обычные</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex h-8 items-center gap-2">
          <Switch
            id="tickets-awaiting"
            checked={awaiting}
            onCheckedChange={(v) => setAwaiting(v ? true : null)}
          />
          <Label htmlFor="tickets-awaiting" className="text-[13px] font-normal">
            Только непринятые
          </Label>
        </div>

        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-8 text-[12px] text-muted-foreground"
            onClick={resetFilters}
          >
            Сбросить фильтры
          </Button>
        )}
      </div>

      <DataTable
        columns={columns}
        filters={filters}
        hasFilters={hasFilters}
        onResetFilters={resetFilters}
        onOpen={onOpen}
      />
    </div>
  );
}
