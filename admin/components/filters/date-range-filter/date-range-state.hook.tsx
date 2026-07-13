import {
  startOfDay,
  endOfDay,
  startOfMonth,
  endOfMonth,
  subMonths,
  startOfYear,
  endOfYear,
  subYears,
  subDays,
} from "date-fns";
import { useQueryState } from "nuqs";
import { DateRange } from "react-day-picker";

// All presets snap to full-day boundaries (00:00:00 → 23:59:59.999). The chart
// aggregates bucket at 00:00, and queries filter `bucket BETWEEN from AND to`;
// using the current instant (e.g. 12:34) as `from` would exclude that day's
// 00:00 bucket and show "no data" for single-day ranges like Today/Yesterday.
const today = new Date();
const todayRange = {
  from: startOfDay(today),
  to: endOfDay(today),
};
const yesterday = {
  from: startOfDay(subDays(today, 1)),
  to: endOfDay(subDays(today, 1)),
};
const last7Days = {
  from: startOfDay(subDays(today, 6)),
  to: endOfDay(today),
};
const last30Days = {
  from: startOfDay(subDays(today, 29)),
  to: endOfDay(today),
};
const monthToDate = {
  from: startOfMonth(today),
  to: endOfDay(today),
};
const lastMonth = {
  from: startOfMonth(subMonths(today, 1)),
  to: endOfMonth(subMonths(today, 1)),
};
const yearToDate = {
  from: startOfYear(today),
  to: endOfDay(today),
};
const lastYear = {
  from: startOfYear(subYears(today, 1)),
  to: endOfYear(subYears(today, 1)),
};

export function useDateRangeState(defaultRange?: DateRange) {

  const [dateRange, setDateRange] = useQueryState<DateRange | undefined>(
    "date",
    {
      defaultValue: defaultRange ?? last30Days,
      parse: (value) => {
        const [from, to] = value.split(",");
        return { from: new Date(from), to: new Date(to) };
      },
      serialize: (value) =>
        value ? `${value.from?.toISOString()},${value.to?.toISOString()}` : "",
    }
  );
  return { dateRange, setDateRange, today, todayRange, yesterday, last7Days, last30Days, monthToDate, lastMonth, yearToDate, lastYear };
}
