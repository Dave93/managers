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
import { format } from "date-fns";
import { Select, SelectItem } from "@nextui-org/select";
import { useEffect, useState } from "react";
import { InferSelectModel } from "drizzle-orm";
import {
  corporation_store,
  organization,
  terminals,
  users_stores,
  internal_transfer,
  internal_transfer_items,
} from "@backend/../drizzle/schema";
import { apiClient } from "@admin/utils/eden";
import useToken from "@admin/store/get-token";
import {
  organizationWithCredentials,
  terminalsWithCredentials,
} from "@backend/modules/cache_control/dto/cache.dto";

export const InternalTransferFilters = () => {
  const date = useStoplistFilterStore((state) => state.date);
  const setDate = useStoplistFilterStore((state) => state.setDate);
  const setStoreId = useStoplistFilterStore((state) => state.setStoreId);

  const [usersStoresData, setUsersStoresData] = useState<
    InferSelectModel<typeof corporation_store>[]
  >([]);

  const token = useToken();
  const loadData = async () => {
    const { data } = await apiClient.api.users_stores.cached.get({
      $headers: {
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
    <div className="py-4 flex space-x-3">
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
        labelPlacement="inside"
        label="Склады"
        className="max-w-xs"
        onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
          setStoreId(e.target.value);
        }}
      >
        {usersStoresData.map((item) => (
          <SelectItem key={item.id} value={item.id}>
            {item.name}
          </SelectItem>
        ))}
      </Select>
    </div>
  );
};
