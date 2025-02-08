import { DateRange } from "react-day-picker";
import { create } from "zustand";

interface StoplistFilterState {
  date: DateRange | undefined;
  setDate: (date: DateRange | undefined) => void;
  storeId: string | undefined;
  setStoreId: (storeId: string | undefined) => void;
  documentNumber: string | undefined;
  setDocumentNumber: (documentNumber: string | undefined) => void;
}

const date = new Date();

export const useStoplistFilterStore = create<StoplistFilterState>((set) => ({
  date: {
    from: new Date(date.getFullYear(), date.getMonth(), 1),
    to: new Date(date.getFullYear(), date.getMonth() + 1, 0),
  },
  storeId: undefined,
  documentNumber: undefined,
  setDate(date) {
    set({ date });
  },
  setStoreId(storeId) {
    set({ storeId });
  },
  setDocumentNumber(documentNumber) {
    set({ documentNumber });
  },
}));
