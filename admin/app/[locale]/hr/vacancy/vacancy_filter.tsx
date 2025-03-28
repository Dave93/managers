import { Input } from "@admin/components/ui/input";
import { useVacancyFiltersStore } from "./filters";
import { useEffect, useState } from "react";
import { apiClient } from "@admin/utils/eden";
import { organization, positions as positionsTable, terminals as terminalsTable, work_schedules, vacancyStatusEnumV2 } from "@backend/../drizzle/schema";
import { Button } from "@admin/components/ui/button";
import { cn } from "@admin/lib/utils";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@admin/components/ui/select";
import { Label } from "@admin/components/ui/label";
import { CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { Calendar } from "@admin/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@admin/components/ui/popover";

export const VacancyFilters = () => {
    const setOrganizationId = useVacancyFiltersStore((state) => state.setOrganizationId);
    const organizationId = useVacancyFiltersStore((state) => state.organizationId);
    const setPositionId = useVacancyFiltersStore((state) => state.setPositionId);
    const positionId = useVacancyFiltersStore((state) => state.positionId);
    const setTerminalId = useVacancyFiltersStore((state) => state.setTerminalId);
    const terminalId = useVacancyFiltersStore((state) => state.terminalId);
    const setWorkScheduleId = useVacancyFiltersStore((state) => state.setWorkScheduleId);
    const workScheduleId = useVacancyFiltersStore((state) => state.workScheduleId);
    const setStatus = useVacancyFiltersStore((state) => state.setStatus);
    const status = useVacancyFiltersStore((state) => state.status);
    const date = useVacancyFiltersStore((state) => state.date);
    const setDate = useVacancyFiltersStore((state) => state.setDate);

    const [organizations, setOrganizations] = useState<(typeof organization.$inferSelect)[]>([]);
    const [positions, setPositions] = useState<(typeof positionsTable.$inferSelect)[]>([]);
    const [terminals, setTerminals] = useState<(typeof terminalsTable.$inferSelect)[]>([]);
    const [workSchedules, setWorkSchedules] = useState<(typeof work_schedules.$inferSelect)[]>([]);

    const handleOrganizationChange = (value: string) => {
        if (value === "clear") {
            setOrganizationId("");
        } else {
            setOrganizationId(value);
        }
    };

    const handlePositionChange = (value: string) => {
        if (value === "clear") {
            setPositionId("");
        } else {
            setPositionId(value);
        }
    };

    const handleTerminalChange = (value: string) => {
        if (value === "clear") {
            setTerminalId("");
        } else {
            setTerminalId(value);
        }
    };

    const handleWorkScheduleChange = (value: string) => {
        if (value === "clear") {
            setWorkScheduleId("");
        } else {
            setWorkScheduleId(value);
        }
    };

    const handleStatusChange = (value: string) => {
        if (value === "clear") {
            setStatus("");
        } else {
            setStatus(value);
        }
    };

    const loadOrganizations = async () => {
        const { data } = await apiClient.api.organization.cached.get({});
        if (data && Array.isArray(data)) {
            setOrganizations(data);
        }
    };

    const loadPositions = async () => {
        const { data } = await apiClient.api.positions.cached.get({});
        if (data && Array.isArray(data)) {
            setPositions(data);
        }
    };

    const loadTerminals = async () => {
        const { data } = await apiClient.api.terminals.cached.get({});
        if (data && Array.isArray(data)) {
            setTerminals(data);
        }
    };

    const loadWorkSchedules = async () => {
        const { data } = await apiClient.api.work_schedule.cached.get({});
        if (data && Array.isArray(data)) {
            setWorkSchedules(data);
        }
    };

    useEffect(() => {
        loadOrganizations();
        loadPositions();
        loadTerminals();
        loadWorkSchedules();
    }, []);

    // Отладочные логи для отслеживания состояния
    useEffect(() => {
        console.log("Current positionId:", positionId);
    }, [positionId]);

    console.log("positionId", positionId);

    return (
        <div className="w-full px-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
                <div className="w-full">
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button
                                id="date"
                                variant="outline"
                                className={cn(
                                    "w-full justify-start text-left font-normal",
                                    !date && "text-muted-foreground"
                                )}
                            >
                                <CalendarIcon className="mr-2 h-4 w-4" />
                                {date?.from ? (
                                    date.to ? (
                                        <>
                                            {format(date.from, "dd.MM.yyyy")} -{" "}
                                            {format(date.to, "dd.MM.yyyy")}
                                        </>
                                    ) : (
                                        format(date.from, "dd.MM.yyyy")
                                    )
                                ) : (
                                    <span>Выберите дату</span>
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
                </div>

                <div className="w-full">
                    <Select value={organizationId} onValueChange={handleOrganizationChange}>
                        <SelectTrigger className="w-full">
                            <SelectValue placeholder="Выберите бренд" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                <SelectItem value="clear" className="text-red-500">Очистить</SelectItem>
                                {organizations.map((org) => (
                                    <SelectItem key={org.id} value={org.id}>
                                        {org.name}
                                    </SelectItem>
                                ))}
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                </div>
                
                <div className="w-full">
                    <Select 
                        value={positionId} 
                        onValueChange={handlePositionChange}
                    >
                        <SelectTrigger className="w-full">
                            <SelectValue placeholder="Выберите должность" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                <SelectItem value="clear" className="text-red-500">Очистить</SelectItem>
                                {positions.map((pos) => (
                                    <SelectItem key={pos.id} value={pos.id}>
                                        {pos.title}
                                    </SelectItem>
                                ))}
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                </div>

                <div className="w-full">
                    <Select value={terminalId} onValueChange={handleTerminalChange}>
                        <SelectTrigger className="w-full">
                            <SelectValue placeholder="Выберите филиал" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                <SelectItem value="clear" className="text-red-500">Очистить</SelectItem>
                                {terminals.map((term) => (
                                    <SelectItem key={term.id} value={term.id}>
                                        {term.name}
                                    </SelectItem>
                                ))}
                            </SelectGroup>
                        </SelectContent>
                    </Select>   
                </div>

                <div className="w-full">
                    <Select value={workScheduleId} onValueChange={handleWorkScheduleChange}>
                        <SelectTrigger className="w-full">
                            <SelectValue placeholder="Выберите график работы" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                <SelectItem value="clear" className="text-red-500">Очистить</SelectItem>
                                {workSchedules.map((ws) => (
                                    <SelectItem key={ws.id} value={ws.id}>
                                        {ws.name}
                                    </SelectItem>
                                ))}
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                </div>

                <div className="w-full">
                    <Select value={status} onValueChange={handleStatusChange}>
                        <SelectTrigger className="w-full">
                            <SelectValue placeholder="Выберите статус" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                <SelectItem value="clear" className="text-red-500">Очистить</SelectItem>
                                {Object.values(vacancyStatusEnumV2.enumValues).map((statusValue) => (
                                    <SelectItem key={statusValue} value={statusValue}>
                                        {statusValue === "open" && "Открытая"}
                                        {statusValue === "in_progress" && "В процессе"}
                                        {statusValue === "found_candidates" && "Найдены кандидаты"}
                                        {statusValue === "interview" && "Собеседование"}
                                        {statusValue === "closed" && "Закрыта"}
                                        {statusValue === "cancelled" && "Отменена"}
                                    </SelectItem>
                                ))}
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                </div>
            </div>
        </div>
    );
};