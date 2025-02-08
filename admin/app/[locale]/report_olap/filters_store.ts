import { DateRange } from "react-day-picker";
import { create } from "zustand";

interface StoplistFilterState {
  date: DateRange | undefined;
  storeId: string | undefined;
  setDate: (date: DateRange | undefined) => void;
  setStoreId: (storeId: string | undefined) => void;
}

const date = new Date();

export const useStoplistFilterStore = create<StoplistFilterState>((set) => ({
  date: {
    from: new Date(date.getFullYear(), date.getMonth(), 1),
    to: new Date(date.getFullYear(), date.getMonth() + 1, 0),
  },
  storeId: undefined,
  productType: undefined,
  setDate(date) {
    set({ date });
  },
  setStoreId(storeId) {
    set({ storeId });
  },

}));
