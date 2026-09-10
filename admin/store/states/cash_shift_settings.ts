import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import {
  DEFAULT_SHIFT_SETTINGS,
  type ShiftSettings,
} from "@admin/app/[locale]/dashboard/cash-shifts/flags";

// Thresholds of the «Кассовые смены» dashboard widget. Per browser: they only
// change how shifts are highlighted, never what the API returns.
type CashShiftSettingsState = ShiftSettings & {
  update: (patch: Partial<ShiftSettings>) => void;
  reset: () => void;
};

export const useCashShiftSettings = create<CashShiftSettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_SHIFT_SETTINGS,
      update: (patch) => set(patch),
      reset: () => set({ ...DEFAULT_SHIFT_SETTINGS }),
    }),
    {
      name: "cash-shift-widget-settings",
      storage: createJSONStorage(() => localStorage),
      version: 1,
    }
  )
);
