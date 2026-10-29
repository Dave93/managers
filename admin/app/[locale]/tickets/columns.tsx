"use client";

// Колонки списка заявок офиса. Фабрика, а не константа: симптому нужны типы
// (подписи значений полей), а номеру нужен обработчик открытия карточки.

import type { ColumnDef } from "@tanstack/react-table";
import type { useTranslations } from "next-intl";

import { formatAmount } from "@admin/lib/tickets-money";
import type { TicketsLibT } from "@admin/lib/tickets-i18n";
import type { TicketRow, TicketTypeRow } from "@admin/lib/tickets-api";
import { detailValue } from "@admin/lib/tickets-details";
import { PriorityBadge, StatusBadge, WaitingFor } from "@admin/components/tickets/status";

// Симптом: первое заполненное значение details. В строке списка нет схемы
// полей, поэтому там лежат сырые значения select (`no_heat`), а не подписи.
// Когда справочник типов доступен, порядок берём из схемы типа, а значение
// заменяем подписью; когда нет, показываем значение как есть.
export function symptomOf(row: TicketRow, types: TicketTypeRow[] | undefined): string | null {
  const type = types?.find((t) => t.name_ru === row.type_name);
  const schema = type?.fields_schema ?? [];
  const keys = [
    ...schema.map((f) => f.key),
    ...Object.keys(row.details ?? {}).filter((k) => !schema.some((f) => f.key === k)),
  ];
  for (const key of keys) {
    const raw = detailValue(row.details, key);
    if (typeof raw !== "string" || raw.trim() === "") continue;
    const field = schema.find((f) => f.key === key);
    const option = field?.options?.find((o) => o.value === raw);
    return option?.label_ru ?? raw;
  }
  return null;
}

const Dash = () => <span className="text-muted-foreground">—</span>;

export function buildColumns({
  onOpen,
  types,
  t,
  tl,
}: {
  onOpen: (id: string) => void;
  types: TicketTypeRow[] | undefined;
  // Переводчик словаря `ticketsUi.columns`.
  t: ReturnType<typeof useTranslations>;
  // Переводчик словаря `ticketsLib` (суммы).
  tl?: TicketsLibT;
}): ColumnDef<TicketRow, any>[] {
  return [
    {
      id: "number",
      header: t("number"),
      cell: ({ row }) => (
        <button
          type="button"
          onClick={(e) => {
            // Строка тоже открывает карточку; без этого один клик вызвал бы
            // onOpen дважды.
            e.stopPropagation();
            onOpen(row.original.id);
          }}
          className="rounded font-mono text-[12.5px] font-medium tabular-nums outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {row.original.number}
        </button>
      ),
    },
    {
      id: "type",
      header: t("type"),
      cell: ({ row }) => (
        <span className="text-[12.5px]">{row.original.type_name ?? <Dash />}</span>
      ),
    },
    {
      id: "terminal",
      header: t("terminal"),
      cell: ({ row }) => (
        <span className="text-[12.5px]">{row.original.terminal_name ?? <Dash />}</span>
      ),
    },
    {
      id: "symptom",
      header: t("symptom"),
      cell: ({ row }) => {
        const s = symptomOf(row.original, types);
        return s ? (
          <span className="line-clamp-2 max-w-[260px] text-[12.5px] leading-snug">{s}</span>
        ) : (
          <Dash />
        );
      },
    },
    {
      id: "status",
      header: t("status"),
      cell: ({ row }) => (
        <div className="flex flex-wrap items-center gap-1">
          <StatusBadge status={row.original.status} />
          <PriorityBadge priority={row.original.priority} />
        </div>
      ),
    },
    {
      id: "executor",
      header: t("executor"),
      cell: ({ row }) => (
        <span className="text-[12.5px]">{row.original.executor_name ?? <Dash />}</span>
      ),
    },
    {
      id: "waiting",
      header: t("waiting"),
      cell: ({ row }) => (
        <span className="text-[12.5px]">
          <WaitingFor
            status={row.original.status}
            created_at={row.original.created_at}
            assigned_at={row.original.assigned_at}
            done_at={row.original.done_at}
          />
        </span>
      ),
    },
    {
      id: "amount",
      header: () => <span className="block text-right">{t("amount")}</span>,
      cell: ({ row }) => {
        const raw = row.original.work_total_amount;
        return (
          <span className="block text-right text-[12.5px] tabular-nums whitespace-nowrap">
            {raw === null ? <Dash /> : formatAmount(raw, tl)}
          </span>
        );
      },
    },
  ];
}
