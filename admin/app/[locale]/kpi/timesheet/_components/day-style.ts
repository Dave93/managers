import type { DayStatus } from "@admin/lib/kpi/timesheet";

// Цвет только на данных: вовремя — тихая серая плашка, опоздание и прогул — тёплые тона одной шкалы.
export const CELL: Record<DayStatus, string> = {
  ontime: "bg-zinc-200 dark:bg-zinc-700",
  late: "bg-amber-400 dark:bg-amber-500",
  absent: "bg-red-500",
};

// Пустой прошедший день — короткая серая черта; будущий день пуст.
export const EMPTY_DASH = "block h-px w-2 bg-muted-foreground/40";

export const pad2 = (n: number) => String(n).padStart(2, "0");
