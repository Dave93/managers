import {
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  subMonths,
  startOfYear,
  endOfYear,
  subYears,
  subDays,
} from "date-fns";
import { useTranslations, useLocale } from "next-intl";
import { useQueryState } from "nuqs";
import { DateRange } from "react-day-picker";
import * as dateLocales from "date-fns/locale";

const today = new Date();
const yesterday = {
  from: subDays(today, 1),
  to: subDays(today, 1),
};
const last7Days = {
  from: subDays(today, 6),
  to: today,
};
const last30Days = {
  from: subDays(today, 29),
  to: today,
};
const monthToDate = {
  from: startOfMonth(today),
  to: today,
};
const lastMonth = {
  from: startOfMonth(subMonths(today, 1)),
  to: endOfMonth(subMonths(today, 1)),
};
const yearToDate = {
  from: startOfYear(today),
  to: today,
};
const lastYear = {
  from: startOfYear(subYears(today, 1)),
  to: endOfYear(subYears(today, 1)),
};

export function useDateRangeState() {

  const [dateRange, setDateRange] = useQueryState<DateRange | undefined>(
    "date",
    {
      defaultValue: last30Days,
      parse: (value) => {
        const [from, to] = value.split(",");
        return { from: new Date(from), to: new Date(to) };
      },
      serialize: (value) =>
        value ? `${value.from?.toISOString()},${value.to?.toISOString()}` : "",
    }
  );
  return { dateRange, setDateRange, today, yesterday, last7Days, last30Days, monthToDate, lastMonth, yearToDate, lastYear };
}
