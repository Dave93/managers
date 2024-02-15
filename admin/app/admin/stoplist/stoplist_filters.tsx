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

export const StoplistFilters = () => {
  const date = useStoplistFilterStore((state) => state.date);
  const setDate = useStoplistFilterStore((state) => state.setDate);
  const setStatus = useStoplistFilterStore((state) => state.setStatus);

  const handleSelectionChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setStatus(e.target.value);
  };

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
    </div>
  );
};
