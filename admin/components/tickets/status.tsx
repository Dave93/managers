"use client";

import { Badge } from "@components/ui/badge";
import { cn } from "@admin/lib/utils";
import type { TicketPriority, TicketStatus } from "@admin/lib/tickets-api";

const STATUS_RU: Record<TicketStatus, string> = {
  new: "Новая",
  in_progress: "В работе",
  done: "Сдана",
  closed: "Закрыта",
  cancelled: "Отменена",
};

// Тона из палитры самой админки (blue/amber/violet/emerald/zinc/red), каждый с
// парой для тёмной темы: без неё светлый чип на тёмном фоне выжигает глаза.
const STATUS_TONE: Record<TicketStatus, string> = {
  new: "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200",
  in_progress: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  done: "bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200",
  closed: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  cancelled: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

export const STATUS_ORDER: TicketStatus[] = ["new", "in_progress", "done", "closed", "cancelled"];

export function statusLabel(status: TicketStatus): string {
  return STATUS_RU[status];
}

export function StatusBadge({ status }: { status: TicketStatus }) {
  return (
    <Badge className={cn("border-transparent font-medium", STATUS_TONE[status])}>
      {STATUS_RU[status]}
    </Badge>
  );
}

export function PriorityBadge({ priority }: { priority: TicketPriority }) {
  if (priority !== "urgent") return null;
  return (
    <Badge className="border-transparent bg-red-100 font-medium text-red-900 dark:bg-red-950 dark:text-red-200">
      Срочная
    </Badge>
  );
}

// Бэкенд отдаёт timestamptz как строку Postgres: «2026-10-05 12:00:00.123+00».
// `new Date(s.replace(" ", "T"))` такую строку не разбирает (NaN из-за смещения
// «+00» без минут), и тогда колонка «висит» молча показывала бы прочерк у всех
// заявок. Поэтому разбираем руками: дата, время, доли секунды и смещение. Если
// смещения нет, считаем время UTC: сервер пишет только timestamptz.
const TS_RE =
  /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}(?::?\d{2})?)?$/;

export function parseTs(value: string): number {
  const m = TS_RE.exec(value.trim());
  if (!m) return NaN;
  const [, date, time, frac = "", tz = "Z"] = m;
  const ms = frac.slice(0, 3).padEnd(3, "0");
  let offset = tz;
  if (tz !== "Z") {
    const digits = tz.slice(1).replace(":", "");
    offset = `${tz[0]}${digits.slice(0, 2)}:${digits.slice(2, 4) || "00"}`;
  }
  return new Date(`${date}T${time}.${ms}${offset}`).getTime();
}

const CLOCK_SKEW_MS = 5 * 60_000;

// Сколько заявка стоит в текущем состоянии. Дедлайнов в системе нет, и это
// единственное место, где видно «висит и никто не взял».
export function waitingHours(
  row: {
    status: TicketStatus;
    created_at: string;
    assigned_at: string | null;
    done_at: string | null;
  },
  now: number = Date.now()
): number | null {
  const since =
    row.status === "new"
      ? row.created_at
      : row.status === "in_progress"
        ? (row.assigned_at ?? row.created_at)
        : row.status === "done"
          ? (row.done_at ?? row.created_at)
          : null;
  if (!since) return null;
  const ms = now - parseTs(since);
  if (!Number.isFinite(ms)) return null;
  // Часы оператора могут отставать от сервера: небольшой «минус» (до пяти
  // минут) считаем нулём, иначе свежая заявка показала бы прочерк вместо
  // «меньше часа». Дальше пяти минут это уже не сдвиг часов, а мусорные
  // данные или сломанный компьютер, и честнее прочерк.
  if (ms < -CLOCK_SKEW_MS) return null;
  return Math.floor(Math.max(ms, 0) / 3_600_000);
}

export function WaitingFor(props: {
  status: TicketStatus;
  created_at: string;
  assigned_at: string | null;
  done_at: string | null;
}) {
  const h = waitingHours(props);
  if (h === null) return <span className="text-muted-foreground">—</span>;
  const label = h < 1 ? "меньше часа" : h < 24 ? `${h} ч` : `${Math.floor(h / 24)} дн`;
  return (
    <span className={cn("tabular-nums", h >= 24 && "font-semibold text-red-600 dark:text-red-400")}>
      {label}
    </span>
  );
}
