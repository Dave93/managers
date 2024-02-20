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
import { organization, terminals } from "@backend/../drizzle/schema";
import { apiClient } from "@admin/utils/eden";
import useToken from "@admin/store/get-token";
import { organizationWithCredentials, terminalsWithCredentials } from "@backend/modules/cache_control/dto/cache.dto";

export const StoplistFilters = () => {
  const date = useStoplistFilterStore((state) => state.date);
  const setDate = useStoplistFilterStore((state) => state.setDate);
  const setStatus = useStoplistFilterStore((state) => state.setStatus);
  const setTerminalId = useStoplistFilterStore((state) => state.setTerminalId);
  const setOrganizationId = useStoplistFilterStore((state) => state.setOrganizationId);

  const token = useToken();

  const [terminalsList, setTerminalsList] = useState<terminalsWithCredentials[]>([]);

  const [organizatonList, setOrganizationList] = useState<organizationWithCredentials[]>([]);

  const handleSelectionChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setStatus(e.target.value);
  };

  const handleTerminalChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    console.log(e.target.value);
    setTerminalId(e.target.value);
  }

  const handleOrgChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setOrganizationId(e.target.value);
  }

  console.log(organizatonList);
  const loadData = async () => {
    const {
      data
    } = await apiClient.api.terminals.cached.get({
      $headers: {
        "Authorization": "Bearer " + token
      },
    })

    if (data && Array.isArray(data)) {
      setTerminalsList(data);
    }

    const {
      data: dataOrg
    } = await apiClient.api.organization.cached.get({
      $headers: {
        "Authorization": "Bearer " + token
      }
    })
    if (dataOrg && Array.isArray(dataOrg)) {
      setOrganizationList(dataOrg);
    }
  }

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
        label="Статус"
        className="max-w-xs"
        onChange={handleSelectionChange}
      >
        <SelectItem key="stop" value="stop">
          На стопе
        </SelectItem>
        <SelectItem key="available" value="available">
          Доступен
        </SelectItem>
      </Select>

      <Select labelPlacement="inside"
        label="Бренд"
        className="max-w-xs"
        onChange={handleOrgChange}>
        {organizatonList.map((org) => {
          let orgId = '';
          const iikoCredentialsLogin = org.credentials.find(c => c.type === 'iiko_id');
          if (iikoCredentialsLogin) {
            orgId = iikoCredentialsLogin.key;
          }

          return (<SelectItem key={orgId} value={orgId}>
            {org.name}
          </SelectItem>)
        })}
      </Select>

      <Select
        labelPlacement="inside"
        label="Филиал"
        className="max-w-xs"
        onChange={handleTerminalChange}
      >
        {terminalsList.map((terminal) => {
          let terminalId = '';
          const iikoCredentials = terminal.credentials.find(c => c.type === 'iiko_id');
          if (iikoCredentials) {
            terminalId = iikoCredentials.key;
          }
          return (<SelectItem key={terminalId} value={terminalId}>
            {terminal.name}
          </SelectItem>)
        })}
      </Select>
    </div>
  );
};
