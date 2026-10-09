"use client";

// Колонки очереди «К оплате». Фабрика, как в ../columns.tsx: галочкам и кнопке
// раскрытия нужно текущее состояние страницы.

import type { ColumnDef } from "@tanstack/react-table";
import { ChevronDown, ChevronRight } from "lucide-react";

import { parseTs } from "@admin/components/tickets/status";
import type { TicketRow } from "@admin/lib/tickets-api";

import { formatAmount } from "@admin/lib/tickets-money";

export type SelectAllState = "none" | "some" | "all";

export type PaymentColumnsCtx = {
  selected: ReadonlySet<string>;
  expanded: ReadonlySet<string>;
  selectAll: SelectAllState;
  // Пока идёт запрос на утверждение, выбор менять нельзя: ответ относится к
  // строго отправленному набору.
  busy: boolean;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  onExpand: (id: string) => void;
};

const Dash = () => <span className="text-muted-foreground">—</span>;

function Check({
  checked,
  indeterminate,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  label: string;
  onChange: () => void;
}) {
  return (
    <input
      type="checkbox"
      className="size-4 cursor-pointer accent-primary disabled:cursor-not-allowed"
      aria-label={label}
      checked={checked}
      disabled={disabled}
      ref={(el) => {
        if (el) el.indeterminate = Boolean(indeterminate);
      }}
      onChange={onChange}
    />
  );
}

function fmtClosed(value: string | null): string {
  if (!value) return "—";
  const ms = parseTs(value);
  if (!Number.isFinite(ms)) return "—";
  return new Date(ms).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function buildPaymentColumns(ctx: PaymentColumnsCtx): ColumnDef<TicketRow, any>[] {
  return [
    {
      id: "select",
      header: () => (
        <Check
          label="Выбрать все заявки на странице"
          checked={ctx.selectAll === "all"}
          indeterminate={ctx.selectAll === "some"}
          disabled={ctx.busy}
          onChange={ctx.onToggleAll}
        />
      ),
      cell: ({ row }) => (
        <Check
          label={`Выбрать заявку ${row.original.number}`}
          checked={ctx.selected.has(row.original.id)}
          disabled={ctx.busy}
          onChange={() => ctx.onToggle(row.original.id)}
        />
      ),
    },
    {
      id: "number",
      header: "Номер",
      cell: ({ row }) => (
        <span className="font-mono text-[12.5px] font-medium tabular-nums">{row.original.number}</span>
      ),
    },
    {
      id: "terminal",
      header: "Филиал",
      cell: ({ row }) => (
        <span className="text-[12.5px]">{row.original.terminal_name ?? <Dash />}</span>
      ),
    },
    {
      id: "type",
      header: "Тип",
      cell: ({ row }) => <span className="text-[12.5px]">{row.original.type_name ?? <Dash />}</span>,
    },
    {
      id: "firm",
      header: "Фирма",
      cell: ({ row }) => (
        <span className="text-[12.5px]">{row.original.contractor_name ?? <Dash />}</span>
      ),
    },
    {
      id: "amount",
      header: () => <span className="block text-right">Сумма</span>,
      cell: ({ row }) => (
        <span className="block whitespace-nowrap text-right text-[12.5px] tabular-nums">
          {formatAmount(row.original.work_total_amount)}
        </span>
      ),
    },
    {
      id: "closed",
      header: "Закрыта",
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-[12.5px] tabular-nums">
          {fmtClosed(row.original.closed_at)}
        </span>
      ),
    },
    {
      id: "expand",
      header: () => <span className="sr-only">Акт и фото</span>,
      cell: ({ row }) => {
        const open = ctx.expanded.has(row.original.id);
        const Icon = open ? ChevronDown : ChevronRight;
        return (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={open ? `payment-detail-${row.original.id}` : undefined}
            aria-label={`${open ? "Свернуть" : "Раскрыть"} акт и фото заявки ${row.original.number}`}
            onClick={() => ctx.onExpand(row.original.id)}
            className="flex items-center gap-1 rounded px-1.5 py-1 text-[12px] text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <Icon className="size-4" />
            <span>{open ? "Свернуть" : "Акт и фото"}</span>
          </button>
        );
      },
    },
  ];
}
