import {
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  subMonths,
} from "date-fns";
import { useTranslations, useLocale } from "next-intl";
import { useQueryState } from "nuqs";
import { DateRange } from "react-day-picker";
import * as dateLocales from "date-fns/locale";

export function useDateRangeState() {
  const t = useTranslations("charts.filters");
  const locale = useLocale();
  const dateFnsLocale =
    locale == "en"
      ? dateLocales.enUS
      : dateLocales[locale as keyof typeof dateLocales] || dateLocales.enUS;
  const presets = [
    {
      label: t("thisWeek"),
      getValue: () => ({
        from: startOfWeek(new Date(), { locale: dateFnsLocale }),
        to: endOfWeek(new Date(), { locale: dateFnsLocale }),
      }),
    },
    {
      label: t("thisMonth"),
      getValue: () => ({
        from: startOfMonth(new Date()),
        to: endOfMonth(new Date()),
      }),
    },
    {
      label: t("previousMonth"),
      getValue: () => {
        const lastMonth = subMonths(new Date(), 1);
        return { from: startOfMonth(lastMonth), to: endOfMonth(lastMonth) };
      },
    },
  ];

  const [dateRange, setDateRange] = useQueryState<DateRange | undefined>(
    "date",
    {
      defaultValue: presets[2].getValue(),
      parse: (value) => {
        const [from, to] = value.split(",");
        return { from: new Date(from), to: new Date(to) };
      },
      serialize: (value) =>
        value ? `${value.from?.toISOString()},${value.to?.toISOString()}` : "",
    }
  );
  return { dateRange, setDateRange, presets };
}
