import { Calendar as CalendarIcon } from "lucide-react";
import { Button } from "@admin/components/ui/buttonOrigin";
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
import { useState } from "react";

export function DateRangeFilter() {
  const t = useTranslations("charts.filters.dateRange");
  const locale = useLocale();
  const dateFnsLocale =
    locale == "en"
      ? dateLocales.enUS
      : dateLocales[locale as keyof typeof dateLocales] || dateLocales.enUS;

  const { dateRange, setDateRange, today, yesterday, last7Days, last30Days, monthToDate, lastMonth, yearToDate, lastYear } = useDateRangeState();
  const [month, setMonth] = useState(today);
  return (
    <div className="grid gap-2">
      <Popover>
        <PopoverTrigger>
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
          {/* <Calendar
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
          </div> */}
          <div className="rounded-md border">
            <div className="flex max-sm:flex-col">
              <div className="relative py-4 max-sm:order-1 max-sm:border-t sm:w-40">
                <div className="h-full sm:border-e">
                  <div className="flex flex-col px-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start"
                      onClick={() => {
                        setDateRange({
                          from: today,
                          to: today,
                        });
                        setMonth(today);
                      }}
                    >
                      {t("today")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start"
                      onClick={() => {
                        setDateRange(yesterday);
                        setMonth(yesterday.to);
                      }}
                    >
                      {t("yesterday")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start"
                      onClick={() => {
                        setDateRange(last7Days);
                        setMonth(last7Days.to);
                      }}
                    >
                      {t("last7days")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start"
                      onClick={() => {
                        setDateRange(last30Days);
                        setMonth(last30Days.to);
                      }}
                    >
                      {t("last30days")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start"
                      onClick={() => {
                        setDateRange(monthToDate);
                        setMonth(monthToDate.to);
                      }}
                    >
                      {t("monthToDate")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start"
                      onClick={() => {
                        setDateRange(lastMonth);
                        setMonth(lastMonth.to);
                      }}
                    >
                      {t("lastMonth")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start"
                      onClick={() => {
                        setDateRange(yearToDate);
                        setMonth(yearToDate.to);
                      }}
                    >
                      {t("yearToDate")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start"
                      onClick={() => {
                        setDateRange(lastYear);
                        setMonth(lastYear.to);
                      }}
                    >
                      {t("lastYear")}
                    </Button>
                  </div>
                </div>
              </div>
              <Calendar
                mode="range"
                // @ts-ignore
                selected={dateRange}
                onSelect={(newDate) => {
                  if (newDate) {
                    setDateRange(newDate);
                  }
                }}
                month={month}
                onMonthChange={setMonth}
                className="p-2"
                disabled={[
                  { after: today }, // Dates before today
                ]}
              />
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
