import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@admin/components/ui/popover";
import { useStoplistFilterStore } from "./filters_store";
import { Button } from "@admin/components/ui/buttonOrigin";
import { cn } from "@admin/lib/utils";
import { CalendarIcon } from "@radix-ui/react-icons";
import { Calendar } from "@admin/components/ui/calendar";
import {
  startOfWeek,
  startOfMonth,
  endOfWeek,
  endOfMonth,
  format,
  subDays,
  startOfDay,
  endOfDay,
  subHours,
} from "date-fns";
import {
  Select,
  SelectItem,
  SelectContent,
  SelectTrigger,
  SelectValue,
  SelectGroup,
} from "@admin/components/ui/select";
import { useEffect, useState } from "react";
import { InferSelectModel } from "drizzle-orm";
import { corporation_store } from "@backend/../drizzle/schema";
import { apiClient } from "@admin/utils/eden";

export const InvoiceFilters = () => {
  const date = useStoplistFilterStore((state) => state.date);
  const setDate = useStoplistFilterStore((state) => state.setDate);
  const setStoreId = useStoplistFilterStore((state) => state.setStoreId);

  const [usersStoresData, setUsersStoresData] = useState<
    (typeof corporation_store.$inferSelect)[]
  >([]);

  const loadData = async () => {
    const { data } = await apiClient.api.users_stores.cached.get({});

    if (data && Array.isArray(data)) {
      setUsersStoresData(data);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  return (
    <div className="flex flex-col gap-4 py-4 lg:flex-row lg:space-x-3">
      <Popover>
        <PopoverTrigger asChild>
          <Button
            id="date"
            variant={"outline"}
            className={cn(
              "w-[300px] justify-start text-left font-normal",
              !date && "text-muted-foreground"
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {date?.from ? (
              date.to ? (
                <>
                  {format(date.from, "LLL dd, y")} -{" "}
                  {format(date.to, "LLL dd, y")}
                </>
              ) : (
                format(date.from, "LLL dd, y")
              )
            ) : (
              <span>Pick a date</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Select
            onValueChange={(value) => {
              const today = new Date();
              // console.log("value", value);
              switch (value) {
                case "-1": // Yesterday
                  setDate({
                    from: subHours(startOfDay(today), 24),
                    to: subHours(endOfDay(today), 24),
                  });
                  break;
                case "0": // Today
                  setDate({
                    from: startOfDay(today),
                    to: endOfDay(today),
                  });
                  break;
                case "lastWeek": // Last week
                  const startOfLastWeek = startOfWeek(subHours(today, 7 * 24), {
                    weekStartsOn: 1,
                  });
                  setDate({
                    from: startOfLastWeek,
                    to: endOfWeek(startOfLastWeek, { weekStartsOn: 1 }),
                  });
                  break;
                case "lastMonth": // Last month
                  const startOfLastMonth = startOfMonth(
                    subDays(today, today.getDate())
                  );
                  setDate({
                    from: startOfLastMonth,
                    to: endOfMonth(startOfLastMonth),
                  });
                  break;
                default:
                  console.log("Unknown selection");
              }
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select" />
            </SelectTrigger>
            <SelectContent position="popper">
              <SelectItem value="-1">Вчера</SelectItem>
              <SelectItem value="0">Сегодня</SelectItem>
              <SelectItem value="lastWeek">За прошлую неделю</SelectItem>
              <SelectItem value="lastMonth">За прошлый месяц</SelectItem>
            </SelectContent>
          </Select>

          <Calendar
            initialFocus
            mode="range"
            defaultMonth={date?.from}
            selected={date}
            onSelect={setDate}
            numberOfMonths={2}
          />
        </PopoverContent>
      </Popover>

      <Select
        onValueChange={(value) => {
          setStoreId(value);
        }}
      >
        <SelectTrigger className="max-w-xs">
          <SelectValue placeholder="Склады" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {usersStoresData.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.name}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
};
