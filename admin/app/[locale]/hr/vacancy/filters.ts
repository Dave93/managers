import { DateRange } from "react-day-picker";
import { create } from "zustand";

interface VacancyFiltersProps { 
    organizationId: string | undefined;
    positionId: string | undefined;
    terminalId: string | undefined;
    workScheduleId: string | undefined;
    status: string | undefined;
    date: DateRange | undefined;
    setDate: (date: DateRange | undefined) => void;
    setOrganizationId: (organizationId: string) => void;
    setPositionId: (positionId: string) => void;
    setTerminalId: (terminalId: string) => void;
    setWorkScheduleId: (workScheduleId: string) => void;
    setStatus: (status: string) => void;
}

const date = new Date();

export const useVacancyFiltersStore = create<VacancyFiltersProps>((set) => ({
    organizationId: undefined,
    positionId: undefined,
    terminalId: undefined,
    workScheduleId: undefined,
    status: undefined,
    date: {
        from: new Date(date.getFullYear(), date.getMonth(), 1),
        to: new Date(date.getFullYear(), date.getMonth() + 1, 0),
    },
    setDate: (date: DateRange | undefined) => set({ date }),
    setOrganizationId: (organizationId: string) => set({ organizationId }),
    setPositionId: (positionId: string) => set({ positionId }),
    setTerminalId: (terminalId: string) => set({ terminalId }),
    setWorkScheduleId: (workScheduleId: string) => set({ workScheduleId }),
    setStatus: (status: string) => set({ status }),
}));