import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@admin/components/ui/popover";
import { useStoplistFilterStore } from "./filters_store";
import { Button } from "@admin/components/ui/button";
import { cn } from "@admin/lib/utils";
import { CalendarIcon } from "@radix-ui/react-icons";
import { Calendar } from "@admin/components/ui/calendar";
import {
  addDays,
  startOfWeek,
  startOfMonth,
  endOfWeek,
  endOfMonth,
  format,
  subDays,
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
import {
  corporation_store,
  organization,
  terminals,
  users_stores,
} from "@backend/../drizzle/schema";
import { apiClient } from "@admin/utils/eden";
import useToken from "@admin/store/get-token";
import {
  organizationWithCredentials,
  terminalsWithCredentials,
} from "@backend/modules/cache_control/dto/cache.dto";

export const OutgoingFilters = () => {
  const date = useStoplistFilterStore((state) => state.date);
  const setDate = useStoplistFilterStore((state) => state.setDate);
  const setStoreId = useStoplistFilterStore((state) => state.setStoreId);

  const [usersStoresData, setUsersStoresData] = useState<
    InferSelectModel<typeof corporation_store>[]
  >([]);

  const token = useToken();
  const loadData = async () => {
    const { data } = await apiClient.api.users_stores.cached.get({
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (data && Array.isArray(data)) {
      setUsersStoresData(data);
    }
  };

  useEffect(() => {
    loadData();
  }, [token]);

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
              switch (value) {
                case "-1": // Yesterday
                  setDate({ from: subDays(today, 1), to: subDays(today, 1) });
                  break;
                case "0": // Today
                  setDate({ from: today, to: today });
                  break;
                case "lastWeek": // Last week
                  const startOfLastWeek = startOfWeek(subDays(today, 7), {
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
