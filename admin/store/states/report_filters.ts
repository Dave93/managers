import { DateRange } from "react-day-picker";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

// Single shared filter store for ALL report pages (Заказы, Приходные накладные,
// Возвраты, Перемещения, Акт списания, Акт реализации, ...). Previously every
// report folder had its own filters_store, so the selected store (склад) was
// lost when switching between report tabs. They now all re-export this store,
// so date / storeId / productType / showActualColumn are shared in memory.
// storeId is also persisted to localStorage so it survives a full reload.
interface ReportFilterState {
  date: DateRange | undefined;
  setDate: (date: DateRange | undefined) => void;
  storeId: string | undefined;
  setStoreId: (storeId: string | undefined) => void;
  productType: string | undefined;
  setProductType: (productType: string | undefined) => void;
  showActualColumn: boolean;
  toggleShowActualColumn: () => void;
  documentNumber: string | undefined;
  setDocumentNumber: (documentNumber: string | undefined) => void;
}

const now = new Date();

export const useStoplistFilterStore = create<ReportFilterState>()(
  persist(
    (set, get) => ({
      date: {
        from: new Date(now.getFullYear(), now.getMonth(), 1),
        to: new Date(now.getFullYear(), now.getMonth() + 1, 0),
      },
      setDate(date) {
        set({ date });
      },
      storeId: undefined,
      setStoreId(storeId) {
        set({ storeId });
      },
      productType: undefined,
      setProductType(productType) {
        set({ productType });
      },
      showActualColumn: false,
      toggleShowActualColumn() {
        set({ showActualColumn: !get().showActualColumn });
      },
      documentNumber: undefined,
      setDocumentNumber(documentNumber) {
        set({ documentNumber });
      },
    }),
    {
      name: "report-filters",
      // SSR-safe: window/localStorage is absent on the server. zustand calls
      // this factory during render, so fall back to a no-op store there.
      storage: createJSONStorage(() =>
        typeof window !== "undefined"
          ? window.localStorage
          : ({ getItem: () => null, setItem: () => { }, removeItem: () => { } } as unknown as Storage)
      ),
      // Only the store selection survives reloads; date resets to the current
      // month, page-specific toggles reset.
      partialize: (state) => ({ storeId: state.storeId }),
    }
  )
);
