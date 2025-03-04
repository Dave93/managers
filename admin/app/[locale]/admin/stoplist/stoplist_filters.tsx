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
import { useEffect, useState } from "react";
import { apiClient } from "@admin/utils/eden";
import {
  organizationWithCredentials,
  terminalsWithCredentials,
} from "@backend/modules/cache_control/dto/cache.dto";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@admin/components/ui/select";

export const StoplistFilters = () => {
  const date = useStoplistFilterStore((state) => state.date);
  const setDate = useStoplistFilterStore((state) => state.setDate);
  const setStatus = useStoplistFilterStore((state) => state.setStatus);
  const setTerminalId = useStoplistFilterStore((state) => state.setTerminalId);
  const setOrganizationId = useStoplistFilterStore(
    (state) => state.setOrganizationId
  );

  const [terminalsList, setTerminalsList] = useState<
    terminalsWithCredentials[]
  >([]);

  const [organizatonList, setOrganizationList] = useState<
    organizationWithCredentials[]
  >([]);

  const handleSelectionChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    // @ts-ignore
    setStatus(e.target.value);
  };

  const handleTerminalChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    // @ts-ignore
    setTerminalId(e.target.value);
  };

  const handleOrgChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    // @ts-ignore
    setOrganizationId(e.target.value);
  };

  const loadData = async () => {
    const { data } = await apiClient.api.terminals.cached.get({});

    if (data && Array.isArray(data)) {
      setTerminalsList(data);
    }

    const { data: dataOrg } = await apiClient.api.organization.cached.get({});
    if (dataOrg && Array.isArray(dataOrg)) {
      setOrganizationList(dataOrg);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

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
          <Select
            onValueChange={(value) => {
              const today = new Date();
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
              <SelectItem value="lastWeek">
                За прошлую неделю
              </SelectItem>
              <SelectItem value="lastMonth">
                За прошлый месяц
              </SelectItem>
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

      <div className="w-[200px]">
        <Select onValueChange={(value) => setStatus(value)}>
          <SelectTrigger>
            <SelectValue placeholder="Статус" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="stop">На стопе</SelectItem>
            <SelectItem value="available">Доступен</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="w-[200px]">
        <Select onValueChange={(value) => setOrganizationId(value)}>
          <SelectTrigger>
            <SelectValue placeholder="Бренд" />
          </SelectTrigger>
          <SelectContent>
            {organizatonList.map((org) => {
              let orgId = "";
              const iikoCredentialsLogin = org.credentials.find(
                (c) => c.type === "iiko_id"
              );
              if (iikoCredentialsLogin) {
                orgId = iikoCredentialsLogin.key;
              }

              return (
                <SelectItem key={orgId} value={orgId}>
                  {org.name}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>

      <div className="w-[200px]">
        <Select onValueChange={(value) => setTerminalId(value)}>
          <SelectTrigger>
            <SelectValue placeholder="Филиал" />
          </SelectTrigger>
          <SelectContent>
            {terminalsList.map((terminal) => {
              let terminalId = "";
              const iikoCredentials = terminal.credentials.find(
                (c) => c.type === "iiko_id"
              );
              if (iikoCredentials) {
                terminalId = iikoCredentials.key;
              }
              return (
                <SelectItem key={terminalId} value={terminalId}>
                  {terminal.name}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
};
