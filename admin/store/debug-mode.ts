import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface DebugModeState {
    isDebugMode: boolean
    toggleDebugMode: () => void
}

export const useDebugMode = create(
    persist<DebugModeState>(
        (set) => ({
            isDebugMode: false,
            toggleDebugMode: () => set((state) => ({ isDebugMode: !state.isDebugMode })),
        }),
        {
            name: 'debug-mode-storage',
        }
    )
)