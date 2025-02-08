import { DateRange } from "react-day-picker";
import { Calendar as CalendarIcon } from "lucide-react";
import { Button } from "@admin/components/ui/button";
import { Calendar } from "@admin/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@admin/components/ui/popover";
import { format } from "date-fns";
import { useTranslations, useLocale } from "next-intl";
import * as dateLocales from "date-fns/locale";
import { useDateRangeState } from "./date-range-state.hook";

export function DateRangeFilter() {
  const t = useTranslations("filters");
  const locale = useLocale();
  const dateFnsLocale =
    locale == "en"
      ? dateLocales.enUS
      : dateLocales[locale as keyof typeof dateLocales] || dateLocales.enUS;

  const { dateRange, setDateRange, presets } = useDateRangeState();
  return (
    <div className="grid gap-2">
      <Popover>
        <PopoverTrigger asChild>
          <Button
            id="date"
            variant={"outline"}
            className={`w-[300px] justify-start text-left font-normal ${!dateRange && "text-muted-foreground"
              }`}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {dateRange?.from ? (
              dateRange.to ? (
                <>
                  {format(dateRange.from, "PP", { locale: dateFnsLocale })} -{" "}
                  {format(dateRange.to, "PP", { locale: dateFnsLocale })}
                </>
              ) : (
                format(dateRange.from, "PP", { locale: dateFnsLocale })
              )
            ) : (
              <span>{t("pickDate")}</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            initialFocus
            mode="range"
            defaultMonth={dateRange?.from ?? undefined}
            selected={dateRange ?? undefined}
            onSelect={(range: DateRange | undefined) =>
              range && setDateRange(range)
            }
            numberOfMonths={2}
            locale={dateFnsLocale}
          />
          <div className="grid grid-cols-2 gap-2 p-3">
            {presets.map((preset) => (
              <Button
                key={preset.label}
                onClick={() => setDateRange(preset.getValue())}
                variant="outline"
                className="w-full"
              >
                {preset.label}
              </Button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
