import React from "react";
import { cn } from "@admin/lib/utils";
import type { Tone } from "@admin/lib/kpi/status";

// Классы повторяют app/[locale]/medical/status-badge.tsx; blue добавлен для «Предложено».
const TONES: Record<Tone, string> = {
  gray: "bg-gray-100 text-gray-600 border-gray-200",
  amber: "bg-amber-100 text-amber-700 border-amber-200",
  green: "bg-green-100 text-green-700 border-green-200",
  red: "bg-red-100 text-red-700 border-red-200",
  blue: "bg-blue-100 text-blue-700 border-blue-200",
};

export function KpiBadge({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        TONES[tone]
      )}
    >
      {children}
    </span>
  );
}
