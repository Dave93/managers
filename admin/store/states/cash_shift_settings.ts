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
      // SSR-safe: window/localStorage is absent on the server. zustand calls
      // this factory during render, so fall back to a no-op store there.
      storage: createJSONStorage(() =>
        typeof window !== "undefined"
          ? window.localStorage
          : ({ getItem: () => null, setItem: () => {}, removeItem: () => {} } as unknown as Storage)
      ),
      version: 1,
    }
  )
);
