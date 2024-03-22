import { DateRange } from "react-day-picker";
import { create } from "zustand";

interface StoplistFilterState {
  date: DateRange | undefined;
  status: string | undefined;
  terminalId: string | undefined;
  organizationId: string | undefined;
  setDate: (date: DateRange | undefined) => void;
  setStatus: (status: string | undefined) => void;
  setTerminalId: (terminalId: string | undefined) => void;
  setOrganizationId: (organizationId: string | undefined) => void;
}

const date = new Date();

export const useStoplistFilterStore = create<StoplistFilterState>((set) => ({
  date: {
    from: new Date(date.getFullYear(), date.getMonth(), 1),
    to: new Date(date.getFullYear(), date.getMonth() + 1, 0),
  },
  status: undefined,
  terminalId: undefined,
  organizationId: undefined,
  setDate(date) {
    set({ date });
  },
  setStatus(status) {
    set({ status });
  },
  setTerminalId(terminalId) {
    set({ terminalId });
  },
  setOrganizationId(organizationId) {
    set({ organizationId });
  },
}));
